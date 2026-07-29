(function () {
  const form = document.getElementById("profile-setup-form");
  const input = document.getElementById("profile-nickname");
  const count = document.getElementById("nickname-count");
  const status = document.getElementById("nickname-status");
  const submit = form?.querySelector('button[type="submit"]');
  let checkTimer;
  let available = false;

  function accessToken() {
    return localStorage.getItem("todayFridgeAccessToken") || "";
  }

  function normalizedNickname() {
    return input.value.normalize("NFKC").trim();
  }

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.className = `nickname-status${tone ? ` ${tone}` : ""}`;
  }

  async function checkAvailability() {
    const nickname = normalizedNickname();
    count.textContent = `${nickname.length}/12`;
    available = false;
    submit.disabled = true;

    if (!/^[가-힣A-Za-z0-9_]{2,12}$/.test(nickname)) {
      setStatus("한글·영문·숫자·밑줄로 2~12자까지 입력해 주세요.", "is-error");
      return;
    }
    try {
      const response = await fetch(`/api/profile/nickname-availability?nickname=${encodeURIComponent(nickname)}`, {
        headers: { Authorization: `Bearer ${accessToken()}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error);
      available = result.available === true;
      submit.disabled = !available;
      setStatus(
        available ? "사용할 수 있는 닉네임이에요." : "이미 사용 중인 닉네임입니다.",
        available ? "is-valid" : "is-error"
      );
    } catch (error) {
      setStatus(error.message || "닉네임을 확인하지 못했습니다.", "is-error");
    }
  }

  input?.addEventListener("input", () => {
    clearTimeout(checkTimer);
    count.textContent = `${normalizedNickname().length}/12`;
    checkTimer = setTimeout(checkAvailability, 350);
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!available) {
      await checkAvailability();
      if (!available) return;
    }
    submit.disabled = true;
    try {
      const response = await fetch("/api/profile/nickname", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ nickname: normalizedNickname() })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "닉네임을 저장하지 못했습니다.");
      const account = window.FridgeDB?.getUserAccount();
      if (account) window.FridgeDB.updateUserAccount({ name: result.data.nickname });
      location.replace("./my-page.html");
    } catch (error) {
      submit.disabled = false;
      setStatus(error.message || "닉네임을 저장하지 못했습니다.", "is-error");
    }
  });

  if (!accessToken()) {
    location.replace("./signup.html");
  }
})();
