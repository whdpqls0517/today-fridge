// Search and Search Results script.
// Handles recent searches, trend rankings, dynamic product card rendering,
// 3대 마스터 배지 계산, and navigation.
(function () {
  const RECENT_KEY = "todayFridgeRecentSearches";
  const recentSection = document.querySelector("[data-recent-section]");
  const recentList = document.querySelector("[data-recent-list]");
  const clearRecentButton = document.querySelector("[data-clear-recent]");
  const searchForm = document.querySelector("[data-search-form]");
  const searchInput = document.querySelector("[data-search-input]");
  const trendList = document.querySelector("[data-trend-list]");

  const popularTrack = document.getElementById("search-popular-track");
  const resultsTrack = document.getElementById("search-results-track");
  const favoritesTrack = document.getElementById("favorites-results-track");
  const categoryListTrack = document.getElementById("category-list-track");

  function accessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        const token = value?.access_token || value?.currentSession?.access_token;
        if (token) return token;
      } catch (_) {}
    }
    return null;
  }

  // 1. Helper: Normalize keywords
  function normalizeKeyword(keyword) {
    return (keyword || "").trim().replace(/\s+/g, " ");
  }

  function loadRecentKeywords() {
    const saved = localStorage.getItem(RECENT_KEY);
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed.map(normalizeKeyword).filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function saveRecentKeywords(keywords) {
    localStorage.setItem(RECENT_KEY, JSON.stringify(keywords));
  }

  function renderRecentKeywords(keywords) {
    if (!recentSection || !recentList) return;

    recentSection.hidden = keywords.length === 0;
    recentList.innerHTML = "";

    keywords.forEach((keyword) => {
      const button = document.createElement("button");
      const remove = document.createElement("span");

      button.type = "button";
      button.dataset.searchKeyword = keyword;
      button.className = "search-chip";
      button.style.cssText = "display: inline-flex; align-items: center; gap: 4px; margin-right: 8px;";
      button.append(document.createTextNode(`${keyword}`));

      remove.dataset.removeKeyword = "";
      remove.textContent = " \u00d7";
      remove.style.cssText = "font-size: 14px; font-weight: bold; cursor: pointer; color: #aab2b9;";
      button.append(remove);

      recentList.append(button);
    });
  }

  function addRecentKeyword(keyword) {
    const cleanKeyword = normalizeKeyword(keyword);
    if (!cleanKeyword) return;

    const next = [
      cleanKeyword,
      ...loadRecentKeywords().filter((item) => item !== cleanKeyword)
    ].slice(0, 8);

    saveRecentKeywords(next);
    renderRecentKeywords(next);
  }

  function removeRecentKeyword(keyword) {
    const cleanKeyword = normalizeKeyword(keyword);
    const next = loadRecentKeywords().filter((item) => item !== cleanKeyword);
    saveRecentKeywords(next);
    renderRecentKeywords(next);
  }

  function goToSearchResult(keyword) {
    const cleanKeyword = normalizeKeyword(keyword);
    if (!cleanKeyword) return;

    addRecentKeyword(cleanKeyword);
    recordSearchEvent(cleanKeyword);
    window.location.href = `./search-results.html?q=${encodeURIComponent(cleanKeyword)}`;
  }

  function recordSearchEvent(keyword) {
    const token = accessToken();
    if (!token) return;
    fetch("/api/search/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ term: keyword }),
      keepalive: true
    }).catch(() => {});
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  function coreKeyword(product) {
    const explicit = String(product.searchKeyword || product.recommendedKeyword || "").trim();
    if (explicit) return explicit;
    return String(product.name || "")
      .replace(/^예시\s*·\s*/, "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|개|팩|입)\b/gi, " ")
      .replace(/\s+(?:보따리|한정)(?=\s|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function renderRecommendedKeywords() {
    if (!trendList) return;
    let manualTerms = [];
    try {
      const response = await fetch("/api/search/recommendations");
      const result = await response.json();
      if (response.ok && Array.isArray(result.data)) {
        manualTerms = result.data.map((item) => item.term);
      }
    } catch (_) {}

    const eligible = window.FridgeDB.getProducts()
      .filter((product) =>
        product.isActive !== false
        && Number(product.stock) > 0
        && !window.ProductRules.isSoldOut(product)
      )
      .sort((a, b) =>
        Number(Boolean(b.isRecommended)) - Number(Boolean(a.isRecommended))
        || window.ProductRules.recommendationScore(b) - window.ProductRules.recommendationScore(a)
      );

    const keywords = [];
    const addKeyword = (value) => {
      const keyword = normalizeKeyword(String(value || "").replace(/^#/, ""));
      if (keyword.length < 2 || keywords.includes(keyword)) return;
      keywords.push(keyword);
    };

    manualTerms.forEach(addKeyword);
    eligible.forEach((product) => addKeyword(coreKeyword(product)));
    if (keywords.length < 6) {
      eligible.forEach((product) => (product.tags || []).forEach(addKeyword));
    }

    const visible = keywords.slice(0, 10);
    trendList.innerHTML = visible.length
      ? visible.map((keyword) => `
          <button type="button" data-search-keyword="${escapeHTML(keyword)}">
            <span>${escapeHTML(keyword)}</span><b aria-hidden="true">↗</b>
          </button>`).join("")
      : `<p class="recommended-empty">추천할 판매 상품을 준비하고 있어요.</p>`;
  }

  // 2. Card Renderer (3대 마스터 배지 계산 적용)
  function createProductCard(p, isSearchResult = false) {
    return window.ProductUI.createProductCard(p);
  }

  // 검색 홈의 인기 상품은 기존의 가로 스크롤 전용 카드 형태를 유지합니다.
  // 목록 페이지용 7개 정보 카드를 이 영역에 재사용하면 카드 높이와 간격이 무너집니다.
  function createSearchPopularCard(product) {
    const card = document.createElement("article");
    const favorites = JSON.parse(localStorage.getItem("todayFridgeFavorites") || "[]");
    const favorite = favorites.includes(product.id);
    const price = window.ProductRules.priceView(product);
    const badge = window.ProductRules.badges(product).slice(0, 2);

    card.className = `popular-card search-popular-card${window.ProductRules.isSoldOut(product) ? " is-sold-out" : ""}`;
    card.dataset.productId = product.id;
    card.innerHTML = `
      <div class="popular-thumb">
        <img src="${product.image}" alt="${product.name}" />
        <span class="popular-badges">
          ${badge.map((item) => `<span class="popular-badge ${item.tone === "popular" ? "green" : item.tone === "muted" ? "muted" : "red"}">${item.label}</span>`).join("")}
        </span>
        <button type="button" data-favorite-button aria-label="${favorite ? "찜 해제하기" : "찜하기"}"
          aria-pressed="${favorite}">${favorite ? "♥" : "♡"}</button>
      </div>
      <strong>${product.name}</strong>
      ${price.hidden ? "" : `<p>${window.ProductRules.formatPrice(price.current)}${price.showOriginal ? `<del>${window.ProductRules.formatPrice(price.original)}</del>` : ""}</p>`}
      <small>★ ${Number(product.rating || 0).toFixed(1)} · 후기 ${Number(product.reviewsCount || 0)}</small>
    `;

    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      window.location.href = `./product-detail.html?id=${encodeURIComponent(product.id)}`;
    });
    return card;
  }

  // 3. Render Search Home Popular Items
  function renderPopularProducts() {
    if (!popularTrack) return;
    const products = window.FridgeDB.getProducts();
    
    popularTrack.innerHTML = "";
    // 상위 4개만 노출
    products.slice(0, 4).forEach((p) => {
      const card = createSearchPopularCard(p);
      popularTrack.append(card);
    });
  }

  // 4. Render Search Results
  function renderSearchResults() {
    if (!resultsTrack) return;

    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const category = params.get("category");
    const products = window.FridgeDB.getProducts();

    let filtered = products;

    if (category && category !== "all") {
      filtered = products.filter(p => p.category === category);
      
      // 타이틀 표기 변경
      const resultTitle = document.querySelector("[data-result-keyword]");
      if (resultTitle) {
        let catKo = "전체 상품";
        if (category === "bundle") catKo = "보따리 공동구매 상품";
        else if (category === "fruit") catKo = "프리미엄 제철 과일";
        else if (category === "market") catKo = "매장 상시 상품";
        resultTitle.textContent = catKo;
      }
    } else if (q) {
      const cleanQ = normalizeKeyword(q).toLowerCase();
      filtered = products.filter(p => 
        p.name.toLowerCase().includes(cleanQ) || 
        p.description.toLowerCase().includes(cleanQ) ||
        p.tags.some(t => t.toLowerCase().includes(cleanQ))
      );

      const resultTitle = document.querySelector("[data-result-keyword]");
      if (resultTitle) {
        resultTitle.textContent = `"${q}" 검색 결과`;
      }
    } else {
      // 카테고리가 'all'인 경우
      const resultTitle = document.querySelector("[data-result-keyword]");
      if (resultTitle) {
        resultTitle.textContent = "전체 상품 목록";
      }
    }

    resultsTrack.innerHTML = "";

    if (filtered.length === 0) {
      resultsTrack.innerHTML = `
        <div style="grid-column: span 2; text-align: center; padding: 60px 20px; color: #8c969e;">
          <p style="font-size: 15px; font-weight: 800; margin-bottom: 6px;">검색된 상품이 없습니다.</p>
          <p style="font-size: 12px; margin: 0;">다른 키워드로 검색하거나 카테고리를 이용해 보세요.</p>
        </div>
      `;
      return;
    }

    filtered.forEach((p) => {
      const card = createProductCard(p, true);
      resultsTrack.append(card);
    });
  }

  function renderFavoriteProducts() {
    if (!favoritesTrack) return;

    const favoriteIds = JSON.parse(localStorage.getItem("todayFridgeFavorites") || "[]");
    const products = window.FridgeDB.getProducts();
    const favoriteProducts = favoriteIds
      .map((id) => products.find((product) => product.id === id))
      .filter(Boolean);

    favoritesTrack.innerHTML = "";

    if (favoriteProducts.length === 0) {
      favoritesTrack.innerHTML = `
        <div style="grid-column: span 2; text-align: center; padding: 60px 20px; color: #8c969e;">
          <p style="font-size: 15px; font-weight: 800; margin-bottom: 6px;">아직 찜한 상품이 없습니다.</p>
          <p style="font-size: 12px; margin: 0;">상품 카드의 하트 버튼을 눌러 관심 상품을 담아보세요.</p>
        </div>
      `;
      return;
    }

    favoriteProducts.forEach((product) => {
      favoritesTrack.append(createProductCard(product));
    });
  }

  function renderCategoryList() {
    if (!categoryListTrack) return;

    const category = document.body.dataset.listCategory;
    const products = window.FridgeDB.getProducts().filter((product) => product.category === category);

    categoryListTrack.innerHTML = "";

    if (products.length === 0) {
      categoryListTrack.innerHTML = `
        <div style="grid-column: span 2; text-align: center; padding: 60px 20px; color: #8c969e;">
          <p style="font-size: 15px; font-weight: 800; margin-bottom: 6px;">아직 등록된 상품이 없습니다.</p>
          <p style="font-size: 12px; margin: 0;">사장님이 상품을 등록하면 이곳에 표시됩니다.</p>
        </div>
      `;
      return;
    }

    products.forEach((product) => {
      categoryListTrack.append(createProductCard(product));
    });
  }

  // 5. Initial Event Listeners
  renderRecentKeywords(loadRecentKeywords());
  renderRecommendedKeywords();
  renderPopularProducts();
  renderSearchResults();
  renderFavoriteProducts();
  renderCategoryList();

  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    goToSearchResult(searchInput?.value);
  });

  clearRecentButton?.addEventListener("click", () => {
    saveRecentKeywords([]);
    renderRecentKeywords([]);
  });

  recentList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-search-keyword]");
    if (!button) return;

    const keyword = button.dataset.searchKeyword;
    if (event.target.matches("[data-remove-keyword]")) {
      event.stopPropagation();
      removeRecentKeyword(keyword);
      return;
    }

    goToSearchResult(keyword);
  });

  trendList?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-search-keyword]");
    if (!item) return;
    goToSearchResult(item.dataset.searchKeyword || item.querySelector("span")?.textContent);
  });

  window.addEventListener("pageshow", () => {
    if (!searchInput) return;
    searchInput.value = "";
    searchForm?.reset();
  });

  window.addEventListener("favoriteschange", renderFavoriteProducts);
})();
