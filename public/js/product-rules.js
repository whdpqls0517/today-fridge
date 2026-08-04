(function (global) {
  function isBundle(product) {
    return product?.category === "bundle" || product?.purchaseMode === "reservation";
  }

  // 💡 날짜 문자열 정밀 파싱
  function parseDate(value) {
    if (!value || value === "상시 판매") return null;
    
    // ISO 문자열이나 Date 객체가 바로 들어온 경우
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

  // 💡 마감 시각 추출 도구 (HH:mm 형식 유연하게 지원)
  function getDeadlineDateTime(product) {
    if (!isBundle(product) || !product?.deadline || product.deadline === "상시 판매") return null;

    // 1. DB의 order_deadline (ISO 타임스탬프)가 직접 있는 경우 최우선 적용
    const rawOrderDeadline = product.order_deadline || product.orderDeadline;
    if (rawOrderDeadline) {
      const parsedIso = new Date(rawOrderDeadline);
      if (!isNaN(parsedIso.getTime())) return parsedIso;
    }

    // 2. deadline 날짜 문자열 기준 파싱
    const date = parseDate(product.deadline);
    if (!date) return null;

    // "18:00", "18:00:00", "오후 6:00" 등 다양한 시간 포맷 파싱 지원
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

    // 1. 수량이 0 이하이거나 마감 시간이 지난 경우 품절/마감
    if (stock <= 0 || hasDeadlinePassed(product)) {
      return true;
    }

    // 2. 명시적으로 closed 되었더라도 수량이 남아있고 시간 내라면 진행 허용
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

    // 잔여 재고가 1~10개일 때 마감 임박입니다.
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

  // 1. [오늘 수령 구역 및 UI 표시용] 주말 날짜를 변형하지 않고 원본 날짜 그대로 반환
  function effectivePickupDate(product) {
    const date = parseDate(product?.pickupDate || product?.expectedPickupDate || product?.deadline);
    if (!date) return null;
    return date;
  }

  // 2. [수령일순 정렬 전용] 정렬 계산 시에만 주말 건을 월요일로 이월 계산
  function adjustedPickupDateForSort(product) {
    const date = parseDate(product?.pickupDate || product?.expectedPickupDate || product?.deadline);
    if (!date) return null;
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    return date;
  }

  // 3. [오늘 수령 여부 체크 전용] 오늘 수령 상품인지 명확히 판별
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

  // ✨ 수령일 프리픽스 전용 포맷터 (예: 🧺 3일(월))
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
    const favorite = window.Favorites?.has(product.id) === true;
    const productBadges = badges(product).slice(0, 2);
    const price = priceView(product);
    const tagList = Array.isArray(product.tags) ? product.tags.slice(0, 2) : [];
    
    // 수령일 프리픽스 및 제목 가공 (span 태그 분리)
    const pickupPrefix = formatPickupPrefix(product);
    const rawName = product.name || "";
    const displayTitleHtml = pickupPrefix 
      ? `<span class="product-pickup-prefix">${escapeHTML(pickupPrefix)}</span> ${escapeHTML(rawName)}` 
      : escapeHTML(rawName);

    // 마감 시각 포맷팅
    const showDeadlineTime = product?.showDeadlineTime !== false;
    const deadline = parseDate(product.deadline);
    const deadlineTime = formatDeadlineTime(product).trim();
    const formattedDeadlineText = `${formatFriendlyDate(deadline)}${showDeadlineTime && deadlineTime ? ` ${deadlineTime}` : ""}`;

    card.className = `popular-card${isSoldOut(product) ? " is-sold-out" : ""}`;
    card.dataset.productId = product.id;
    card.dataset.productName = rawName;

    card.innerHTML = `
      <div class="popular-thumb">
        <img src="${escapeHTML(product.image)}" alt="${escapeHTML(rawName)}" />
        <div class="popular-badges">
          ${productBadges.map((badge) => `<span class="popular-badge ${badge.tone}">${badge.label}</span>`).join("")}
        </div>
        <button type="button" data-favorite-button
          aria-label="${favorite ? "찜 해제하기" : "찜하기"}" aria-pressed="${favorite}">
          ${favorite ? "♥" : "♡"}
        </button>
      </div>
      <strong>${displayTitleHtml}</strong>
      ${price.hidden ? "" : `
        <div class="product-master-price">
          <b>${formatPrice(price.current)}</b>
          ${price.showOriginal ? `<del>${formatPrice(price.original)}</del>` : ""}
          ${isBundle(product) && deadline ? `
            <span class="product-master-deadline-chip">
              마감 <strong>${escapeHTML(formattedDeadlineText)}</strong>
            </span>
          ` : ""}
        </div>
      `}
      <small>${escapeHTML(product.description || "")}</small>
      <div class="popular-card-meta">
        <span>${tagList.map((tag) => escapeHTML(tag)).join(" · ")}</span>
        <span>★ ${Number(product.rating || 0).toFixed(1)} (${Number(product.reviewsCount || 0)})</span>
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
    effectivePickupDate, adjustedPickupDateForSort, badges, recommendationScore, priceView, formatPrice,
    formatPickupPrefix
  };
  global.ProductUI = { createProductCard };
})(window);