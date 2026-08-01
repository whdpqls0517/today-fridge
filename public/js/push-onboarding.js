(function () {
  const DISMISSED_KEY_PREFIX = "todayFridgePushOnboardingDismissed";

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

  function isInAppBrowser() {
    return /NAVER|KAKAOTALK|KAKAOSTORY/i.test(navigator.userAgent);
  }

  function currentPageUrl() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  async function copyAndOpenExternalBrowser(panel, browser) {
    const url = currentPageUrl();
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
    const message = panel.querySelector(".push-onboarding__copy p");
    if (isIos()) {
      message.textContent = "주소를 복사했어요. Safari 주소창에 붙여넣은 뒤 공유 → 홈 화면에 추가를 선택해 주세요.";
      return;
    }
    message.textContent = "주소를 복사했어요. Chrome 또는 삼성 인터넷을 선택해 주세요. 선택창이 열리지 않으면 주소창에 붙여넣어 주세요.";
    const target = new URL(url);
    const packageName = browser === "samsung"
      ? "com.sec.android.app.sbrowser"
      : "com.android.chrome";
    setTimeout(() => {
      location.href = `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=${target.protocol.replace(":", "")};package=${packageName};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    }, 180);
  }

  function userKey(token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload?.sub ? `${DISMISSED_KEY_PREFIX}:${payload.sub}` : DISMISSED_KEY_PREFIX;
    } catch (_) {
      return DISMISSED_KEY_PREFIX;
    }
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

  function close(panel, dismissedKey, remember = true) {
    panel.remove();
    if (remember) localStorage.setItem(dismissedKey, "1");
  }

  function showOnboarding(token) {
    const iosNeedsInstall = isIos() && !isStandalone();
    const needsExternalBrowser = isInAppBrowser();
    const dismissedKey = userKey(token);
    const panel = document.createElement("section");
    panel.className = "push-onboarding";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "알림 설정 안내");
    panel.innerHTML = `
      <div class="push-onboarding__icon" aria-hidden="true">🔔</div>
      <div class="push-onboarding__copy">
        <strong>${needsExternalBrowser ? "외부 브라우저에서 알림을 켜 주세요" : (iosNeedsInstall ? "홈 화면에 추가하면 알림을 받을 수 있어요" : "입고·수령 소식을 바로 알려드릴까요?")}</strong>
        <p>${needsExternalBrowser
          ? (isIos()
            ? "아래 버튼으로 주소를 복사한 뒤 Safari에서 붙여넣어 접속하세요. 공유 → 홈 화면에 추가 후 설치된 아이콘에서 로그인하고 마이페이지의 전체 알림을 켜 주세요."
            : "아래에서 사용할 브라우저를 직접 선택하세요. 버튼을 누르면 주소도 복사되므로 앱이 열리지 않을 때 주소창에 붙여넣을 수 있어요.")
          : iosNeedsInstall
          ? "Safari의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택하고, 설치된 오늘의 냉장고에서 알림을 켜 주세요."
          : "신청 상품 입고, 입금 확인, 문의 답변 같은 필요한 소식만 보내드려요."}</p>
      </div>
      ${needsExternalBrowser && !isIos()
        ? `<div class="push-onboarding__browser-actions"><button type="button" data-push-browser="chrome">Chrome으로 열기</button><button type="button" data-push-browser="samsung">삼성 인터넷으로 열기</button></div>`
        : `<button class="push-onboarding__primary" type="button">${needsExternalBrowser ? "주소 복사하기" : (iosNeedsInstall ? "설치 방법 확인" : "알림 받기")}</button>`}
      <button class="push-onboarding__close" type="button" aria-label="나중에 하기">×</button>
    `;
    document.body.appendChild(panel);
    panel.querySelector(".push-onboarding__close").addEventListener("click", () => close(panel, dismissedKey));
    panel.querySelectorAll("[data-push-browser]").forEach((browserButton) => {
      browserButton.addEventListener("click", async () => {
        browserButton.disabled = true;
        try {
          await copyAndOpenExternalBrowser(panel, browserButton.dataset.pushBrowser);
          localStorage.setItem(dismissedKey, "1");
          browserButton.textContent = "브라우저 여는 중";
        } catch (_) {
          browserButton.disabled = false;
          browserButton.textContent = "다시 시도";
          panel.querySelector(".push-onboarding__copy p").textContent = "주소를 복사하지 못했어요. 외부 브라우저 주소창에 onaeng.com을 직접 입력해 주세요.";
        }
      });
    });
    panel.querySelector(".push-onboarding__primary")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (needsExternalBrowser) {
        button.disabled = true;
        try {
          await copyAndOpenExternalBrowser(panel, "copy");
          localStorage.setItem(dismissedKey, "1");
          button.textContent = isIos() ? "주소 복사 완료" : "브라우저 선택창 여는 중";
        } catch (_) {
          button.disabled = false;
          button.textContent = "다시 시도";
          panel.querySelector(".push-onboarding__copy p").textContent = "주소를 복사하지 못했어요. 외부 브라우저 주소창에 onaeng.com을 직접 입력해 주세요.";
        }
        return;
      }
      if (iosNeedsInstall) return close(panel, dismissedKey);
      button.disabled = true;
      button.textContent = "설정 중";
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("브라우저 설정에서 알림을 허용해 주세요.");
        await subscribe(token);
        close(panel, dismissedKey);
      } catch (error) {
        button.disabled = false;
        button.textContent = "다시 시도";
        panel.querySelector(".push-onboarding__copy p").textContent = error.message;
      }
    });
  }

  async function initialize() {
    if (!window.isSecureContext) return;
    const token = readAccessToken();
    if (!token) return;
    if (isInAppBrowser()) {
      if (localStorage.getItem(userKey(token)) !== "1") showOnboarding(token);
      return;
    }
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    if (!("Notification" in window) || !("PushManager" in window)) return;
    if (Notification.permission === "granted") {
      subscribe(token).catch(() => {});
      return;
    }
    if (Notification.permission === "denied") return;
    if (localStorage.getItem(userKey(token)) === "1") return;
    showOnboarding(token);
  }

  window.addEventListener("load", initialize, { once: true });
})();
