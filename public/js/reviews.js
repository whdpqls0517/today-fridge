(function () {
  const list = document.getElementById("reviews-page-list");
  const buttons = document.querySelectorAll("[data-review-filter]");
  let selected = "all";

  function reviewCategory(review) {
    if (["bundle", "fruit", "market"].includes(review.productCategory)) {
      return review.productCategory;
    }
    const product = window.FridgeDB.getProducts().find((item) => item.id === review.productId);
    if (product?.category === "bundle") return "bundle";
    if (product?.category === "fruit") return "fruit";
    return "market";
  }

  function stars(rating) {
    return "★".repeat(Math.max(0, Math.min(5, Number(rating) || 0)));
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  function render() {
    const products = window.FridgeDB.getProducts();
    const reviews = window.FridgeDB.getReviews()
      .filter((review) => review.isVisible !== false)
      .filter((review) => selected === "all" || reviewCategory(review) === selected);
    buttons.forEach((button) => {
      const active = button.dataset.reviewFilter === selected;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (!reviews.length) {
      list.innerHTML = `<div class="reviews-empty">아직 등록된 후기가 없습니다.</div>`;
      return;
    }
    list.innerHTML = reviews.map((review) => {
      const product = products.find((item) => item.id === review.productId);
      return `
        <a class="review-list-card" href="./product-detail.html?id=${encodeURIComponent(review.productId)}">
          <div class="review-list-copy">
            <div class="review-list-head"><strong>${stars(review.rating)} ${escapeHTML(review.userName)}</strong><time>${escapeHTML(review.date)}</time></div>
            <p>${escapeHTML(review.comment)}</p>
            <span class="review-list-product">${escapeHTML(review.productName)}</span>
          </div>
          ${product?.image ? `<img src="${escapeHTML(product.image)}" alt="" />` : ""}
          ${review.reply ? `<div class="review-owner-reply"><strong>사장님 답변</strong>${escapeHTML(review.reply)}</div>` : ""}
        </a>`;
    }).join("");
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      selected = button.dataset.reviewFilter;
      render();
    });
  });
  window.addEventListener("storage", render);
  render();
})();
