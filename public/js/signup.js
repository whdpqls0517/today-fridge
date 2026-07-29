(function () {
  if (window.location.protocol === "file:") {
    document.addEventListener("DOMContentLoaded", () => {
      const toast = document.getElementById("signup-toast");
      if (toast) {
        toast.textContent = "파일을 직접 열지 말고 서버 주소로 접속해 주세요.";
        toast.classList.add("is-visible");
      }
    });
    return;
  }

  const API_BASE = window.location.origin;
  const toast = document.getElementById("signup-toast");
  let timer;
  let authClient = null;
  let publicAppUrl = API_BASE;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
  }

  async function getAuthClient() {
    if (authClient) return authClient;
    if (!window.supabase?.createClient) throw new Error("백엔드 서버를 먼저 실행해 주세요.");
    const response = await fetch(`${API_BASE}/api/config`, { cache: "no-store" });
    const config = await response.json();
    if (!response.ok || !config.authReady) {
      throw new Error("서버의 Supabase 연결 설정을 확인해 주세요.");
    }
    authClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    publicAppUrl = String(config.appUrl || API_BASE).replace(/\/+$/, "");
    return authClient;
  }

  async function finishSignup() {
    try {
      const client = await getAuthClient();
      const { data } = await client.auth.getSession();
      const session = data?.session;
      if (!session?.access_token) return;

      const provider = session.user?.app_metadata?.provider === "google" ? "google" : "kakao";
      const name = session.user?.user_metadata?.name
        || session.user?.user_metadata?.full_name
        || session.user?.user_metadata?.preferred_username
        || "고객";
      localStorage.setItem("todayFridgeAccessToken", session.access_token);
      window.location.replace("./profile-setup.html");
    } catch (error) {
      showToast(error.message || "회원가입 정보를 확인하지 못했습니다.");
    }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-signup-provider]");
    if (!button) return;
    button.disabled = true;
    try {
      const client = await getAuthClient();
      const { error } = await client.auth.signInWithOAuth({
        provider: button.dataset.signupProvider,
        options: {
          redirectTo: `${publicAppUrl}/login.html?from=signup`,
          queryParams: { prompt: "select_account" }
        }
      });
      if (error) throw error;
    } catch (error) {
      showToast(error.message || "회원가입을 시작하지 못했습니다.");
      button.disabled = false;
    }
  });

  finishSignup();
})();
