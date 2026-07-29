(function () {
  const list = document.getElementById("notifications-list");
  let items = [];
  let loading = false;

  function accessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (value?.access_token) return value.access_token;
        if (value?.currentSession?.access_token) return value.currentSession.access_token;
      } catch (_) {}
    }
    return null;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function dateLabel(value) {
    if (!value) return "";
    const date = new Date(value);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return "오늘";
    return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  }

  function kindLabel(type) {
    return {
      arrival: ["입", "입고"],
      restock: ["재", "재입고"],
      inquiry_answer: ["문", "문의"],
      contact_request: ["연", "연락"],
      order_cancelled: ["취", "주문"],
      waitlist_promoted: ["승", "대기"],
      pickup: ["수", "수령"],
      payment_confirmed: ["확", "입금"],
      payment_reminder: ["입", "입금"]
    }[type] || ["알", "안내"];
  }

  function render() {
    list.innerHTML = items.length ? items.map((item) => {
      const [symbol, category] = kindLabel(item.type);
      return `
        <a class="notification-card ${item.read ? "" : "is-unread"}"
           href="${escapeHTML(item.href || "./index.html")}" data-id="${escapeHTML(item.id)}">
          <span class="notification-kind">${symbol}</span>
          <div class="notification-copy">
            <span class="notification-category">${category} 알림</span>
            <strong>${escapeHTML(item.title)}</strong>
            <p>${escapeHTML(item.body)}</p>
            <small>${escapeHTML(item.date)}</small>
          </div>
          <b>›</b>
        </a>`;
    }).join("") : `
      <div class="notification-empty">
        <strong>새로운 알림이 없어요</strong>
        <p>입고, 입금 확인, 수령 안내와 문의 답변 소식이 여기에 표시돼요.</p>
      </div>`;
  }

  async function load() {
    if (loading) return;
    loading = true;
    const token = accessToken();
    if (token) {
      try {
        const response = await fetch(`${location.origin}/api/notifications`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store"
        });
        const result = await response.json();
        if (response.ok && result.success) {
          items = result.data.map((item) => ({
            id: item.id,
            type: item.type,
            title: item.title,
            body: item.body,
            href: item.link,
            date: dateLabel(item.created_at),
            read: Boolean(item.read_at),
            remote: true
          }));
          render();
          loading = false;
          return;
        }
      } catch (_) {}
    }
    items = [];
    render();
    loading = false;
  }

  document.getElementById("read-all").addEventListener("click", async () => {
    items = items.map((item) => ({ ...item, read: true }));
    render();
    const token = accessToken();
    if (token) {
      await fetch(`${location.origin}/api/notifications/read-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
  });

  list.addEventListener("click", (event) => {
    const card = event.target.closest("[data-id]");
    if (!card) return;
    const item = items.find((entry) => String(entry.id) === card.dataset.id);
    if (!item) return;
    item.read = true;
    const token = accessToken();
    if (token && item.remote) {
      fetch(`${location.origin}/api/notifications/${encodeURIComponent(item.id)}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
  });

  window.addEventListener("pageshow", load);
  window.addEventListener("focus", load);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });
  load();
})();
