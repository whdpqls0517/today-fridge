"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OrderFlowModel,
  isReceiptEligible,
  kstDateKey,
  receiptVariant
} = require("../test-support/order-flow-model");

test("마지막 재고 1개를 두 고객이 동시에 신청하면 한 명만 성공한다", async () => {
  const model = new OrderFlowModel({ stock: 1 });
  const results = await Promise.allSettled([
    model.order({ userId: "user-a", requestKey: "request-a" }),
    model.order({ userId: "user-b", requestKey: "request-b" })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(model.stock, 0);
  assert.equal(model.orders.length, 1);
});

test("같은 주문 요청 키는 재고를 두 번 차감하지 않는다", async () => {
  const model = new OrderFlowModel({ stock: 2 });
  const first = await model.order({ userId: "user-a", requestKey: "same-request" });
  const second = await model.order({ userId: "user-a", requestKey: "same-request" });

  assert.equal(first.id, second.id);
  assert.equal(model.stock, 1);
  assert.equal(model.orders.length, 1);
});

test("주문을 두 번 취소해도 수량은 한 번만 복구된다", async () => {
  const model = new OrderFlowModel({ stock: 2 });
  const order = await model.order({ userId: "user-a" });
  model.cancel(order.id);

  assert.throws(() => model.cancel(order.id), /already_cancelled/);
  assert.equal(model.stock, 2);
});

test("취소 수량은 첫 대기자에게 부분 배정되고 남은 수량도 같은 순번으로 유지된다", async () => {
  const model = new OrderFlowModel({ stock: 3 });
  const original = await model.order({ userId: "buyer", quantity: 2 });
  model.addWaiter({ userId: "first", quantity: 3 });
  model.addWaiter({ userId: "second", quantity: 1 });

  const firstRelease = model.cancel(original.id);
  assert.deepEqual(firstRelease.promoted.map((order) => [order.userId, order.quantity]), [["first", 2]]);
  assert.equal(model.waitlist[0].userId, "first");
  assert.equal(model.waitlist[0].quantity, 1);
  assert.equal(model.waitlist[1].userId, "second");
  assert.deepEqual(model.notifications.at(-1), {
    type: "waitlist_promoted",
    userId: "first",
    allocated: 2,
    remaining: 1
  });

  model.stock = 1;
  const extra = await model.order({ userId: "temporary" });
  const secondRelease = model.cancel(extra.id);
  assert.deepEqual(secondRelease.promoted.map((order) => [order.userId, order.quantity]), [["first", 1]]);
  assert.equal(model.waitlist[0].userId, "second");
});

test("마감 후 고객 취소는 거절되고 관리자 취소는 대기 승격 없이 복구된다", async () => {
  const model = new OrderFlowModel({
    stock: 1,
    deadline: "2026-07-28T06:00:00.000Z"
  });
  const order = await model.order({ userId: "buyer" });
  model.addWaiter({ userId: "waiter", quantity: 1 });
  const afterDeadline = new Date("2026-07-28T06:00:01.000Z");

  assert.throws(() => model.cancel(order.id, { actor: "customer", now: afterDeadline }), /deadline_passed/);
  const result = model.cancel(order.id, { actor: "admin", now: afterDeadline });
  assert.equal(result.promoted.length, 0);
  assert.equal(model.stock, 1);
  assert.equal(model.waitlist.length, 1);
});

test("선입금 주문은 입금 확인 전 대기 수령증으로 표시되고 확인 후 활성화된다", async () => {
  const model = new OrderFlowModel({ stock: 1 });
  const order = await model.order({
    userId: "buyer",
    paymentType: "transfer",
    transferApproved: false
  });

  assert.equal(isReceiptEligible(order), true);
  assert.equal(receiptVariant([order]), "transfer-pending");
  model.confirmTransfer(order.id);
  assert.equal(isReceiptEligible(order), true);
  assert.equal(receiptVariant([order]), "transfer");
});

test("취소 주문은 수령증에서 제외된다", async () => {
  const model = new OrderFlowModel({ stock: 1 });
  const order = await model.order({ userId: "buyer", paymentType: "onsite" });
  model.cancel(order.id);

  assert.equal(isReceiptEligible(order), false);
  assert.equal(receiptVariant([order]), null);
});

test("한국 시간 자정 전후의 오늘 날짜가 정확히 분리된다", () => {
  assert.equal(kstDateKey("2026-07-27T14:59:59.999Z"), "2026-07-27");
  assert.equal(kstDateKey("2026-07-27T15:00:00.000Z"), "2026-07-28");
  assert.equal(kstDateKey("2026-07-28T14:59:59.999Z"), "2026-07-28");
  assert.equal(kstDateKey("2026-07-28T15:00:00.000Z"), "2026-07-29");
});

test("미수령 만료는 현장결제에 한 번만 적용되고 노쇼도 한 번만 증가한다", async () => {
  const model = new OrderFlowModel({ stock: 2 });
  const onsite = await model.order({ userId: "buyer", paymentType: "onsite" });
  const transfer = await model.order({
    userId: "transfer-buyer",
    paymentType: "transfer",
    transferApproved: true
  });

  assert.equal(model.expireNoShow(onsite.id), true);
  assert.equal(model.expireNoShow(onsite.id), false);
  assert.equal(model.expireNoShow(transfer.id), false);
  assert.equal(model.noShowCounts.get("buyer"), 1);
  assert.equal(model.noShowCounts.has("transfer-buyer"), false);
});

test("같은 보따리에 선입금과 현장결제가 함께 있으면 현장결제 수령증을 사용한다", () => {
  const orders = [
    { paymentType: "transfer", transferApproved: true, status: "applied" },
    { paymentType: "onsite", transferApproved: false, status: "applied" }
  ];

  assert.equal(receiptVariant(orders), "onsite");
});
