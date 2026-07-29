"use strict";

const CANCELLED_STATUSES = new Set(["cancelled", "canceled"]);

function kstDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("유효한 날짜가 필요합니다.");
  }
  const kst = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  return [
    kst.getUTCFullYear(),
    String(kst.getUTCMonth() + 1).padStart(2, "0"),
    String(kst.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function isReceiptEligible(order) {
  const status = String(order.status || "").toLowerCase();
  const paymentStatus = String(order.paymentStatus || "").toLowerCase();
  if (CANCELLED_STATUSES.has(status) || paymentStatus === "cancelled" || order.cancelledAt) return false;
  return true;
}

function receiptVariant(orders) {
  const eligible = orders.filter(isReceiptEligible);
  if (!eligible.length) return null;
  if (eligible.some((order) => order.paymentType === "onsite")) return "onsite";
  return eligible.some((order) => order.transferApproved !== true)
    ? "transfer-pending"
    : "transfer";
}

class OrderFlowModel {
  constructor({ stock = 0, deadline = "2999-12-31T00:00:00.000Z" } = {}) {
    this.stock = stock;
    this.deadline = new Date(deadline);
    this.orders = [];
    this.waitlist = [];
    this.notifications = [];
    this.noShowCounts = new Map();
    this.requestKeys = new Map();
    this.sequence = 0;
    this.lock = Promise.resolve();
  }

  order(input) {
    const task = this.lock.then(() => this.#createOrder(input));
    this.lock = task.catch(() => undefined);
    return task;
  }

  #createOrder({
    userId,
    quantity = 1,
    requestKey,
    paymentType = "onsite",
    transferApproved = false,
    bundleId = "bundle-1",
    createdAt = new Date().toISOString(),
    source = "direct"
  }) {
    if (requestKey && this.requestKeys.has(requestKey)) {
      return this.requestKeys.get(requestKey);
    }
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("invalid_quantity");
    if (this.stock < quantity) throw new Error("out_of_stock");

    this.stock -= quantity;
    const order = {
      id: `order-${++this.sequence}`,
      userId,
      bundleId,
      quantity,
      paymentType,
      transferApproved,
      paymentStatus: transferApproved ? "paid" : "pending",
      status: "applied",
      createdAt,
      source
    };
    this.orders.push(order);
    if (requestKey) this.requestKeys.set(requestKey, order);
    return order;
  }

  addWaiter({ userId, quantity, paymentType = "onsite", bundleId = "bundle-1" }) {
    const waiter = {
      id: `wait-${++this.sequence}`,
      userId,
      quantity,
      paymentType,
      bundleId,
      createdAt: this.sequence
    };
    this.waitlist.push(waiter);
    return waiter;
  }

  cancel(orderId, { actor = "customer", now = new Date() } = {}) {
    const order = this.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("order_not_found");
    if (CANCELLED_STATUSES.has(order.status)) throw new Error("already_cancelled");

    const afterDeadline = new Date(now).getTime() > this.deadline.getTime();
    if (actor === "customer" && afterDeadline) throw new Error("deadline_passed");

    order.status = "cancelled";
    order.paymentStatus = "cancelled";
    order.cancelledAt = new Date(now).toISOString();

    if (afterDeadline) {
      this.stock += order.quantity;
      return { restored: order.quantity, promoted: [] };
    }
    return this.#allocateReleased(order.quantity);
  }

  #allocateReleased(releasedQuantity) {
    let remaining = releasedQuantity;
    const promoted = [];

    while (remaining > 0 && this.waitlist.length > 0) {
      const waiter = this.waitlist[0];
      const allocated = Math.min(waiter.quantity, remaining);
      remaining -= allocated;
      waiter.quantity -= allocated;

      const order = {
        id: `order-${++this.sequence}`,
        userId: waiter.userId,
        bundleId: waiter.bundleId,
        quantity: allocated,
        paymentType: waiter.paymentType,
        transferApproved: waiter.paymentType !== "transfer",
        paymentStatus: waiter.paymentType === "transfer" ? "pending" : "pending",
        status: "applied",
        createdAt: new Date().toISOString(),
        source: "waitlist"
      };
      this.orders.push(order);
      promoted.push(order);
      this.notifications.push({
        type: "waitlist_promoted",
        userId: waiter.userId,
        allocated,
        remaining: waiter.quantity
      });

      if (waiter.quantity === 0) this.waitlist.shift();
    }

    this.stock += remaining;
    return { restored: remaining, promoted };
  }

  confirmTransfer(orderId) {
    const order = this.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("order_not_found");
    order.transferApproved = true;
    order.paymentStatus = "paid";
    return order;
  }

  expireNoShow(orderId, expiredAt = new Date()) {
    const order = this.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("order_not_found");
    if (order.paymentType !== "onsite") return false;
    if (order.status === "no_show") return false;
    if (CANCELLED_STATUSES.has(order.status)) return false;

    order.status = "no_show";
    order.noShowExpiredAt = new Date(expiredAt).toISOString();
    this.noShowCounts.set(order.userId, (this.noShowCounts.get(order.userId) || 0) + 1);
    return true;
  }
}

module.exports = {
  OrderFlowModel,
  isReceiptEligible,
  kstDateKey,
  receiptVariant
};
