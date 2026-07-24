(function () {
  const $ = (selector) => document.querySelector(selector);
  const modal = $("#my-modal");
  const modalTitle = $("#my-modal-title");
  const modalContent = $("#my-modal-content");
  const toast = $("#my-toast");
  const SETTINGS_KEY = "todayFridgeNotificationSettings";
  const AUTH_KEY = "todayFridgeAuthSession";
  let toastTimer;
  let authClient;

  const defaultSettings = { arrival: true, inquiry: true };

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
  }
  function settings() { return { ...defaultSettings, ...readJSON(SETTINGS_KEY, {}) }; }
  function authSession() {
    const saved = readJSON(AUTH_KEY, null);
    return saved || { loggedIn: true, provider: "kakao" };
  }
  function isLoggedIn() { return authSession().loggedIn !== false; }
  function accessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const value = readJSON(key, null);
      const token = value?.access_token || value?.currentSession?.access_token;
      if (token) return token;
    }
    return null;
  }
  async function refreshedAccessToken() {
    if (!window.supabase?.createClient) return null;
    try {
      if (!authClient) {
        const response = await fetch("/api/config");
        const config = await response.json();
        if (!response.ok || !config.supabaseUrl || !config.supabasePublishableKey) return null;
        authClient = window.supabase.createClient(
          config.supabaseUrl,
          config.supabasePublishableKey
        );
      }
      const { data } = await authClient.auth.getSession();
      const token = data?.session?.access_token || null;
      if (token) localStorage.setItem("todayFridgeAccessToken", token);
      return token;
    } catch (_) {
      return null;
    }
  }
  async function updateAdminMenu() {
    const link = $("#admin-menu-link");
    if (!link || !isLoggedIn()) return;
    let token = accessToken() || await refreshedAccessToken();
    if (!token) return;
    try {
      let response = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.status === 401) {
        token = await refreshedAccessToken();
        if (!token) {
          link.hidden = true;
          return;
        }
        response = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      const result = await response.json();
      link.hidden = !(response.ok && result.profile?.role === "admin");
    } catch (_) {
      link.hidden = true;
    }
  }
  function renderAccount() {
    const account = window.FridgeDB.getUserAccount();
    const name = account?.name || "고객";
    $("#my-user-name").textContent = name;
    $(".profile-avatar").textContent = name.slice(0, 1);
    $("#my-account-provider").textContent = account?.provider === "google"
      ? "Google 계정으로 로그인"
      : "카카오 계정으로 로그인";
  }
  function renderAuthState() {
    const loggedIn = isLoggedIn();
    $("#member-profile").hidden = !loggedIn;
    $("#guest-profile").hidden = loggedIn;
    document.querySelectorAll("[data-auth-only]").forEach((element) => {
      element.hidden = !loggedIn;
    });
  }
  function updateSummary() {
    const status = $("#push-menu-status");
    if (!window.isSecureContext) status.textContent = "배포 후 연결 가능";
    else if (!("Notification" in window)) status.textContent = "이 기기에서 지원하지 않음";
    else if (Notification.permission === "granted") status.textContent = "웹 푸시 사용 중";
    else if (Notification.permission === "denied") status.textContent = "기기 알림 꺼짐";
    else status.textContent = "기기 알림 설정 필요";
  }
  function showToast(message) {
    toast.textContent = message; toast.classList.add("is-visible");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }
  function openModal(title, html) {
    modalTitle.textContent = title; modalContent.innerHTML = html;
    modal.classList.add("is-visible"); modal.setAttribute("aria-hidden", "false");
  }
  function closeModal() { modal.classList.remove("is-visible"); modal.setAttribute("aria-hidden", "true"); }

  function notificationSettingsHTML() {
    const value = settings();
    const permissionText = !window.isSecureContext ? "HTTPS 배포 후 연결 가능" : ("Notification" in window && Notification.permission === "granted" ? "이 기기 알림 사용 중" : "기기 알림 허용 필요");
    const rows = [
      ["arrival", "신청 상품 입고", "신청한 상품의 입고가 완료되면 알려드려요"],
      ["inquiry", "문의 답변", "문의에 최초 답변이 등록되면 알려드려요"]
    ].map(([key, title, detail]) => `<div class="my-setting-row"><span><strong>${title}</strong><small>${detail}</small></span><button class="setting-switch ${value[key] ? "is-on" : ""}" type="button" role="switch" aria-checked="${value[key]}" data-setting="${key}"><i></i></button></div>`).join("");
    return `<div class="push-status-card"><span class="status-dot"></span><div><strong>${permissionText}</strong><small>알림은 신청한 주문과 내 문의에 대해서만 보내요.</small></div></div>${rows}<button class="my-primary-button" type="button" data-enable-push>이 기기에서 알림 받기</button><p class="setting-note">아이폰은 사이트를 홈 화면에 추가한 후 알림을 허용해야 해요. 사이트 안 알림 센터에는 설정과 관계없이 이용 내역이 남아요.</p>`;
  }
  function inquiryHTML() {
    const products = window.FridgeDB.getProducts();
    const list = products.flatMap((product) => {
      try { return JSON.parse(localStorage.getItem(`todayFridgeInquiries_${product.id}`) || "[]").map((item) => ({ ...item, productName: product.name })); } catch (_) { return []; }
    });
    if (!list.length) return `<div class="my-empty"><strong>아직 문의 내역이 없어요</strong><p>상품 상세 화면에서 궁금한 점을 문의할 수 있어요.</p></div>`;
    return list.map((item) => `<article class="my-content-card"><strong>${item.productName}</strong><p>${item.text || item.content || "문의 내용"}</p><small>${item.reply ? `답변: ${item.reply}` : "답변 대기 중"}</small></article>`).join("");
  }

  function openRequestedSection() {
    if (window.location.hash !== "#inquiries") return;
    openModal("1:1 문의 내역", inquiryHTML());
  }

  document.addEventListener("click", async (event) => {
    if (event.target.closest("[data-modal-close]")) return closeModal();
    const action = event.target.closest("[data-my-action]")?.dataset.myAction;
    const account = window.FridgeDB.getUserAccount();
    if (action === "profile") openModal("정보 수정", `<form class="my-form" id="profile-form"><label>이름<input id="profile-name" value="${account?.name || ""}" maxlength="12" required></label><div class="linked-account"><span>연결된 계정</span><strong>${account?.provider === "google" ? "Google" : "카카오"} · ${account?.email || "계정 정보 없음"}</strong><small>로그인 계정은 변경할 수 없어요.</small></div><button class="my-primary-button" type="submit">저장하기</button></form>`);
    if (action === "inquiries") openModal("1:1 문의 내역", inquiryHTML());
    if (action === "notifications") openModal("알림 설정", notificationSettingsHTML());

    const settingButton = event.target.closest("[data-setting]");
    if (settingButton) {
      const value = settings(); const key = settingButton.dataset.setting;
      value[key] = !value[key]; localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
      settingButton.classList.toggle("is-on", value[key]); settingButton.setAttribute("aria-checked", String(value[key]));
      showToast(value[key] ? "알림을 켰어요." : "알림을 껐어요.");
    }
    if (event.target.closest("[data-enable-push]")) {
      if (!window.isSecureContext) return showToast("사이트 배포 후 알림을 연결할 수 있어요.");
      if (!("Notification" in window)) return showToast("이 기기는 웹 푸시를 지원하지 않아요.");
      const result = await Notification.requestPermission(); updateSummary();
      showToast(result === "granted" ? "기기 알림을 허용했어요." : "브라우저 설정에서 알림을 허용해 주세요.");
      openModal("알림 설정", notificationSettingsHTML());
    }
    if (event.target.closest("[data-logout]")) {
      localStorage.setItem(AUTH_KEY, JSON.stringify({ loggedIn: false }));
      closeModal();
      renderAuthState();
      showToast("로그아웃했어요.");
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "profile-form") return;
    event.preventDefault();
    const name = $("#profile-name").value.trim();
    if (!name) return;
    window.FridgeDB.updateUserAccount({ name });
    renderAccount(); closeModal(); showToast("회원 정보를 저장했어요.");
  });

  renderAccount(); renderAuthState(); updateSummary(); updateAdminMenu();
  if (isLoggedIn()) openRequestedSection();
})();
