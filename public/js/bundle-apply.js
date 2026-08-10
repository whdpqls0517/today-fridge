(async function () {
  const orderRequestStorageKey = `todayFridgeOrderRequest:${location.search}`;
  const orderRequestKey = sessionStorage.getItem(orderRequestStorageKey)
    || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  sessionStorage.setItem(orderRequestStorageKey, orderRequestKey);
  // 1. URL 파라미터 및 기본 데이터 추출
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const isWaitlist = params.get("mode") === "waitlist";
  if (window.FridgeDB?.catalogReady) await window.FridgeDB.catalogReady;
  const product = window.FridgeDB?.getProducts().find((p) => p.id === id);
  const form = document.getElementById("bundle-apply-form");
  let quantity = 1;
  let selectedItems = [];
  if (!isWaitlist && Array.isArray(product?.options) && product.options.length) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(`todayFridgeBundleSelection:${id}`) || "[]");
      selectedItems = stored.map((item) => {
        const option = product.options.find((candidate) => candidate.id === item.optionId);
        if (!option) return null;
        const maximum = Math.min(Number(option.stock || 0), Number(option.maxQuantity || option.stock || 0));
        const selectedQuantity = Math.max(0, Math.min(maximum, Number(item.quantity) || 0));
        return selectedQuantity ? { optionId: option.id, name: option.name, price: Number(option.price), quantity: selectedQuantity } : null;
      }).filter(Boolean);
    } catch (_) { selectedItems = []; }
  }

  // 인증 토큰 추출 도구
  const getToken = () => {
    const directToken = localStorage.getItem("todayFridgeAccessToken");
    if (directToken) return directToken;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("sb-") && key.endsWith("-auth-token")) {
        try {
          const parsed = JSON.parse(localStorage.getItem(key));
          if (parsed?.access_token) return parsed.access_token;
          if (parsed?.currentSession?.access_token) return parsed.currentSession.access_token;
        } catch (_) {}
      }
    }
    return null;
  };

  // 날짜 ISO 문자열 변환 (YYYY-MM-DD)
  const toISODate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // 2. 수량 및 결제금액 렌더링 함수
  function renderAmount() {
    if (selectedItems.length) {
      const total = selectedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      document.getElementById("apply-amount").textContent = `${total.toLocaleString("ko-KR")}원`;
      return;
    }
    const stock = Math.max(0, Number(product?.stock) || 0);
    const maxPerUser = Math.max(1, Number(product?.maxQuantity) || 10);
    const maxAllowed = isWaitlist ? maxPerUser : Math.max(1, Math.min(maxPerUser, stock || 1));

    document.getElementById("apply-quantity").textContent = quantity;
    document.getElementById("apply-amount").textContent = `${(
      Number(product?.price || 0) * quantity
    ).toLocaleString("ko-KR")}원`;

    const btnMinus = document.querySelector('[data-quantity="-1"]');
    const btnPlus = document.querySelector('[data-quantity="1"]');

    if (btnMinus) btnMinus.disabled = quantity <= 1;
    if (btnPlus) btnPlus.disabled = (!isWaitlist && stock <= 0) || quantity >= maxAllowed;
  }

  // 3. 예외 처리: 보따리 상품이 아니거나 존재하지 않는 경우
  if (!product || product.category !== "bundle") {
    if (form) form.hidden = true;
    document.getElementById("apply-message").textContent = "신청 가능한 보따리 상품이 아닙니다.";
    return;
  }

  // 4. 상품 정보 및 픽업 날짜 옵션 UI 구성
  document.getElementById("apply-product").innerHTML = `
    <img src="${product.image}" alt="">
    <div>
      <strong>${product.name}</strong>
      <span>${selectedItems.length
        ? `${selectedItems.length}종 · 총 ${selectedItems.reduce((sum, item) => sum + item.quantity, 0)}개`
        : isWaitlist
        ? `1개 ${Number(product.price).toLocaleString("ko-KR")}원 · 취소 수량 발생 시 선착순 자동 신청`
        : `1개 ${Number(product.price).toLocaleString("ko-KR")}원 · 남은 수량 ${product.stock}개`}</span>
    </div>
  `;

  if (Array.isArray(product.options) && product.options.length && !isWaitlist) {
    if (!selectedItems.length) {
      document.getElementById("apply-message").textContent = "상품 상세에서 신청할 옵션을 먼저 선택해 주세요.";
      setTimeout(() => history.back(), 700);
      return;
    }
    document.getElementById("apply-quantity-section").hidden = true;
    document.getElementById("apply-selected-section").hidden = false;
    document.getElementById("apply-selected-list").innerHTML = selectedItems.map((item) => `
      <div class="apply-selected-item"><div><strong>${String(item.name).replace(/[&<>"']/g, "")}</strong><small>${item.quantity}개 × ${item.price.toLocaleString("ko-KR")}원</small></div><strong>${(item.price * item.quantity).toLocaleString("ko-KR")}원</strong></div>
    `).join("");
    document.getElementById("apply-option-change").onclick = () => history.back();
  }

  if (isWaitlist) {
    document.querySelector(".apply-page header h1").textContent = "보따리 대기 신청";
    const headings = document.querySelectorAll(".apply-heading");
    if (headings[0]) headings[0].querySelector("p").textContent = "원하는 수량을 미리 입력해 주세요.";
    document.querySelector(".amount-box > div > span").textContent = "자동 신청 예정 금액";
    document.querySelector(".amount-box > p").textContent = "취소 수량이 확보되면 이 정보로 주문이 자동 접수됩니다.";
    const agreementText = document.getElementById("procurement-agreement-text");
    if (agreementText) {
      agreementText.textContent =
        "주문 내용 및 대기 신청 유의사항을 확인했습니다. (필수)";
    }
    document.getElementById("agreement-details")?.insertAdjacentHTML(
      "beforeend",
      "<li>취소 수량이 확보되면 입력한 정보와 선택 수량을 기준으로 먼저 신청한 순서대로 주문이 자동 접수됩니다.</li>"
    );
    document.querySelector(".apply-submit").textContent = "대기 신청하기";
    document.getElementById("apply-message").textContent =
      "대기 신청은 재고를 확보하지 않으며, 먼저 신청한 순서대로 자동 전환됩니다.";
  }

  const startMatch = String(product.pickupDate || "").match(/(20\d{2})-(\d{2})-(\d{2})/);
  const startDate = startMatch
    ? new Date(+startMatch[1], +startMatch[2] - 1, +startMatch[3])
    : new Date();
  const daysOfWeek = ["일", "월", "화", "수", "목", "금", "토"];
  const dateOptions = [];

  for (let n = 0; n < 7; n++) {
    const dateObj = new Date(startDate);
    dateObj.setDate(dateObj.getDate() + n);
    dateOptions.push(dateObj);
  }

  document.getElementById("apply-date-options").innerHTML = dateOptions
    .map(
      (d, i) => `
    <label>
      <input type="radio" name="pickupDate" value="${toISODate(d)}" ${i === 0 ? "checked" : ""}>
      <span><b>${d.getMonth() + 1}.${d.getDate()}</b><small>${daysOfWeek[d.getDay()]}요일</small></span>
    </label>`
    )
    .join("");

  // 5. 선결제 전용 상품 옵션 처리
  if (product.prepaymentOnly) {
    const onsiteInput = document.querySelector('input[value="onsite"]');
    if (onsiteInput) onsiteInput.disabled = true;
    document.getElementById("onsite-choice")?.classList.add("is-disabled");

    const transferInput = document.querySelector('input[value="transfer"]');
    if (transferInput) transferInput.checked = true;

    document.getElementById("payment-help").textContent = "신선도 관리 상품으로 선결제만 가능합니다.";
  }

  // 6. 결제 수단 수동 변경 시 입금자명 입력란 노출 여부
  function updatePaymentUI() {
    const selectedPayment = document.querySelector('input[name="paymentType"]:checked')?.value;
    document.getElementById("depositor-field").hidden = selectedPayment !== "transfer";
  }

  document.querySelectorAll('input[name="paymentType"]').forEach((el) => {
    el.addEventListener("change", updatePaymentUI);
  });
  updatePaymentUI();

  // 7. 수량 변경 버튼 이벤트
  document.querySelectorAll("[data-quantity]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stock = Math.max(0, Number(product.stock) || 0);
      const maxPerUser = Math.max(1, Number(product.maxQuantity) || 10);
      const maxAllowed = isWaitlist ? maxPerUser : Math.max(1, Math.min(maxPerUser, stock || 1));
      quantity = Math.max(1, Math.min(maxAllowed, quantity + Number(btn.dataset.quantity)));
      renderAmount();
    });
  });
  renderAmount();

  const agreementInput = document.getElementById("apply-agreement");
  const submitButton = document.querySelector(".apply-submit");
  function syncAgreementState() {
    const noStock = !isWaitlist && (Number(product.stock) || 0) <= 0;
    if (submitButton) submitButton.disabled = noStock || !agreementInput?.checked;
  }
  agreementInput?.addEventListener("change", syncAgreementState);
  syncAgreementState();

  // 8. 품절 처리
  if (!isWaitlist && (Number(product.stock) || 0) <= 0) {
    const submitBtn = document.querySelector(".apply-submit");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "신청 가능한 수량이 없어요";
    }
    document.getElementById("apply-message").textContent = "재고가 추가되면 다시 신청할 수 있어요.";
  }

  // 뒤로 가기
  const backBtn = document.querySelector("[data-apply-back]");
  if (backBtn) backBtn.onclick = () => history.back();

  // ====================================================
  // 9. 🚨 폼 제출 이벤트 (로그인 가드 추가 적용)
  // ====================================================
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    // 🔒 [로그인 가드] 로그인 여부 검증
    // 비로그인 상태일 경우 안내 경고창 출력 후 index.html로 리다이렉트합니다.
    if (window.FridgeAuth) {
      const user = await window.FridgeAuth.requireLogin(e);
      if (!user) return; // 미로그인 시 신청 절차 차단
    }

    const paymentType = document.querySelector('input[name="paymentType"]:checked')?.value;
    const pickupDate = document.querySelector('input[name="pickupDate"]:checked')?.value;
    const pickupTimeLabel = document.querySelector('input[name="pickupTime"]:checked')?.value;
    const depositorName =
      document.getElementById("depositor-name")?.value.trim() ||
      window.FridgeDB?.getUserAccount()?.name ||
      "";

    const payload = {
      bundleItemId: product.bundleItemId,
      ...(selectedItems.length ? { items: selectedItems.map(({ optionId, quantity }) => ({ optionId, quantity })) } : { quantity }),
      paymentType,
      pickupDate,
      pickupTimeLabel,
      depositorName,
      requestKey: orderRequestKey,
      procurementPolicyConsent: document.getElementById("apply-agreement")?.checked === true,
      procurementPolicyVersion: "2026-07-29",
      waitlistAutoOrderConsent: isWaitlist
        ? document.getElementById("apply-agreement")?.checked === true
        : false,
    };

    try {
      let order;
      const authToken = getToken();

      if (isWaitlist) {
        if (!authToken || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(product.id)) {
          throw new Error("로그인 후 대기 신청을 이용해 주세요.");
        }
        const res = await fetch(`${location.origin}/api/products/${encodeURIComponent(product.id)}/waitlist`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || "대기 신청을 접수하지 못했습니다.");
        }
        order = {
          ...json.data,
          status: "waitlisted",
          isWaitlist: true
        };
        window.FridgeDB?.updateProduct(product.id, {
          waitlistRequests: Number(product.waitlistRequests || 0) + 1
        });
      } else if (product.bundleItemId && authToken) {
        // 백엔드 API 서버 사용 조건 및 토큰 존재 시 서버에 주문 생성
        const res = await fetch(`${location.origin}/api/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || "신청하지 못했습니다.");
        }
        order = json.data;
      } else {
        // 로컬 DB 전용 주문 데이터 생성
        order = {
          id: `order-${Date.now()}`,
          productId: product.id,
          bundleItemId: product.bundleItemId,
          productName: product.name,
          quantity,
          price: product.price * quantity,
          paymentType,
          transferApproved: false,
          paymentStatus: "pending",
          status: "pending",
          pickupDateISO: payload.pickupDate,
          pickupDate: payload.pickupDate,
          pickupTime: payload.pickupTimeLabel,
          depositorName: payload.depositorName,
          arrivalStatus: product.arrivalStatus,
          createdAt: new Date().toISOString(),
        };
        window.FridgeDB?.addOrder(order);
      }

      // 완료 페이지 전달용 세션 저장 후 이동
      sessionStorage.setItem(
        "todayFridgeLastOrder",
        JSON.stringify({
          ...order,
          productName: product.name,
          totalAmount: selectedItems.length
            ? selectedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
            : product.price * quantity,
          selectedItems,
          isWaitlist,
          paymentType,
          pickupDate: payload.pickupDate,
          pickupTimeLabel: payload.pickupTimeLabel,
          depositorName: payload.depositorName,
        })
      );
      sessionStorage.removeItem(orderRequestStorageKey);
      sessionStorage.removeItem(`todayFridgeBundleSelection:${id}`);

      location.href = "./bundle-apply-complete.html";
    } catch (err) {
      document.getElementById("apply-message").textContent =
        err.message || "신청하지 못했습니다.";
    }
  });
})();
