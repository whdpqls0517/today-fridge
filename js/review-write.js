(function () {
  const orderId = new URLSearchParams(location.search).get("orderId");
  const form = document.getElementById("review-write-form");
  const card = document.getElementById("review-order-card");
  const content = document.getElementById("review-content");
  const message = document.getElementById("review-write-message");
  let rating = 5;

  function token() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (value?.access_token) return value.access_token;
      } catch (_) {}
    }
    return null;
  }

  const order = window.FridgeDB.getOrders().find((item) => String(item.id) === String(orderId));
  const product = window.FridgeDB.getProducts().find((item) => item.id === order?.productId);
  if (!order || order.status !== "completed") {
    message.textContent = "후기를 작성할 수 있는 수령 완료 주문이 아닙니다.";
    form.hidden = true;
  } else {
    card.innerHTML = `${product?.image ? `<img src="${product.image}" alt="">` : ""}<div><strong>${order.productName}</strong><span>수령 완료 주문 · ${order.orderNumber || order.id}</span></div>`;
  }

  function renderRating() {
    document.querySelectorAll("[data-rating]").forEach((button) => button.classList.toggle("is-active", Number(button.dataset.rating) <= rating));
  }
  document.getElementById("rating-picker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-rating]");
    if (!button) return;
    rating = Number(button.dataset.rating);
    renderRating();
  });
  content.addEventListener("input", () => { document.getElementById("review-length").textContent = content.value.length; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = content.value.trim();
    if (!text) return;
    try {
      const auth = token();
      if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(order.id) && auth) {
        const response = await fetch(`${location.origin}/api/reviews`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${auth}` }, body:JSON.stringify({ orderId:order.id, rating, content:text, photoUrls:[] }) });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "후기를 등록하지 못했습니다.");
      }
      window.FridgeDB.addReview({ id:`review-${Date.now()}`, orderId:order.id, productId:order.productId, productName:order.productName, productCategory:product?.category || "market", userName:window.FridgeDB.getUserAccount()?.name || "고객", rating, comment:text, isVisible:true, reply:null, date:new Date().toISOString().slice(0,10) });
      location.replace("./reviews.html");
    } catch (error) {
      message.textContent = error.message || "후기를 등록하지 못했습니다.";
    }
  });
  renderRating();
})();
