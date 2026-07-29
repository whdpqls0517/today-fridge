(function () {
  const CATEGORIES = {
    all: "전체 상품",
    fruit: "과일",
    vegetable: "채소",
    "meat-egg": "정육·계란",
    "seafood-dried": "수산·건어물",
    "rice-grain": "쌀·잡곡",
    "meal-kit": "간편식·밀키트",
    "snack-drink": "간식·음료",
    "seasoning-sauce": "조미료·소스",
    etc: "기타"
  };
  const buttons = document.querySelectorAll("[data-category-value]");
  const sortButtons = document.querySelectorAll("[data-sort-value]");
  const grid = document.getElementById("category-product-grid");
  const title = document.getElementById("category-result-title");
  const initialParams = new URLSearchParams(window.location.search);
  let selected = initialParams.get("category") || "all";
  let sortMode = initialParams.get("sort") === "latest" ? "latest" : "recommended";
  if (!CATEGORIES[selected]) selected = "all";

  function products() {
    return window.FridgeDB.getProducts().filter((product) => product.isActive !== false);
  }

  function sortedProducts(items) {
    return items
      .map((product, index) => ({ product, index }))
      .sort((a, b) => {
        const aClosed = window.ProductRules.isSoldOut(a.product) ? 1 : 0;
        const bClosed = window.ProductRules.isSoldOut(b.product) ? 1 : 0;
        if (aClosed !== bClosed) return aClosed - bClosed;
        if (sortMode === "latest") {
          const aCreated = Date.parse(a.product.createdAt || "") || 0;
          const bCreated = Date.parse(b.product.createdAt || "") || 0;
          return bCreated - aCreated || a.index - b.index;
        }
        const scoreDifference = window.ProductRules.recommendationScore(b.product)
          - window.ProductRules.recommendationScore(a.product);
        return scoreDifference || a.index - b.index;
      })
      .map(({ product }) => product);
  }

  function syncURL() {
    const params = new URLSearchParams();
    if (selected !== "all") params.set("category", selected);
    if (sortMode !== "recommended") params.set("sort", sortMode);
    const query = params.toString();
    window.history.replaceState(null, "", `./category.html${query ? `?${query}` : ""}`);
  }

  function render() {
    const items = products();
    const categoryItems = selected === "all"
      ? items
      : items.filter((product) => (product.productCategory || "etc") === selected);
    const filtered = sortedProducts(categoryItems);
    buttons.forEach((button) => {
      const active = button.dataset.categoryValue === selected;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    sortButtons.forEach((button) => {
      const active = button.dataset.sortValue === sortMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    title.textContent = CATEGORIES[selected];
    grid.innerHTML = "";
    if (!filtered.length) {
      grid.innerHTML = `<div class="category-empty"><strong>등록된 상품이 없습니다.</strong><p>새 상품이 등록되면 이곳에 표시됩니다.</p></div>`;
      return;
    }
    filtered.forEach((product) => grid.append(window.ProductUI.createProductCard(product)));
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      selected = button.dataset.categoryValue;
      syncURL();
      render();
      document.querySelector(".category-products")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      sortMode = button.dataset.sortValue;
      syncURL();
      render();
    });
  });
  window.addEventListener("storage", render);
  render();
})();
