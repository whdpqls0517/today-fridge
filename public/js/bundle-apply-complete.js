(function () {
  let order = null;
  let paymentInfo = null;

  try {
    order = JSON.parse(sessionStorage.getItem("todayFridgeLastOrder") || "null");
  } catch (_) {}

  if (!order) {
    location.replace("./order-history.html");
    return;
  }

  const waitlisted = order.isWaitlist === true || order.status === "waitlisted";
  const transfer = order.paymentType === "transfer";
  const titleEl = document.querySelector(".complete-page h1");
  const guideEl = document.getElementById("complete-guide");

  if (waitlisted) titleEl.textContent = "대기 신청이 완료되었습니다";
  guideEl.textContent = waitlisted
    ? "취소 수량이 확보되면 신청 순서대로 주문이 자동 접수됩니다."
    : transfer
      ? "입금이 확인되면 수령 확인증이 활성화됩니다."
      : "매장에서 결제한 뒤 상품을 수령해 주세요.";

  const summaryEl = document.getElementById("complete-summary");
  summaryEl.innerHTML = `
    <div><span>신청 상품</span><strong>${escapeHTML(order.productName || "-")}</strong></div>
    <div><span>수령 희망일</span><strong>${escapeHTML(order.pickupDate || "-")} · ${escapeHTML(order.pickupTimeLabel || "-")}</strong></div>
    <div><span>결제 방식</span><strong>${transfer ? "선결제 · 계좌이체" : "현장결제"}</strong></div>
    ${waitlisted ? "<div><span>현재 상태</span><strong>대기 중</strong></div>" : ""}
  `;

  if (waitlisted) {
    const primaryAction = document.querySelector(".complete-actions .primary");
    primaryAction.href = `./product-detail.html?id=${encodeURIComponent(order.product_id || order.productId || "")}`;
    primaryAction.textContent = "상품으로 돌아가기";
    document.getElementById("complete-note").textContent =
      "지금은 결제하거나 수령할 단계가 아닙니다. 주문 전환 시 알림으로 알려드리고 주문 내역에도 자동으로 표시됩니다.";
    return;
  }

  if (!transfer) {
    document.getElementById("complete-note").textContent =
      "상품 입고가 완료되면 수령 확인증에서 키오스크 결제용 바코드를 확인할 수 있습니다.";
    return;
  }

  const bankBox = document.getElementById("bank-box");
  bankBox.hidden = false;
  const rawAmount = Number(order.totalAmount || order.total_amount || 0);
  document.getElementById("bank-amount").textContent = `${rawAmount.toLocaleString("ko-KR")}원`;
  document.getElementById("complete-note").textContent =
    "입금 확인 전에는 수령 확인증에 상품이 표시되지 않습니다. 입금 확인이 완료되면 알림으로 알려드릴게요.";

  document.getElementById("copy-account-button").addEventListener("click", copyAccountNumber);
  loadPaymentInfo(rawAmount);

  async function loadPaymentInfo(amount) {
    const errorEl = document.getElementById("payment-info-error");
    try {
      const token = accessToken();
      if (!token) throw new Error("계좌 정보를 보려면 다시 로그인해 주세요.");
      const response = await fetch(`/api/payment-info?amount=${encodeURIComponent(amount)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "계좌 정보를 불러오지 못했습니다.");
      if (!result.configured || !result.data) throw new Error("입금 계좌가 아직 설정되지 않았습니다. 매장에 문의해 주세요.");

      paymentInfo = result.data;
      document.getElementById("bank-account").textContent =
        `${paymentInfo.bankName} ${paymentInfo.accountNumber}`;
      document.getElementById("bank-holder").textContent = `예금주: ${paymentInfo.accountHolder}`;

      const tossButton = document.getElementById("toss-remit-btn");
      const kakaoButton = document.getElementById("kakao-remit-btn");
      if (paymentInfo.tossUrl) {
        tossButton.href = paymentInfo.tossUrl;
        tossButton.hidden = false;
      }
      if (paymentInfo.kakaoPayUrl) {
        kakaoButton.href = paymentInfo.kakaoPayUrl;
        kakaoButton.hidden = false;
      }
      document.getElementById("remit-section").hidden = !(paymentInfo.tossUrl || paymentInfo.kakaoPayUrl);
      errorEl.hidden = true;
    } catch (error) {
      document.getElementById("bank-account").textContent = "계좌 정보를 확인할 수 없습니다";
      document.getElementById("bank-holder").textContent = "";
      document.getElementById("copy-account-button").hidden = true;
      errorEl.textContent = error.message || "계좌 정보를 불러오지 못했습니다.";
      errorEl.hidden = false;
    }
  }

  async function copyAccountNumber() {
    if (!paymentInfo?.copyNumber) return;
    try {
      await navigator.clipboard.writeText(paymentInfo.copyNumber);
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = paymentInfo.copyNumber;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    alert("계좌번호가 복사되었습니다.");
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

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]
    );
  }
})();
