(function () {
  const track = document.getElementById("fruit-list-track");
  if (!track) return;

  async function loadFruitHero() {
    const title = document.getElementById("fruit-hero-title");
    const description = document.getElementById("fruit-hero-description");
    if (!title || !description) return;
    try {
      const response = await fetch("/api/site-content/fruit-hero", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) return;
      if (result.data?.title) title.textContent = result.data.title;
      if (result.data?.description) description.textContent = result.data.description;
    } catch (_) {
      // 서버 설정을 불러오지 못하면 HTML에 있는 기본 문구를 그대로 사용합니다.
    }
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character]));
  }

  function render() {
    const products = (window.FridgeDB?.getProducts() || [])
      .filter((product) => product.category === "fruit" && product.isActive !== false)
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

    if (!products.length) {
      track.innerHTML = `<div class="fruit-list-empty">오늘 등록된 과일이 없습니다.<br>새로운 입고 소식을 기다려 주세요.</div>`;
      return;
    }

    track.innerHTML = products.map((product) => {
      // 평점이 없으면 0.0, 후기 수가 없으면 0으로 기본값 설정
      const rating = Number(product.rating || 0).toFixed(1);
      const reviewCount = Number(product.reviewsCount || 0);

      // 💡 Admin 양식 필드 매핑 보정:
      // description(한 줄 소개)이 비어있으면 detailDescription(상세내용)을 출력하도록 대체(fallback) 처리
      const descriptionText = product.description || product.detailDescription || "매장에서 직접 확인할 수 있는 오늘의 신선 과일입니다.";

      return `
        <a class="fruit-list-item" href="./product-detail.html?id=${encodeURIComponent(product.id)}">
          <div class="fruit-list-copy">
            <h3>${escapeHTML(product.name)}</h3>
            <strong class="fruit-list-price">${window.ProductRules ? window.ProductRules.formatPrice(product.price) : Number(product.price || 0).toLocaleString() + '원'}</strong>
            <p class="fruit-list-description">${escapeHTML(descriptionText)}</p>
            <div class="fruit-list-rating">
              <i>★</i>
              <span>${rating} (${reviewCount})</span>
            </div>
          </div>
          <div class="fruit-list-image">
            <img src="${escapeHTML(product.image || "./images/asset-daily-fruit.png")}" alt="${escapeHTML(product.name)}" />
          </div>
        </a>`;
    }).join("");
  }

  window.addEventListener("storage", render);
  window.addEventListener("todayFridgeCatalogUpdated", render);
  window.addEventListener("pageshow", render);
  loadFruitHero();
  render();
})();
