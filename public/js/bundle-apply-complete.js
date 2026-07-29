(function () {
  let order = null;
  try {
    order = JSON.parse(sessionStorage.getItem("todayFridgeLastOrder") || "null");
  } catch (_) {}

  if (!order) {
    location.replace("./order-history.html");
    return;
  }

  const waitlisted = order.isWaitlist === true || order.status === "waitlisted";
  const transfer = order.paymentType === "transfer";

  // 1. 안내 문구 변경
  const titleEl = document.querySelector(".complete-page h1");
  const guideEl = document.getElementById("complete-guide");
  if (titleEl && waitlisted) titleEl.textContent = "대기 신청이 완료되었습니다";
  if (guideEl) {
    guideEl.textContent = waitlisted
      ? "취소 수량이 확보되면 신청 순서대로 주문이 자동 접수됩니다."
      : transfer
      ? "결제가 확인되면 수령증이 활성화됩니다."
      : "매장에서 결제한 뒤 상품을 수령해 주세요.";
  }

  // 2. 주문 요약 정보 표시 (신청 상품, 수령 희망일, 결제 방식)
  const summaryEl = document.getElementById("complete-summary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div><span>신청 상품</span><strong>${order.productName || "-"}</strong></div>
      <div><span>수령 희망일</span><strong>${order.pickupDate || "-"} · ${order.pickupTimeLabel || "-"}</strong></div>
      <div><span>결제 방식</span><strong>${transfer ? "선결제" : "현장결제"}</strong></div>
      ${waitlisted ? `<div><span>현재 상태</span><strong>대기 중</strong></div>` : ""}
    `;
  }

  // 3. 결제 방식에 따른 분기 처리
  if (waitlisted) {
    const primaryAction = document.querySelector(".complete-actions .primary");
    if (primaryAction) {
      primaryAction.href = `./product-detail.html?id=${encodeURIComponent(order.product_id || "")}`;
      primaryAction.textContent = "상품으로 돌아가기";
    }
    const noteEl = document.getElementById("complete-note");
    if (noteEl) {
      noteEl.textContent =
        "지금은 결제하거나 수령할 수 없습니다. 주문 전환 시 알림을 보내드리고 주문 내역에도 자동으로 표시됩니다.";
    }
  } else if (transfer) {
    const bankBox = document.getElementById("bank-box");
    if (bankBox) bankBox.hidden = false;

    // 실제 결제 금액 계산 및 표시
    const rawAmount = Number(order.totalAmount || order.total_amount || 0);
    const formattedAmount = `${rawAmount.toLocaleString("ko-KR")}원`;

    const bankAmountEl = document.getElementById("bank-amount");
    if (bankAmountEl) bankAmountEl.textContent = formattedAmount;

    // 간편 송금 딥링크 URL 세팅 (토스 / 카카오페이)
    const bankName = "카카오뱅크";
    const accountNumber = "3333011234567"; // 계좌번호 숫자만

    const tossUrl = `supertoss://send?bank=${encodeURIComponent(bankName)}&accountNo=${accountNumber}&amount=${rawAmount}`;
    const kakaoUrl = `kakaotalk://kakaopay/money/to_account?amount=${rawAmount}`;

    const tossBtn = document.getElementById("toss-remit-btn");
    const kakaoBtn = document.getElementById("kakao-remit-btn");

    if (tossBtn) tossBtn.setAttribute("href", tossUrl);
    if (kakaoBtn) kakaoBtn.setAttribute("href", kakaoUrl);

    // 하단 안내 문구
    const noteEl = document.getElementById("complete-note");
    if (noteEl) {
      noteEl.textContent =
        "결제 확인 전에는 수령 확인증에 상품이 표시되지 않습니다. 결제 확인이 완료되면 알림으로 알려드릴게요.";
    }
  } else {
    const noteEl = document.getElementById("complete-note");
    if (noteEl) {
      noteEl.textContent =
        "상품 입고가 완료되면 수령 확인증에서 키오스크 결제용 바코드를 확인할 수 있습니다.";
    }
  }
})();

/* ==========================================
   📋 계좌번호 복사 전용 함수 (전역 등록)
   ========================================== */
window.copyAccountNumber = function (accountNo) {
  const targetText = accountNo || "3333-01-1234567";

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(targetText)
      .then(function () {
        alert("계좌번호가 복사되었습니다!");
      })
      .catch(function () {
        fallbackCopyText(targetText);
      });
  } else {
    fallbackCopyText(targetText);
  }
};

function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);

  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand("copy");
    if (successful) {
      alert("계좌번호가 복사되었습니다!");
    } else {
      alert("복사 실패: 계좌번호를 직접 선택해 주세요.");
    }
  } catch (err) {
    alert("복사 실패: 계좌번호를 직접 선택해 주세요.");
  }

  document.body.removeChild(textArea);
}
