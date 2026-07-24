(function () {
  if (window.location.protocol === "file:") {
    const target = `http://localhost:3000/login.html${window.location.search}${window.location.hash}`;
    window.location.replace(target);
    return;
  }

  const API_BASE = window.location.origin;
  const toast = document.getElementById("login-toast");
  let timer;
  let authClient = null;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  async function getAuthClient() {
    if (authClient) return authClient;
    if (!window.supabase?.createClient) {
      throw new Error("백엔드 서버를 먼저 실행해 주세요.");
    }

    const response = await fetch(`${API_BASE}/api/config`);
    const config = await response.json();
    if (!response.ok || !config.authReady) {
      throw new Error("서버 .env에 Supabase Publishable key를 추가해 주세요.");
    }

    authClient = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );
    return authClient;
  }

  function nextPage() {
    const next = new URLSearchParams(window.location.search).get("next");
    return next === "admin" ? "./admin.html" : "./my-page.html";
  }

  async function completeOAuthRedirect() {
    try {
      const client = await getAuthClient();
      const { data } = await client.auth.getSession();
      const session = data?.session;
      const token = session?.access_token;
      if (!token) return;

      const provider = session.user?.app_metadata?.provider === "google"
        ? "google"
        : "kakao";
      localStorage.setItem("todayFridgeAccessToken", token);
      localStorage.setItem("todayFridgeAuthSession", JSON.stringify({
        loggedIn: true,
        provider
      }));
      window.FridgeDB.bindAuthenticatedUser({
        id: session.user.id,
        provider,
        name: session.user?.user_metadata?.name
          || session.user?.user_metadata?.full_name
          || "고객",
        phone: session.user?.phone || "",
        email: session.user?.email || ""
      });
      window.location.replace(nextPage());
    } catch (error) {
      showToast(error.message || "로그인 정보를 확인하지 못했습니다.");
    }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-login-provider]");
    if (!button) return;

    button.disabled = true;
    try {
      const client = await getAuthClient();
      const next = new URLSearchParams(window.location.search).get("next") === "admin"
        ? "admin"
        : "my-page";
      const redirectTo = `${API_BASE}/login.html?next=${next}`;
      const { error } = await client.auth.signInWithOAuth({
        provider: button.dataset.loginProvider,
        options: { redirectTo }
      });
      if (error) throw error;
    } catch (error) {
      showToast(error.message || "로그인을 시작하지 못했습니다.");
      button.disabled = false;
    }
  });

  completeOAuthRedirect();
})();
