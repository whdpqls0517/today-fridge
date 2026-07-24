(function (global) {
  function isBundle(product) {
    return product?.category === "bundle" || product?.purchaseMode === "reservation";
  }

  function isSoldOut(product) {
    return Boolean(product?.isClosed || Number(product?.stock) <= 0 || hasDeadlinePassed(product));
  }

  function parseDate(value) {
    if (!value || value === "상시 판매") return null;
    const match = String(value).match(/(20\d{2})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function isToday(value, now = new Date()) {
    const date = parseDate(value);
    return Boolean(date
      && date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate());
  }

  function stockRatio(product) {
    const total = Number(product?.totalStock ?? product?.initialStock);
    const remaining = Number(product?.stock);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(remaining)) return null;
    return remaining / total;
  }

  function isClosingSoon(product) {
    const ratio = stockRatio(product);
    return Number(product?.stock) > 0 && ratio !== null && ratio <= 0.1;
  }

  function isBeforeDeadline(product, now = new Date()) {
    if (!isBundle(product) || !product?.deadline || product.deadline === "상시 판매") return false;
    const date = parseDate(product.deadline);
    if (!date) return false;
    const timeMatch = String(product.deadlineTime || "23:59").match(/^(\d{1,2}):(\d{2})$/);
    date.setHours(Number(timeMatch?.[1] || 23), Number(timeMatch?.[2] || 59), 59, 999);
    return now.getTime() <= date.getTime();
  }

  function hasDeadlinePassed(product, now = new Date()) {
    if (!isBundle(product) || !product?.deadline || product.deadline === "상시 판매") return false;
    const date = parseDate(product.deadline);
    if (!date) return false;
    const timeMatch = String(product.deadlineTime || "23:59").match(/^(\d{1,2}):(\d{2})$/);
    date.setHours(Number(timeMatch?.[1] || 23), Number(timeMatch?.[2] || 59), 59, 999);
    return now.getTime() > date.getTime();
  }

  function canJoinWaitlist(product, now = new Date()) {
    return isBundle(product)
      && Number(product?.stock) <= 0
      && !product?.isClosed
      && isBeforeDeadline(product, now);
  }

  function effectivePickupDate(product) {
    const date = parseDate(product?.pickupDate || product?.expectedPickupDate || product?.deadline);
    if (!date) return null;
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    return date;
  }

  function formatDate(date) {
    if (!date) return "미정";
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${weekdays[date.getDay()]}`;
  }

  function badges(product, now = new Date()) {
    if (isSoldOut(product)) {
      return [{
        key: "soldout",
        label: isBundle(product) ? "마감" : "품절",
        tone: "muted"
      }];
    }

    const result = [];
    if (isBundle(product) && isToday(product.deadline, now)) {
      result.push({ key: "today", label: "오늘마감", tone: "deadline" });
    }
    if (isClosingSoon(product)) {
      result.push({ key: "urgent", label: "마감임박", tone: "urgent" });
    }
    if (Number(product.salesCount) > 30) {
      result.push({ key: "popular", label: "인기상품", tone: "popular" });
    }
    return result.slice(0, 2);
  }

  function priceView(product) {
    if (isSoldOut(product)) {
      return { hidden: true, current: null, original: null, showOriginal: false };
    }
    return {
      hidden: false,
      current: Number(product.price) || 0,
      original: Number(product.originalPrice) || null,
      showOriginal: Boolean(product.showOriginalPrice && Number(product.originalPrice) > Number(product.price))
    };
  }

  function recommendationScore(product, now = new Date()) {
    if (isSoldOut(product)) return -1000;

    let score = product?.isRecommended ? 200 : 0;
    if (isBundle(product) && isToday(product.deadline, now)) score += 50;

    const pickupDate = effectivePickupDate(product);
    if (isBundle(product) && pickupDate) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const pickup = new Date(pickupDate.getFullYear(), pickupDate.getMonth(), pickupDate.getDate());
      const daysUntilPickup = Math.round((pickup.getTime() - today.getTime()) / 86400000);
      if (daysUntilPickup >= 0 && daysUntilPickup <= 2) score += 30;
    }

    const createdAt = new Date(product?.createdAt || "");
    if (!Number.isNaN(createdAt.getTime())) {
      const ageInDays = (now.getTime() - createdAt.getTime()) / 86400000;
      if (ageInDays >= 0 && ageInDays <= 7) score += 20;
    }

    score += Math.min(20, Math.max(0, Number(product?.recentOrderCount) || 0));
    return score;
  }

  function formatPrice(value) {
    return `${Number(value || 0).toLocaleString("ko-KR")}원`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[char]));
  }

  function createProductCard(product) {
    const card = document.createElement("article");
    const favorites = JSON.parse(localStorage.getItem("todayFridgeFavorites") || "[]");
    const favorite = favorites.includes(product.id);
    const productBadges = badges(product).slice(0, 2);
    const price = priceView(product);
    const tagList = Array.isArray(product.tags) ? product.tags.slice(0, 2) : [];

    card.className = `popular-card${isSoldOut(product) ? " is-sold-out" : ""}`;
    card.dataset.productId = product.id;
    card.dataset.productName = product.name;
    card.innerHTML = `
      <div class="popular-thumb">
        <img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" />
        <div class="popular-badges">
          ${productBadges.map((badge) => `<span class="popular-badge ${badge.tone} ${badge.tone === "popular" ? "green" : badge.tone === "muted" ? "muted" : "red"}">${badge.label}</span>`).join("")}
        </div>
        <button type="button" data-favorite-button
          aria-label="${favorite ? "찜 해제하기" : "찜하기"}" aria-pressed="${favorite}">
          ${favorite ? "♥" : "♡"}
        </button>
      </div>
      <strong>${escapeHTML(product.name)}</strong>
      ${price.hidden ? "" : `<p>${formatPrice(price.current)}${price.showOriginal ? `<del>${formatPrice(price.original)}</del>` : ""}</p>`}
      <small>${escapeHTML(product.description || "")}</small>
      <div class="popular-card-meta">
        <span>${tagList.map((tag) => escapeHTML(tag)).join(" · ")}</span>
        <span>★ ${Number(product.rating || 0).toFixed(1)} (${Number(product.reviewsCount || 0)})</span>
        ${isBundle(product) && !isSoldOut(product)
          ? `<span>수령 ${formatDate(effectivePickupDate(product))} · 주문마감 ${formatDate(parseDate(product.deadline))}</span>`
          : ""}
      </div>`;

    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      window.location.href = `./product-detail.html?id=${encodeURIComponent(product.id)}`;
    });
    return card;
  }

  global.ProductRules = {
    isBundle, isSoldOut, isToday, stockRatio, isClosingSoon,
    isBeforeDeadline, hasDeadlinePassed, canJoinWaitlist,
    effectivePickupDate, badges, recommendationScore, priceView, formatPrice
  };
  global.ProductUI = { createProductCard };
})(window);
