(function () {
  const results = document.getElementById("order-results");
  const searchInput = document.getElementById("order-search-input");
  const detail = document.getElementById("order-detail");
  const detailContent = document.getElementById("order-detail-content");
  const cancelConfirm = document.getElementById("order-cancel-confirm");
  const toast = document.getElementById("order-toast");
  let activeFilter = "all";
  let toastTimer;
  let pendingCancelOrderId = null;

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function parseDate(value) {
    if (!value) return new Date(0);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
  }

  function dateLabel(value) {
    const date = parseDate(value);
    if (!date.getTime()) return "날짜 미정";
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  }

  function accessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (value?.access_token) return value.access_token;
        if (value?.currentSession?.access_token) return value.currentSession.access_token;
      } catch (_) {}
    }
    return null;
  }

  function orderedAt(order) {
    return order.createdAt || order.orderedAt || order.bundleDate;
  }

  function selectedPickupDate(order) {
    return order.pickupDateISO || order.pickupDate;
  }

  function statusOf(order) {
    if (order.status === "cancelled" || order.status === "canceled") return { key: "cancelled", label: "신청 취소", group: "finished", tone: "muted" };
    if (order.status === "completed") return { key: "completed", label: "수령 완료", group: "finished", tone: "done" };
    if (order.status === "expired") return { key: "expired", label: "미수령", group: "finished", tone: "expired" };
    if (order.arrivalStatus === "arrived") return { key: "available", label: "수령 가능", group: "progress", tone: "available" };
    return { key: "scheduled", label: "입고 예정", group: "progress", tone: "scheduled" };
  }

  function paymentLabel(order) {
    if (order.paymentType === "transfer") return order.transferApproved === false ? "입금 확인 대기" : "입금 확인 완료";
    return "현장결제";
  }

  function orderData() {
    const products = window.FridgeDB.getProducts();
    const productMap = new Map(products.map((product) => [product.id, product]));
    return window.FridgeDB.getOrders().map((order) => ({ ...order, product: productMap.get(order.productId), viewStatus: statusOf(order) }))
      .sort((a, b) => parseDate(orderedAt(b)) - parseDate(orderedAt(a)));
  }

  function canCustomerCancel(order) {
    return ["pending", "applied"].includes(order.status)
      && order.product?.category === "bundle"
      && window.ProductRules?.isBeforeDeadline(order.product);
  }

  function filteredOrders() {
    const keyword = searchInput.value.trim().toLowerCase();
    return orderData().filter((order) => {
      const filterMatch = activeFilter === "all" || order.viewStatus.group === activeFilter;
      const searchMatch = !keyword || `${order.productName} ${order.product?.categoryLabel || ""}`.toLowerCase().includes(keyword);
      return filterMatch && searchMatch;
    });
  }

  function cardHTML(order) {
    const image = order.product?.image || "./asset-bundle-food-gradient.png";
    const actions = [];
    const hasReview = window.FridgeDB.getReviews().some((review) => String(review.orderId) === String(order.id));
    if (order.status === "completed" && !hasReview) {
      actions.push(`<a href="./review-write.html?orderId=${encodeURIComponent(order.id)}">후기 작성</a>`);
    }
    if (order.viewStatus.group === "progress") actions.push(`<a href="./main.html#receipt">수령 확인증</a>`);
    if (canCustomerCancel(order)) {
      actions.push(`<button class="customer-cancel-button" type="button" data-cancel-order="${escapeHTML(order.id)}">신청 취소</button>`);
    }
    actions.push(`<button type="button" data-order-id="${escapeHTML(order.id)}">주문 정보</button>`);
    return `<article class="order-card">
      <div class="order-card-head"><time>${dateLabel(orderedAt(order))}</time><button type="button" data-order-id="${escapeHTML(order.id)}">상세보기 <b>›</b></button></div>
      <div class="order-card-body">
        <div class="order-state ${order.viewStatus.tone}">${order.viewStatus.label}</div>
        <div class="order-product">
          <img src="${escapeHTML(image)}" alt="" />
          <div><strong>${escapeHTML(order.productName)}</strong><span>${paymentLabel(order)} · ${Number(order.quantity) || 1}개</span><b>${Number(order.price || 0).toLocaleString("ko-KR")}원</b></div>
        </div>
        <div class="order-actions ${actions.length === 3 ? "has-three-actions" : ""}">${actions.join("")}</div>
      </div>
    </article>`;
  }

  function render() {
    const orders = filteredOrders();
    requestAnimationFrame(() => {
      results.querySelectorAll("[data-order-id]").forEach((button) => {
        button.onclick = () => openDetail(button.dataset.orderId);
      });
    });
    results.innerHTML = orders.length ? orders.map(cardHTML).join("") : `<div class="order-empty"><strong>해당하는 주문이 없어요</strong><p>검색어나 상태 필터를 다시 확인해 주세요.</p></div>`;
  }

  function openDetail(orderId) {
    const order = orderData().find((item) => String(item.id) === String(orderId));
    if (!order) return;
    const image = order.product?.image || "./asset-bundle-food-gradient.png";
    detailContent.innerHTML = `<div class="detail-order-number"><span>${dateLabel(orderedAt(order))} 신청</span><small>주문번호 ${escapeHTML(order.id)}</small></div>
      <section class="detail-product"><div class="order-state ${order.viewStatus.tone}">${order.viewStatus.label}</div><div><img src="${escapeHTML(image)}" alt=""><div><strong>${escapeHTML(order.productName)}</strong><span>${Number(order.quantity) || 1}개</span><b>${Number(order.price || 0).toLocaleString("ko-KR")}원</b></div></div></section>
      <section class="detail-section"><h3>주문 정보</h3><dl><div><dt>주문일</dt><dd>${dateLabel(orderedAt(order))}</dd></div><div><dt>지정 수령일</dt><dd>${dateLabel(selectedPickupDate(order))}${order.pickupTime ? ` · ${escapeHTML(order.pickupTime)}` : ""}</dd></div><div><dt>결제 방식</dt><dd>${paymentLabel(order)}</dd></div><div><dt>수령 상태</dt><dd>${order.viewStatus.label}</dd></div><div><dt>결제 금액</dt><dd><strong>${Number(order.price || 0).toLocaleString("ko-KR")}원</strong></dd></div></dl></section>
      ${canCustomerCancel(order) ? `<div class="detail-cancel-guide"><span>신청 마감 전까지 취소할 수 있어요.</span><button type="button" data-cancel-order="${escapeHTML(order.id)}">신청 취소</button></div>` : ""}
      ${order.viewStatus.group === "progress" ? `<a class="detail-primary" href="./main.html#receipt">수령 확인증 보기</a>` : ""}`;
    detail.classList.add("is-visible");
    detail.setAttribute("aria-hidden", "false");
  }

  function closeDetail() { detail.classList.remove("is-visible"); detail.setAttribute("aria-hidden", "true"); }
  function showToast(message) { toast.textContent = message; toast.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2000); }

  function requestCustomerCancel(orderId) {
    const order = orderData().find((item) => String(item.id) === String(orderId));
    if (!order || !canCustomerCancel(order)) {
      showToast("신청 마감 후에는 주문을 취소할 수 없어요.");
      render();
      return;
    }
    pendingCancelOrderId = order.id;
    cancelConfirm.classList.add("is-visible");
    cancelConfirm.setAttribute("aria-hidden", "false");
  }

  async function confirmCustomerCancel() {
    const order = orderData().find((item) => String(item.id) === String(pendingCancelOrderId));
    closeCancelConfirm();
    if (!order || !canCustomerCancel(order)) {
      showToast("신청 마감 후에는 주문을 취소할 수 없어요.");
      render();
      return;
    }
    const token = accessToken();
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(order.id)) && token) {
      try {
        const response = await fetch(`${location.origin}/api/orders/${encodeURIComponent(order.id)}/cancel`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ reason: "고객 직접 취소" })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "주문을 취소하지 못했습니다.");
      } catch (error) {
        showToast(error.message || "주문을 취소하지 못했습니다.");
        return;
      }
    }
    window.FridgeDB.updateOrder(order.id, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelReason: "고객 직접 취소",
      cancelledBy: "customer",
      refundStatus: order.paymentType === "transfer" && order.transferApproved ? "pending" : null
    });
    if (order.product) {
      const restoredStock = Number(order.product.stock || 0) + (Number(order.quantity) || 1);
      const totalStock = Number(order.product.totalStock || 0);
      window.FridgeDB.updateProduct(order.product.id, {
        stock: totalStock > 0 ? Math.min(restoredStock, totalStock) : restoredStock
      });
    }
    closeDetail();
    render();
    showToast("주문 신청을 취소했어요.");
  }

  function closeCancelConfirm() {
    pendingCancelOrderId = null;
    cancelConfirm.classList.remove("is-visible");
    cancelConfirm.setAttribute("aria-hidden", "true");
  }

  document.addEventListener("click", (event) => {
    const cancelAnswer = event.target.closest("[data-cancel-answer]")?.dataset.cancelAnswer;
    if (cancelAnswer === "yes") {
      confirmCustomerCancel();
      return;
    }
    if (cancelAnswer === "no") {
      closeCancelConfirm();
      return;
    }
    const cancelButton = event.target.closest("[data-cancel-order]");
    if (cancelButton) {
      requestCustomerCancel(cancelButton.dataset.cancelOrder);
      return;
    }
    const filter = event.target.closest("[data-order-filter]");
    if (filter) {
      activeFilter = filter.dataset.orderFilter;
      document.querySelectorAll("[data-order-filter]").forEach((button) => button.classList.toggle("is-active", button === filter));
      render();
    }
    const orderButton = event.target.closest("[data-order-id]");
    if (orderButton) openDetail(orderButton.dataset.orderId);
    if (event.target.closest("[data-detail-close]")) closeDetail();
  });

  searchInput.addEventListener("input", render);
  window.addEventListener("storage", render);
  render();
})();
