(function () {
  const grid = document.getElementById("status-grid");
  const summary = document.getElementById("status-summary");
  const checkedAt = document.getElementById("status-checked-at");
  const labels = {
    orders: "주문 데이터",
    notifications: "알림 이력",
    pushSubscriptions: "웹 푸시 구독",
    auditLogs: "관리자 작업 이력"
  };
  function token() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        return value?.access_token || value?.currentSession?.access_token || null;
      } catch (_) {}
    }
    return null;
  }
  async function load() {
    summary.textContent = "서버와 데이터베이스를 점검하고 있어요.";
    grid.innerHTML = "";
    try {
      const response = await fetch("/api/admin/system-status", {
        headers: { Authorization: `Bearer ${token()}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (response.status === 401) return location.replace("./login.html?next=admin-system-status.html");
      if (response.status === 403) return location.replace("./my-page.html");
      const data = result.data || {};
      grid.innerHTML = Object.entries(labels).map(([key, label]) => {
        const item = data[key] || { status: "error", message: "응답 없음" };
        return `<article class="status-card is-${item.status}"><strong>${label}</strong><span>${item.status === "ok" ? `정상 · ${item.count}건` : item.message}</span></article>`;
      }).join("") + `<article class="status-card is-${data.pushConfigured ? "ok" : "error"}"><strong>웹 푸시 설정</strong><span>${data.pushConfigured ? "전송 준비 완료" : "VAPID 키 설정 필요"}</span></article>`;
      summary.textContent = result.success ? "모든 핵심 항목이 정상입니다." : "확인이 필요한 항목이 있습니다.";
      checkedAt.textContent = data.checkedAt ? `마지막 점검 ${new Date(data.checkedAt).toLocaleString("ko-KR")}` : "";
    } catch (error) {
      summary.textContent = "서버 상태를 불러오지 못했습니다.";
      grid.innerHTML = `<article class="status-card is-error"><strong>연결 실패</strong><span>${error.message}</span></article>`;
    }
  }
  document.getElementById("status-refresh").addEventListener("click", load);
  load();
})();
