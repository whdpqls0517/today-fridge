(function (global) {
  function isBundle(product) {
    return product?.category === "bundle" || product?.purchaseMode === "reservation";
  }

  // 날짜 문자열 정밀 파싱
  function parseDate(value) {
    if (!value || value === "상시 판매") return null;
    
    if (value instanceof Date) return new Date(value.getTime());
    
    const str = String(value).trim();
    const match = str.match(/(20\d{2})[.-](\d{1,2})[.-](\d{1,2})/);
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

  // 마감 시각 추출 도구
  function getDeadlineDateTime(product) {
    if (!isBundle(product) || !product?.deadline || product.deadline === "상시 판매") return null;

    const rawOrderDeadline = product.order_deadline || product.orderDeadline;
    if (rawOrderDeadline) {
      const parsedIso = new Date(rawOrderDeadline);
      if (!isNaN(parsedIso.getTime())) return parsedIso;
    }

    const date = parseDate(product.deadline);
    if (!date) return null;

    const timeStr = String(product.deadlineTime || product.deadline_time || "23:59").trim();
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);

    const hours = timeMatch ? Number(timeMatch[1]) : 23;
    const minutes = timeMatch ? Number(timeMatch[2]) : 59;

    date.setHours(hours, minutes, 59, 999);
    return date;
  }

  function hasDeadlinePassed(product, now = new Date()) {
    const deadlineDateTime = getDeadlineDateTime(product);
    if (!deadlineDateTime) return false;
    return now.getTime() > deadlineDateTime.getTime();
  }

  function isSoldOut(product) {
    if (product?.category === "fruit") return false;
    const stock = Number(product?.stock || 0);

    if (stock <= 0 || hasDeadlinePassed(product)) {
      return true;
    }

    if (product?.isClosed && stock <= 0) {
      return true;
    }

    return false;
  }

  function stockRatio(product) {
    const stock = Math.max(0, Number(product?.stock) || 0);
    const totalStock = Math.max(0, Number(product?.totalStock ?? product?.initialStock) || 0);
    if (totalStock <= 0) return 0;
    return stock / totalStock;
  }

  function isClosingSoon(product, now = new Date()) {
    if (isSoldOut(product) || !isBeforeDeadline(product, now)) {
      return false;
    }

    const stock = Number(product?.stock || 0);
    const deadlineDateTime = getDeadlineDateTime(product);

    const isLowStock = stock > 0 && stock <= 10;

    let isTimeImminent = false;
    if (deadlineDateTime) {
      const diffMs = deadlineDateTime.getTime() - now.getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      isTimeImminent = diffMs > 0 && diffMs <= twoHoursMs;
    }

    return isLowStock || isTimeImminent;
  }

  function isBeforeDeadline(product, now = new Date()) {
    const deadlineDateTime = getDeadlineDateTime(product);
    if (!deadlineDateTime) return false;
    return now.getTime() <= deadlineDateTime.getTime();
  }

  function canJoinWaitlist(product, now = new Date()) {
    const pickupDate = effectivePickupDate(product);
    if (!pickupDate) return false;
    pickupDate.setHours(23, 59, 59, 999);
    return isBundle(product)
      && Number(product?.stock) <= 0
      && now.getTime() <= pickupDate.getTime();
  }

  function effectivePickupDate(product) {
    const date = parseDate(product?.pickupDate || product?.expectedPickupDate || product?.deadline);
    if (!date) return null;
    return date;
  }

  function adjustedPickupDateForSort(product) {
    const date = parseDate(product?.pickupDate || product?.expectedPickupDate || product?.deadline);
    if (!date) return null;
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    return date;
  }

  function isTodayPickup(product, now = new Date()) {
    const pickupDate = effectivePickupDate(product);
    return isToday(pickupDate, now);
  }

  function formatDate(date) {
    if (!date) return "미정";
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${weekdays[date.getDay()]}`;
  }

  function formatFriendlyDate(date) {
    if (!date) return "수령일 미정";
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${date.getMonth() + 1}.${date.getDate()}(${weekdays[date.getDay()]})`;
  }

  function formatPickupPrefix(product) {
    const date = effectivePickupDate(product);
    if (!date) return "";
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `🧺 ${date.getDate()}일(${weekdays[date.getDay()]})`;
  }

  function isSameCalendarDate(first, second) {
    return Boolean(first && second
      && first.getFullYear() === second.getFullYear()
      && first.getMonth() === second.getMonth()
      && first.getDate() === second.getDate());
  }

  function formatDeadlineTime(product) {
    const timeStr = product?.deadlineTime || product?.deadline_time;
    if (!timeStr) return "";
    const match = String(timeStr).match(/(\d{1,2}):(\d{2})/);
    if (!match) return "";
    return ` ${String(match[1]).padStart(2, "0")}:${match[2]}`;
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

    // 1. 마감임박(재고 10개 이하 OR 2시간 이내) 최우선
    if (isClosingSoon(product, now)) {
      result.push({ key: "urgent", label: "마감임박", tone: "urgent" });
    } 
    // 2. 오늘마감 검사
    else if (isBundle(product) && isToday(product?.deadline, now)) {
      result.push({ key: "today", label: "오늘마감", tone: "deadline" });
    }

    // 3. 인기상품 배지 (판매량 필드 3개 모두 지원 + 3개 이상부터 표시)
    const sales = Number(product?.salesCount ?? product?.recentOrderCount ?? product?.orderCount ?? 0);
    if (sales >= 3) {
      result.push({ key: "popular", label: "인기\n상품", tone: "popular" }); // 두 줄 레이아웃
    }

    return result.slice(0, 2);
  }

  // [추천] 원형 배지 HTML 칩 렌더링 함수 추가
  function renderBadgeChips(product) {
    const badgeList = badges(product);
    if (!badgeList || badgeList.length === 0) return "";

    return badgeList.map(badge => {
      return `<span class="detail-badge ${badge.tone}">${badge.label}</span>`;
    }).join("");
  }

  function priceView(product) {
    if (isSoldOut(product)) {
      return { hidden: true, current: null, original: null, showOriginal: false };
    }
    return {
      hidden: false,
      current: Number(product?.price) || 0,
      original: Number(product?.originalPrice) || null,
      showOriginal: Boolean(product?.showOriginalPrice && Number(product?.originalPrice) > Number(product?.price))
    };
  }

  function recommendationScore(product, now = new Date()) {
    if (isSoldOut(product)) return -1000;

    let score = product?.isRecommended ? 200 : 0;
    if (isBundle(product) && isToday(product?.deadline, now)) score += 50;

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

    const sales = Number(product?.salesCount ?? product?.recentOrderCount ?? product?.orderCount ?? 0);
    score += Math.min(20, Math.max(0, sales));
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
    if (!product) return document.createElement("div");

    const card = document.createElement("article");
    const favorite = window.Favorites?.has?.(product.id) === true;
    const productBadges = badges(product).slice(0, 2);
    const price = priceView(product);

    // 수령일 및 필수 정보 안전 추출 (undefined 처리)
    const pickupPrefix = formatPickupPrefix(product);
    const rawName = product.name || "상품명 없음";
    const subText = product.summary || product.subtitle || product.description || "";
    const imageUrl = product.image || (Array.isArray(product.images) && product.images[0]) || "";

    // 마감 일시 계산
    const showDeadlineTime = product?.showDeadlineTime !== false;
    const deadline = parseDate(product?.deadline);
    const deadlineTime = formatDeadlineTime(product).trim();
    const formattedDeadlineText = deadline 
      ? `${formatFriendlyDate(deadline)}${showDeadlineTime && deadlineTime ? ` ${deadlineTime}` : ""}`
      : "";

    // 할인율 및 정가 계산
    const hasDiscount = price.showOriginal && price.original > price.current;
    const discountRate = hasDiscount 
      ? Math.round(((price.original - price.current) / price.original) * 100) 
      : 0;

    card.className = `popular-card${isSoldOut(product) ? " is-sold-out" : ""}`;
    card.dataset.productId = product.id || "";
    card.dataset.productName = rawName;

    card.innerHTML = `
      <div class="popular-thumb">
        <img src="${escapeHTML(imageUrl)}" alt="${escapeHTML(rawName)}" loading="lazy" onerror="this.src='./images/placeholder.png'" />
        <div class="popular-badges">
          ${productBadges.map((badge) => `<span class="popular-badge ${badge.tone}">${badge.label}</span>`).join("")}
        </div>
        <button type="button" data-favorite-button
          aria-label="${favorite ? "찜 해제하기" : "찜하기"}" aria-pressed="${favorite}">
          ${favorite ? "♥" : "♡"}
        </button>
      </div>

      <div class="popular-card-body">
        <!-- 1. 수령일 -->
        ${pickupPrefix ? `<div class="product-pickup-line">${escapeHTML(pickupPrefix)}</div>` : ""}

        <!-- 2. 한 줄 소개 -->
        ${subText ? `<p>${escapeHTML(subText)}</p>` : ""}

        <!-- 3. 상품명 -->
        <strong>${escapeHTML(rawName)}</strong>

        <!-- 4. 가격 영역 -->
        ${price.hidden ? "" : `
          <div class="product-master-price">
            ${hasDiscount ? `<del>${formatPrice(price.original)}</del>` : ""}
            <div class="price-main">
              ${hasDiscount ? `<span class="discount-rate">${discountRate}%</span>` : ""}
              <b>${formatPrice(price.current)}</b>
            </div>
          </div>
        `}

        <!-- 5. 별점 + 마감일 -->
        <div class="popular-card-meta">
          <span class="meta-rating">★ ${Number(product.rating || 0).toFixed(1)} (${Number(product.reviewsCount || 0)})</span>
          ${isBundle(product) && deadline ? `
            <span class="meta-divider">·</span>
            <span class="meta-deadline">마감 ${escapeHTML(formattedDeadlineText)}</span>
          ` : ""}
        </div>
      </div>
    `;

    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      window.location.href = `./product-detail.html?id=${encodeURIComponent(product.id)}`;
    });
    return card;
  }

  global.ProductRules = {
    isBundle, isSoldOut, isToday, isTodayPickup, stockRatio, isClosingSoon,
    isBeforeDeadline, hasDeadlinePassed, canJoinWaitlist,
    effectivePickupDate, adjustedPickupDateForSort, badges, renderBadgeChips, recommendationScore, priceView, formatPrice,
    formatPickupPrefix
  };
  global.ProductUI = { createProductCard };
})(window);