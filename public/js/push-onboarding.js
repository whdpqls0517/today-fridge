(function () {
  const DISMISSED_KEY = "todayFridgePushOnboardingDismissed";

  function readAccessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        const token = value?.access_token || value?.currentSession?.access_token;
        if (token) return token;
      } catch (_) {}
    }
    return null;
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
  }

  function base64UrlToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  }

  async function subscribe(token) {
    const configResponse = await fetch("/api/push/config", { cache: "no-store" });
    const config = await configResponse.json();
    if (!configResponse.ok || !config.enabled || !config.publicKey) {
      throw new Error("푸시 알림 서버 설정을 확인해 주세요.");
    }
    const registration = await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.publicKey)
    });
    const response = await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(subscription.toJSON())
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || "이 기기의 알림 등록에 실패했습니다.");
    }
  }

  function close(panel, remember = true) {
    panel.remove();
    if (remember) localStorage.setItem(DISMISSED_KEY, "1");
  }

  function showOnboarding(token) {
    const iosNeedsInstall = isIos() && !isStandalone();
    const panel = document.createElement("section");
    panel.className = "push-onboarding";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "알림 설정 안내");
    panel.innerHTML = `
      <div class="push-onboarding__icon" aria-hidden="true">🔔</div>
      <div class="push-onboarding__copy">
        <strong>${iosNeedsInstall ? "홈 화면에 추가하면 알림을 받을 수 있어요" : "입고·수령 소식을 바로 알려드릴까요?"}</strong>
        <p>${iosNeedsInstall
          ? "Safari의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택하고, 설치된 오늘의 냉장고에서 알림을 켜 주세요."
          : "신청 상품 입고, 입금 확인, 문의 답변 같은 필요한 소식만 보내드려요."}</p>
      </div>
      <button class="push-onboarding__primary" type="button">${iosNeedsInstall ? "확인" : "알림 받기"}</button>
      <button class="push-onboarding__close" type="button" aria-label="나중에 하기">×</button>
    `;
    document.body.appendChild(panel);
    panel.querySelector(".push-onboarding__close").addEventListener("click", () => close(panel));
    panel.querySelector(".push-onboarding__primary").addEventListener("click", async (event) => {
      if (iosNeedsInstall) return close(panel);
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "설정 중";
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("브라우저 설정에서 알림을 허용해 주세요.");
        await subscribe(token);
        close(panel);
      } catch (error) {
        button.disabled = false;
        button.textContent = "다시 시도";
        panel.querySelector(".push-onboarding__copy p").textContent = error.message;
      }
    });
  }

  async function initialize() {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    if (!("Notification" in window) || !("PushManager" in window)) return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;
    if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    const token = readAccessToken();
    if (!token) return;
    showOnboarding(token);
  }

  window.addEventListener("load", initialize, { once: true });
})();
