(function () {
  const $ = (selector) => document.querySelector(selector);
  const modal = $("#my-modal");
  const modalTitle = $("#my-modal-title");
  const modalContent = $("#my-modal-content");
  const toast = $("#my-toast");
  const SETTINGS_KEY = "todayFridgeNotificationSettings";
  let toastTimer;
  let authClient;
  let nicknameCheckTimer;
  let nicknameAvailable = false;
  let authenticated = false;
  let pushRegistered = false;

  const defaultSettings = { enabled: false };

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }
  function settings() {
    const saved = readJSON(SETTINGS_KEY, {});
    if (typeof saved.enabled === "boolean") return { enabled: saved.enabled };
    if (typeof saved.all === "boolean") return { enabled: saved.all };
    const legacyValues = [saved.arrival, saved.inquiry, saved.important]
      .filter((value) => typeof value === "boolean");
    return { enabled: legacyValues.length ? legacyValues.some(Boolean) : defaultSettings.enabled };
  }

  function base64UrlToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  }

  function isIosDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isInAppBrowser() {
    return /NAVER|KAKAOTALK|KAKAOSTORY/i.test(navigator.userAgent);
  }

  function publicPageUrl() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  async function copyPublicPageUrl() {
    const url = publicPageUrl();
    if (!navigator.clipboard?.writeText) throw new Error("주소를 복사하지 못했어요.");
    await navigator.clipboard.writeText(url);
    return url;
  }

  async function openExternalBrowser(browser) {
    const url = await copyPublicPageUrl();
    if (isIosDevice()) {
      showToast("주소를 복사했어요. Safari 주소창에 붙여넣어 주세요.");
      return;
    }
    const target = new URL(url);
    const packageName = browser === "samsung"
      ? "com.sec.android.app.sbrowser"
      : "com.android.chrome";
    showToast(`주소를 복사했어요. ${browser === "samsung" ? "삼성 인터넷" : "Chrome"}으로 이동할게요.`);
    setTimeout(() => {
      location.href = `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=${target.protocol.replace(":", "")};package=${packageName};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    }, 180);
  }

  function externalBrowserGuideHTML() {
    const ios = isIosDevice();
    return `<div class="external-browser-guide">
      <strong>네이버·카카오톡 앱 안에서는 웹 알림을 켤 수 없어요.</strong>
      ${ios
        ? `<ol><li>아래 버튼을 눌러 주소를 복사해 주세요.</li><li>Safari를 열고 주소창에 붙여넣어 접속해 주세요.</li><li>Safari 공유 버튼을 누르고 ‘홈 화면에 추가’를 선택해 주세요.</li><li>홈 화면의 오늘의 냉장고 아이콘으로 접속해 로그인해 주세요.</li><li>마이페이지 → 알림 설정에서 ‘전체 알림 받기’를 켜 주세요.</li></ol>`
        : `<ol><li>아래에서 사용할 브라우저를 직접 선택해 주세요.</li><li>버튼을 누르면 주소도 함께 복사돼요.</li><li>앱이 열리지 않으면 해당 브라우저 주소창에 붙여넣어 주세요.</li><li>로그인한 뒤 마이페이지 → 알림 설정에서 ‘전체 알림 받기’를 켜 주세요.</li></ol>`}
      ${ios
        ? `<button class="my-primary-button" type="button" data-open-external-browser="copy">주소 복사하기</button>`
        : `<div class="external-browser-actions"><button type="button" data-open-external-browser="chrome">Chrome으로 열기</button><button type="button" data-open-external-browser="samsung">삼성 인터넷으로 열기</button></div>`}
      <small>외부 브라우저로 로그인 정보는 전달되지 않으며, 다시 로그인이 필요할 수 있어요.</small>
    </div>`;
  }

  async function saveNotificationSettings(value) {
    const token = accessToken() || await refreshedAccessToken();
    if (!token) throw new Error("로그인 후 알림 설정을 변경해 주세요.");
    const response = await fetch("/api/profile/notification-settings", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(value)
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "알림 설정을 저장하지 못했습니다.");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(result.data));
    return result.data;
  }

  async function enableWebPush() {
    const isIos = isIosDevice();
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
    if (!window.isSecureContext) {
      throw new Error("알림은 https로 시작하는 보안 주소에서만 받을 수 있어요.");
    }
    if (isInAppBrowser()) {
      throw new Error(isIos
        ? "네이버·카카오톡 앱 안에서는 웹 푸시를 지원하지 않아요. 메뉴에서 ‘Safari로 열기’를 선택한 뒤 홈 화면에 추가해 주세요."
        : "네이버·카카오톡 앱 안에서는 웹 푸시를 지원하지 않아요. 메뉴에서 ‘다른 브라우저로 열기’를 선택해 Chrome 또는 삼성 인터넷에서 알림을 켜 주세요.");
    }
    if (isIos && !isStandalone) {
      throw new Error("아이폰은 Safari 공유 버튼에서 ‘홈 화면에 추가’한 뒤, 설치된 아이콘으로 열어 알림을 켜 주세요.");
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      throw new Error("현재 브라우저는 웹 푸시를 지원하지 않아요. Android는 Chrome, iPhone은 홈 화면에 추가한 앱에서 열어 주세요.");
    }
    if (Notification.permission === "denied") {
      throw new Error("Chrome 주소창의 사이트 설정 → 알림을 허용으로 바꾼 뒤 페이지를 새로고침해 주세요.");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("브라우저 알림 권한을 허용해 주세요.");
    const configResponse = await fetch("/api/push/config", { cache: "no-store" });
    const config = await configResponse.json();
    if (!configResponse.ok || !config.enabled || !config.publicKey) {
      throw new Error("서버에 웹 푸시 키 설정이 필요합니다.");
    }
    const registration = await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;
    let existing = await registration.pushManager.getSubscription();
    if (existing?.options?.applicationServerKey) {
      const currentKey = Array.from(new Uint8Array(existing.options.applicationServerKey));
      const expectedKey = Array.from(base64UrlToUint8Array(config.publicKey));
      if (currentKey.length !== expectedKey.length || currentKey.some((value, index) => value !== expectedKey[index])) {
        await existing.unsubscribe();
        existing = null;
      }
    }
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.publicKey)
    });
    const token = accessToken() || await refreshedAccessToken();
    if (!token) throw new Error("로그인 후 알림을 신청해 주세요.");
    const response = await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(subscription.toJSON())
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "푸시 구독을 저장하지 못했습니다.");
    pushRegistered = true;
    return true;
  }

  async function disableWebPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      pushRegistered = false;
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration("/service-worker.js");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      pushRegistered = false;
      return;
    }
    const token = accessToken() || await refreshedAccessToken();
    if (token) {
      await fetch("/api/push/subscriptions", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
    }
    await subscription.unsubscribe();
    pushRegistered = false;
  }

  async function loadPushRegistrationStatus() {
    if (!isLoggedIn()) {
      pushRegistered = false;
      return false;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      pushRegistered = false;
      return false;
    }
    const registration = await navigator.serviceWorker.getRegistration("/service-worker.js");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      pushRegistered = false;
      return false;
    }
    const token = accessToken() || await refreshedAccessToken();
    if (!token) return false;
    try {
      const response = await fetch(`/api/push/subscriptions/status?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const result = await response.json();
      pushRegistered = response.ok && result.success && result.registered === true;
      return pushRegistered;
    } catch (_) {
      pushRegistered = false;
      return false;
    }
  }
  function isLoggedIn() { return authenticated; }
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
    if (window.TodayFridgeAuth) {
      return window.TodayFridgeAuth.getAccessToken(true);
    }
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
      if (response.ok && result.profile?.notification_settings) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(result.profile.notification_settings));
      }
      link.hidden = !(response.ok && result.profile?.role === "admin");
    } catch (_) {
      link.hidden = true;
    }
  }
  async function loadAuthenticatedProfile() {
    let token = accessToken() || await refreshedAccessToken();
    if (!token) {
      authenticated = false;
      window.FridgeDB.clearAuthenticatedUser();
      return null;
    }
    try {
      let response = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      if (response.status === 401) {
        token = await refreshedAccessToken();
        if (!token) throw new Error("unauthorized");
        response = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store"
        });
      }
      const result = await response.json();
      if (!response.ok || !result.success || !result.profile) throw new Error("unauthorized");
      authenticated = true;
      window.FridgeDB.bindAuthenticatedUser({
        id: result.user.id,
        email: result.user.email || "",
        name: result.profile.name || "",
        nickname: result.profile.nickname || "",
        provider: result.profile.login_provider,
        role: result.profile.role,
        noShowStack: result.profile.no_show_count
      });
      if (result.profile.notification_settings) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(result.profile.notification_settings));
      }
      return result.profile;
    } catch (_) {
      authenticated = false;
      localStorage.removeItem("todayFridgeAccessToken");
      window.FridgeDB.clearAuthenticatedUser();
      return null;
    }
  }
  function renderAccount() {
    const account = window.FridgeDB.getUserAccount();
    const name = account?.name || "고객";
    $("#my-user-name").textContent = name;
    $(".profile-avatar").textContent = name.slice(0, 1);
    $("#my-account-provider").textContent = "카카오 계정으로 로그인";
    const noShowCount = Math.max(0, Number(account?.noShowStack) || 0);
    const noShowElement = $("#my-noshow-count");
    noShowElement.textContent = `노쇼 누적 ${noShowCount}회`;
    noShowElement.classList.toggle("is-restricted", noShowCount >= 3);
  }
  function renderAuthState() {
    const loggedIn = isLoggedIn();
    $("#member-profile").hidden = !loggedIn;
    $("#guest-profile").hidden = loggedIn;
    document.querySelectorAll("[data-auth-only]").forEach((element) => {
      element.hidden = !loggedIn;
    });
  }
  async function updateSummary() {
    const status = $("#push-menu-status");
    if (!window.isSecureContext) status.textContent = "배포 후 연결 가능";
    else if (!("Notification" in window)) status.textContent = "이 기기에서 지원하지 않음";
    else if (Notification.permission === "granted") {
      await loadPushRegistrationStatus();
      status.textContent = pushRegistered ? "웹 푸시 사용 중" : "알림 연결 필요";
    }
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

  async function checkProfileNickname() {
    const input = $("#profile-name");
    const status = $("#profile-nickname-status");
    const submit = $("#profile-form .my-primary-button");
    if (!input || !status || !submit) return false;
    const nickname = input.value.normalize("NFKC").trim();
    $("#profile-nickname-count").textContent = `${nickname.length}/12`;
    nicknameAvailable = false;
    submit.disabled = true;
    if (!/^[가-힣A-Za-z0-9_]{2,12}$/.test(nickname)) {
      status.textContent = "한글·영문·숫자·밑줄로 2~12자까지 입력해 주세요.";
      status.className = "profile-nickname-status is-error";
      return false;
    }
    let token = accessToken() || await refreshedAccessToken();
    try {
      const response = await fetch(`/api/profile/nickname-availability?nickname=${encodeURIComponent(nickname)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error);
      nicknameAvailable = result.available === true;
      status.textContent = nicknameAvailable
        ? "사용할 수 있는 닉네임이에요."
        : "이미 사용 중인 닉네임입니다.";
      status.className = `profile-nickname-status ${nicknameAvailable ? "is-valid" : "is-error"}`;
      submit.disabled = !nicknameAvailable;
      return nicknameAvailable;
    } catch (error) {
      status.textContent = error.message || "닉네임을 확인하지 못했습니다.";
      status.className = "profile-nickname-status is-error";
      return false;
    }
  }

  function notificationSettingsHTML() {
    const value = settings();
    const enabled = value.enabled && pushRegistered;
    const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const isInAppBrowser = /NAVER|KAKAOTALK|KAKAOSTORY/i.test(navigator.userAgent);
    const permissionText = !window.isSecureContext
      ? "HTTPS 배포 후 연결 가능"
      : (!pushSupported
        ? (isInAppBrowser ? "외부 브라우저에서 알림을 켜 주세요" : "이 브라우저는 웹 푸시 미지원")
        : (Notification.permission === "granted"
        ? (pushRegistered ? "이 기기 알림 사용 중" : "알림 연결을 완료해 주세요")
        : "기기 알림 허용 필요"));
    const toggle = `<div class="my-setting-row"><span><strong>전체 알림 받기</strong><small>입고, 입금 확인, 주문 변경, 문의 답변과 새 보따리 소식을 모두 받아요.</small></span><button class="setting-switch ${enabled ? "is-on" : ""}" type="button" role="switch" aria-checked="${enabled}" data-all-notifications><i></i></button></div>`;
    return `<div class="push-status-card"><span class="status-dot"></span><div><strong>${permissionText}</strong><small>${pushRegistered ? "이 브라우저가 서버의 알림 대상에 등록되어 있어요." : "전체 알림을 켜면 브라우저 허용과 서버 연결을 함께 진행해요."}</small></div></div>${toggle}<aside class="push-browser-guide"><strong>알림이 켜지지 않나요?</strong><p>네이버·카카오톡 앱 안에서는 웹 알림을 지원하지 않아요. Android는 메뉴의 ‘다른 브라우저로 열기’를 눌러 Chrome 또는 삼성 인터넷에서 접속해 주세요. iPhone은 Safari로 연 뒤 홈 화면에 추가해 주세요.</p></aside><p class="setting-note">처음에 건너뛰었어도 언제든 이 토글을 켜서 다시 연결할 수 있어요. 알림을 꺼도 사이트 안 알림센터에는 이용 내역이 남아요.</p>`;
  }
  async function inquiryHTML() {
    const token = accessToken() || await refreshedAccessToken();
    if (!token) return `<div class="my-empty"><strong>로그인이 필요해요</strong><p>로그인 후 문의 내역을 확인해 주세요.</p></div>`;
    const response = await fetch("/api/inquiries", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "문의 내역을 불러오지 못했습니다.");
    const list = result.data || [];
    if (!list.length) return `<div class="my-empty"><strong>아직 문의 내역이 없어요</strong><p>상품 상세 화면에서 궁금한 점을 문의할 수 있어요.</p></div>`;
    return list.map((item) => `<article class="my-content-card"><strong>${escapeHTML(item.products?.name || "상품 문의")}</strong><p>${escapeHTML(item.content || "문의 내용")}</p><small>${item.answer ? `답변: ${escapeHTML(item.answer)}` : "답변 대기 중"}</small></article>`).join("");
  }

  async function openRequestedSection() {
    if (window.location.hash !== "#inquiries") return;
    openModal("1:1 문의 내역", `<div class="my-empty"><p>문의 내역을 불러오는 중이에요.</p></div>`);
    try {
      modalContent.innerHTML = await inquiryHTML();
    } catch (error) {
      modalContent.innerHTML = `<div class="my-empty"><strong>문의 내역을 불러오지 못했어요</strong><p>${escapeHTML(error.message)}</p></div>`;
    }
  }

  document.addEventListener("click", async (event) => {
    if (event.target.closest("[data-modal-close]")) return closeModal();
    if (event.target.closest("[data-open-external-browser]")) {
      try {
        await openExternalBrowser(event.target.closest("[data-open-external-browser]").dataset.openExternalBrowser);
      } catch (error) {
        showToast(error.message || "주소를 복사하지 못했어요. onaeng.com을 직접 입력해 주세요.");
      }
      return;
    }
    const action = event.target.closest("[data-my-action]")?.dataset.myAction;
    const account = window.FridgeDB.getUserAccount();
    if (action === "profile") {
      nicknameAvailable = false;
      openModal("정보 수정", `<form class="my-form" id="profile-form"><label>닉네임<div class="profile-nickname-field"><input id="profile-name" value="${account?.name || ""}" minlength="2" maxlength="12" autocomplete="nickname" required><span id="profile-nickname-count">${String(account?.name || "").length}/12</span></div><small class="profile-nickname-status" id="profile-nickname-status">입력한 닉네임의 중복 여부를 확인해요.</small></label><div class="linked-account"><span>연결된 계정</span><strong>카카오 · ${account?.email || "계정 정보 없음"}</strong><small>로그인 계정은 변경할 수 없어요.</small></div><button class="my-primary-button" type="submit" disabled>저장하기</button></form>`);
      checkProfileNickname();
    }
    if (action === "inquiries") {
      openModal("1:1 문의 내역", `<div class="my-empty"><p>문의 내역을 불러오는 중이에요.</p></div>`);
      try {
        modalContent.innerHTML = await inquiryHTML();
      } catch (error) {
        modalContent.innerHTML = `<div class="my-empty"><strong>문의 내역을 불러오지 못했어요</strong><p>${escapeHTML(error.message)}</p></div>`;
      }
    }
    if (action === "notifications") {
      await loadPushRegistrationStatus();
      openModal("알림 설정", notificationSettingsHTML());
    }
    if (action === "withdraw") {
      const nickname = account?.name || "";
      openModal("회원탈퇴", `
        <form class="my-form" id="withdraw-form">
          <p class="withdraw-warning">탈퇴하면 로그인 계정과 찜·알림·문의 정보가 삭제됩니다. 결제 및 재고 증빙이 필요한 주문은 회원을 식별할 수 없도록 익명화해 보존됩니다.</p>
          <label>확인을 위해 현재 닉네임을 입력해 주세요
            <input id="withdraw-confirmation" autocomplete="off" placeholder="${escapeHTML(nickname)}" required>
          </label>
          <button class="my-primary-button" type="submit">회원탈퇴 계속하기</button>
        </form>`);
    }

    const settingButton = event.target.closest("[data-all-notifications]");
    if (settingButton) {
      const enabled = !(settings().enabled && pushRegistered);
      try {
        if (enabled) await enableWebPush();
        else await disableWebPush();
        const saved = await saveNotificationSettings({ enabled });
        const savedEnabled = saved.enabled !== false;
        settingButton.classList.toggle("is-on", savedEnabled);
        settingButton.setAttribute("aria-checked", String(savedEnabled));
        await updateSummary();
        openModal("알림 설정", notificationSettingsHTML());
        showToast(savedEnabled ? "전체 알림을 켰어요." : "전체 알림을 껐어요.");
      } catch (error) {
        if (isInAppBrowser()) openModal("외부 브라우저에서 알림 켜기", externalBrowserGuideHTML());
        else showToast(error.message);
      }
    }

    // 💡 완전한 로그아웃 처리 부분 (Supabase 세션 및 로컬스토리지 일괄 삭제)
    if (event.target.closest("[data-logout]")) {
      try {
        const sharedClient = await window.TodayFridgeAuth?.getClient?.();
        if (sharedClient) {
          await sharedClient.auth.signOut();
        } else if (window.supabase?.createClient) {
          const response = await fetch("/api/config");
          const config = await response.json();
          if (response.ok && config.supabaseUrl && config.supabasePublishableKey) {
            const client = window.supabase.createClient(
              config.supabaseUrl,
              config.supabasePublishableKey
            );
            await client.auth.signOut(); // Supabase 서버 및 쿠키 세션 파기
          }
        }
      } catch (e) {
        console.error("Supabase signOut error:", e);
      }

      // 로컬스토리지에 직접 저장한 액세스 토큰 및 로그인 상태 완전 삭제
      localStorage.removeItem("todayFridgeAccessToken");

      // Supabase 자동 관리 키 삭제
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
          localStorage.removeItem(key);
        }
      }

      closeModal();
      showToast("로그아웃했어요.");

      // 로그인 화면으로 이동
      setTimeout(() => {
        window.location.href = "./login.html";
      }, 500);
      return;
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id !== "profile-name") return;
    clearTimeout(nicknameCheckTimer);
    nicknameCheckTimer = setTimeout(checkProfileNickname, 350);
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id === "withdraw-form") {
      event.preventDefault();
      const confirmation = $("#withdraw-confirmation").value.trim();
      if (!confirm("정말 회원탈퇴할까요? 삭제한 계정은 복구할 수 없습니다.")) return;
      const submit = event.target.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const token = accessToken() || await refreshedAccessToken();
        const response = await fetch("/api/profile", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ confirmation })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "회원탈퇴를 처리하지 못했습니다.");
        localStorage.clear();
        sessionStorage.clear();
        location.replace("./index.html");
      } catch (error) {
        submit.disabled = false;
        showToast(error.message);
      }
      return;
    }
    if (event.target.id !== "profile-form") return;
    event.preventDefault();
    if (!nicknameAvailable && !(await checkProfileNickname())) return;
    const nickname = $("#profile-name").value.normalize("NFKC").trim();
    const submit = $("#profile-form .my-primary-button");
    submit.disabled = true;
    let token = accessToken() || await refreshedAccessToken();
    try {
      const response = await fetch("/api/profile/nickname", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ nickname })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "닉네임을 저장하지 못했습니다.");
      window.FridgeDB.updateUserAccount({ name: result.data.nickname });
      renderAccount();
      closeModal();
      showToast("닉네임을 변경했어요.");
    } catch (error) {
      submit.disabled = false;
      const status = $("#profile-nickname-status");
      status.textContent = error.message || "닉네임을 저장하지 못했습니다.";
      status.className = "profile-nickname-status is-error";
    }
  });

  async function initializeMyPage() {
    authenticated = false;
    renderAuthState();
    await updateSummary();
    await loadAuthenticatedProfile();
    renderAccount();
    renderAuthState();
    await updateSummary();
    await updateAdminMenu();
    if (isLoggedIn()) openRequestedSection();
  }

  initializeMyPage();
})();
