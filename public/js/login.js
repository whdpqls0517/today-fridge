(function () {
  if (window.location.protocol === "file:") {
    document.addEventListener("DOMContentLoaded", () => {
      const toast = document.getElementById("login-toast");
      if (toast) {
        toast.textContent = "파일을 직접 열지 말고 서버 주소로 접속해 주세요.";
        toast.classList.add("is-visible");
      }
    });
    return;
  }

  const API_BASE = window.location.origin;
  const toast = document.getElementById("login-toast");
  let timer;
  let authClient = null;
  let publicAppUrl = API_BASE;

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
    publicAppUrl = String(config.appUrl || API_BASE).replace(/\/+$/, "");
    return authClient;
  }

  function nextPage() {
    const next = new URLSearchParams(window.location.search).get("next");
    return next === "admin" ? "./admin.html" : "./index.html";
  }

  async function completeOAuthRedirect() {
    try {
      const client = await getAuthClient();
      const { data } = await client.auth.getSession();
      const session = data?.session;
      const token = session?.access_token;
      if (!token) return;

      localStorage.setItem("todayFridgeAccessToken", token);
      const fromSignup = new URLSearchParams(window.location.search).get("from") === "signup";
      if (session.provider_token || fromSignup) {
        if (!session.provider_token) {
          throw new Error("카카오 동의 정보를 확인할 수 없습니다. 다시 로그인해 주세요.");
        }
        const syncResponse = await fetch(`${API_BASE}/api/auth/kakao-sync`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ providerToken: session.provider_token })
        });
        const syncResult = await syncResponse.json().catch(() => ({}));
        if (!syncResponse.ok) {
          throw new Error(syncResult.error || "카카오 필수 약관 동의를 확인하지 못했습니다.");
        }
        const profileResponse = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store"
        });
        const profileResult = await profileResponse.json();
        if (profileResponse.ok && !profileResult.profile?.nickname) {
          window.location.replace("./profile-setup.html");
          return;
        }
      }
      const profileResponse = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const profileResult = await profileResponse.json().catch(() => ({}));
      if (!profileResponse.ok) {
        throw new Error(profileResult.error || "회원 정보를 확인하지 못했습니다.");
      }
      if (!profileResult.profile?.nickname) {
        window.location.replace("./profile-setup.html");
        return;
      }
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
        : "home";
      const redirectTo = `${publicAppUrl}/login.html?next=${next}`;

      // 💡 [수정 포인트] prompt: "select_account" 옵션 추가
      const { error } = await client.auth.signInWithOAuth({
        provider: button.dataset.loginProvider,
        options: {
          redirectTo,
          queryParams: {
            prompt: "select_account" // 자동 진행을 막고 계정 선택창을 강제로 띄웁니다.
          }
        }
      });
      if (error) throw error;
    } catch (error) {
      showToast(error.message || "로그인을 시작하지 못했습니다.");
      button.disabled = false;
    }
  });

  completeOAuthRedirect();
})();
