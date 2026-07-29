(function () {
  const list = document.getElementById("audit-list");
  const state = document.getElementById("audit-state");
  const actionSelect = document.getElementById("audit-action");
  const labels = {
    product_created: "상품 등록",
    product_updated: "상품 수정",
    product_settings_updated: "상품 설정 변경",
    product_deleted: "상품 삭제",
    order_cancelled: "주문 취소",
    payment_confirmed: "입금 승인",
    payment_auto_expired: "입금 자동 만료"
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
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }
  function targetText(item) {
    const name = item.after_data?.name || item.before_data?.name;
    if (name) return name;
    if (item.target_type === "order") return `주문 ${item.after_data?.order_number || item.before_data?.order_number || item.target_id || ""}`;
    return item.target_id || "대상 정보 없음";
  }
  async function load() {
    state.hidden = false;
    state.textContent = "작업 이력을 불러오고 있어요.";
    list.innerHTML = "";
    try {
      const query = actionSelect.value ? `?action=${encodeURIComponent(actionSelect.value)}` : "";
      const response = await fetch(`/api/admin/audit-logs${query}`, {
        headers: { Authorization: `Bearer ${token()}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (response.status === 401) return location.replace("./login.html?next=admin-audit-log.html");
      if (response.status === 403) return location.replace("./my-page.html");
      if (!response.ok || !result.success) throw new Error(result.error || "작업 이력을 불러오지 못했습니다.");
      if (!result.data.length) {
        state.textContent = "아직 조건에 맞는 작업 이력이 없습니다.";
        return;
      }
      state.hidden = true;
      list.innerHTML = result.data.map((item) => `
        <article class="audit-card">
          <header><strong>${escapeHTML(labels[item.action] || item.action)}</strong><time>${new Date(item.created_at).toLocaleString("ko-KR")}</time></header>
          <p>${escapeHTML(targetText(item))}</p>
          <small>처리자 ${escapeHTML(item.admin_name)} · ${escapeHTML(item.target_type)}</small>
        </article>`).join("");
    } catch (error) {
      state.textContent = `불러오기 실패: ${error.message}`;
    }
  }
  actionSelect.addEventListener("change", load);
  document.getElementById("audit-refresh").addEventListener("click", load);
  load();
})();
