(function (global) {
  if (global.TodayFridgeAuth || !global.location.protocol.startsWith("http")) return;

  const originalFetch = global.fetch.bind(global);
  let client = null;
  let currentToken = null;

  function loadSupabaseLibrary() {
    if (global.supabase?.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="/vendor/supabase.js"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("로그인 모듈을 불러오지 못했습니다.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "/vendor/supabase.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("로그인 모듈을 불러오지 못했습니다."));
      document.head.append(script);
    });
  }

  function syncToken(session) {
    currentToken = session?.access_token || null;
    if (currentToken) localStorage.setItem("todayFridgeAccessToken", currentToken);
    else localStorage.removeItem("todayFridgeAccessToken");
    return currentToken;
  }

  async function initialize() {
    await loadSupabaseLibrary();
    const response = await originalFetch("/api/config", { cache: "no-store" });
    const config = await response.json();
    if (!response.ok || !config.supabaseUrl || !config.supabasePublishableKey) return null;

    client = global.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    syncToken(data?.session);
    client.auth.onAuthStateChange((_event, session) => syncToken(session));
    return client;
  }

  const ready = initialize().catch((error) => {
    console.warn("로그인 자동 갱신 준비 실패:", error.message);
    return null;
  });

  async function getAccessToken(forceRefresh = false) {
    await ready;
    if (!client) return currentToken || localStorage.getItem("todayFridgeAccessToken");
    let { data } = await client.auth.getSession();
    let session = data?.session || null;
    const expiresSoon = !session?.expires_at || session.expires_at * 1000 <= Date.now() + 60 * 1000;
    if (forceRefresh || expiresSoon) {
      const refreshed = await client.auth.refreshSession();
      session = refreshed.data?.session || session;
    }
    return syncToken(session);
  }

  global.TodayFridgeAuth = {
    ready,
    getAccessToken,
    getClient: async () => {
      await ready;
      return client;
    }
  };

  global.fetch = async function authenticatedFetch(input, init = {}) {
    const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(requestUrl, global.location.href);
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    const hasBearer = /^Bearer\s+/i.test(headers.get("Authorization") || "");
    const isOwnApi = url.origin === global.location.origin && url.pathname.startsWith("/api/");
    if (!hasBearer || !isOwnApi) return originalFetch(input, init);

    const token = await getAccessToken(false);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let response = await originalFetch(input, { ...init, headers });
    if (response.status !== 401) return response;

    const refreshedToken = await getAccessToken(true);
    if (!refreshedToken) return response;
    headers.set("Authorization", `Bearer ${refreshedToken}`);
    response = await originalFetch(input, { ...init, headers });
    return response;
  };

  function mountCopyright() {
    if (document.querySelector(".site-footer, .site-copyright")) return;
    const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    const excludedPages = new Set([
      "login.html",
      "signup.html",
      "profile-setup.html",
      "bundle-apply-complete.html",
      "terms.html",
      "privacy.html",
      "guide.html"
    ]);
    if (pageName.startsWith("admin") || pageName.includes("preview") || pageName.includes("sample") || excludedPages.has(pageName)) {
      return;
    }
    const footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.setAttribute("aria-label", "사업자 및 서비스 안내");
    footer.innerHTML = `
      <nav class="site-footer__links" aria-label="서비스 정책">
        <a href="./terms.html">이용약관</a>
        <a href="./privacy.html">개인정보처리방침</a>
        <a href="#business-info">사업자 정보</a>
      </nav>
      <div class="site-footer__business" id="business-info">
        <p><strong>오늘의 냉장고</strong><span aria-hidden="true"> | </span>대표 조영빈</p>
        <p>사업자등록번호 450-03-03431</p>
        <p>통신판매업 신고번호 <span class="site-footer__pending">발급 후 표시</span></p>
        <p>주소 경기 고양시 덕양구 충장로 2</p>
        <p>고객문의 <a href="tel:050714353715">0507-1435-3715</a><span aria-hidden="true"> · </span><a href="mailto:2day0924@naver.com">2day0924@naver.com</a></p>
      </div>
      <p class="site-footer__copyright">© 2026 오늘의 냉장고 (오냉). All rights reserved.</p>
    `;
    const bottomNavigation = document.querySelector(".bottom-nav, .bottom-navigation");
    if (bottomNavigation) {
      document.body.insertBefore(footer, bottomNavigation);
    } else {
      document.body.appendChild(footer);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountCopyright, { once: true });
  } else {
    mountCopyright();
  }
})(window);
