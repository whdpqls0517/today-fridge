(function () {
  let activeFilter = "all";
  let selectedPickupDate = "";
  let selectedDateProducts = null;
  let selectedDateLoading = false;
  let selectedDateError = "";
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let dateRequestId = 0;

  function startOfDay(value) {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function parseDate(value) {
    const match = String(value || "").match(/(20\d{2})[.-](\d{2})[.-](\d{2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function dateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function productPickupISO(product) {
    const date = pickupDate(product);
    return Number.isFinite(date?.getTime()) ? dateISO(date) : "";
  }

  function dateLabel(value) {
    const date = parseDate(value);
    if (!date) return "전체 수령일";
    return new Intl.DateTimeFormat("ko-KR", {
      month: "long",
      day: "numeric",
      weekday: "short"
    }).format(date);
  }

  // 1. [오늘 수령 및 UI 판별용] 주말 이월 없이 실제 수령 원본 날짜를 반환
  function pickupDate(product) {
    if (window.ProductRules?.effectivePickupDate) {
      return window.ProductRules.effectivePickupDate(product) || new Date(8640000000000000);
    }
    const date = parseDate(product.pickupDate || product.expectedPickupDate || product.deadline);
    if (!date) return new Date(8640000000000000);
    return date;
  }

  // 2. [정렬 전용] 정렬할 때만 토/일요일 건을 월요일로 계산
  function pickupDateForSort(product) {
    if (window.ProductRules?.adjustedPickupDateForSort) {
      return window.ProductRules.adjustedPickupDateForSort(product) || new Date(8640000000000000);
    }
    const date = parseDate(product.pickupDate || product.expectedPickupDate || product.deadline);
    if (!date) return new Date(8640000000000000);
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    return date;
  }

  function isTodayPickup(product, today) {
    const pDate = pickupDate(product);
    if (!pDate || pDate.getTime() === new Date(8640000000000000).getTime()) return false;
    
    return pDate.getFullYear() === today.getFullYear()
      && pDate.getMonth() === today.getMonth()
      && pDate.getDate() === today.getDate();
  }

  // 수량 및 마감 여부 종합 판단 함수
  function isClosedBundle(product, today) {
    const rawQty = product.quantity ?? product.stock ?? product.remainingQty;
    const isSoldOut = rawQty !== undefined && rawQty !== null && Number(rawQty) <= 0;
    const deadlinePassed = window.ProductRules ? window.ProductRules.hasDeadlinePassed(product) : false;

    const finalClosedState = Boolean(
      product.isClosed
      || product.status === "closed"
      || product.status === "finished"
      || product.status === "sold_out"
      || isSoldOut
      || deadlinePassed
    );

    product.isClosed = finalClosedState;
    return finalClosedState;
  }

  function availablePickupDates() {
    const products = window.FridgeDB?.getProducts?.() || [];
    return new Set(products
      .filter((product) => product.category === "bundle")
      .map(productPickupISO)
      .filter(Boolean));
  }

  function renderCalendar() {
    const monthLabel = document.getElementById("bundle-calendar-month");
    const grid = document.getElementById("bundle-calendar-grid");
    if (!monthLabel || !grid) return;

    monthLabel.textContent = new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long"
    }).format(calendarMonth);

    const available = availablePickupDates();
    const todayISO = dateISO(new Date());
    const firstWeekday = calendarMonth.getDay();
    const lastDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    const cells = [];

    for (let index = 0; index < firstWeekday; index += 1) {
      cells.push('<span class="bundle-calendar-empty-day" aria-hidden="true"></span>');
    }

    for (let day = 1; day <= lastDate; day += 1) {
      const value = dateISO(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day));
      const classes = [
        "bundle-calendar-day",
        value === todayISO ? "is-today" : "",
        value === selectedPickupDate ? "is-selected" : "",
        available.has(value) ? "has-products" : ""
      ].filter(Boolean).join(" ");
      const suffix = available.has(value) ? ", 등록된 보따리 있음" : "";
      cells.push(`
        <button class="${classes}" type="button" data-pickup-date="${value}"
          aria-label="${dateLabel(value)}${suffix}" aria-pressed="${value === selectedPickupDate}">
          ${day}
        </button>
      `);
    }

    grid.innerHTML = cells.join("");
  }

  function openCalendar() {
    const modal = document.getElementById("bundle-calendar-modal");
    if (!modal) return;
    const selected = parseDate(selectedPickupDate);
    if (selected) calendarMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
    renderCalendar();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeCalendar() {
    const modal = document.getElementById("bundle-calendar-modal");
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  function updateDateFilterUI() {
    const label = document.getElementById("bundle-date-label");
    const reset = document.getElementById("bundle-date-reset");
    const caption = document.getElementById("bundle-list-caption");
    if (label) label.textContent = dateLabel(selectedPickupDate);
    if (reset) reset.hidden = !selectedPickupDate;
    if (caption) caption.textContent = selectedPickupDate
      ? `${dateLabel(selectedPickupDate)} 수령 보따리`
      : "전체 보따리";
  }

  async function selectPickupDate(value) {
    const requestId = ++dateRequestId;
    selectedPickupDate = value;
    selectedDateProducts = null;
    selectedDateError = "";
    closeCalendar();
    updateDateFilterUI();

    if (!value) {
      selectedDateLoading = false;
      renderBundleList();
      return;
    }

    selectedDateLoading = true;
    renderBundleList();
    try {
      const response = await fetch(`/api/catalog?category=bundle&pickup_date=${encodeURIComponent(value)}`, {
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "날짜별 상품을 불러오지 못했습니다.");
      if (requestId !== dateRequestId) return;
      selectedDateProducts = Array.isArray(result.data) ? result.data : [];
    } catch (error) {
      if (requestId !== dateRequestId) return;
      selectedDateError = "서버 연결을 확인한 뒤 다시 시도해 주세요.";
      selectedDateProducts = (window.FridgeDB?.getProducts?.() || [])
        .filter((product) => product.category === "bundle" && productPickupISO(product) === value);
    } finally {
      if (requestId === dateRequestId) {
        selectedDateLoading = false;
        renderBundleList();
      }
    }
  }

  function renderBundleList() {
    const track = document.getElementById("category-list-track");
    const todayTrack = document.getElementById("bundle-today-track");
    const todaySection = document.getElementById("bundle-today-section");

    if (!track || !todayTrack || !todaySection) {
      return;
    }

    const today = startOfDay(new Date());
    const sortMode = document.getElementById("bundle-sort")?.value || "latest";

    // 1. 데이터 가져오기
    const allBundles = window.FridgeDB?.getProducts ? window.FridgeDB.getProducts().filter((product) => product.category === "bundle") : [];
    if (!window.FridgeDB?.isCatalogLoaded?.() && allBundles.length === 0) {
      todaySection.hidden = true;
      track.innerHTML = Array.from({ length: 4 }, () => `
        <div class="product-loading-card" aria-hidden="true">
          <div class="loading-block product-loading-image"></div>
          <div class="loading-block loading-line loading-line--short"></div>
          <div class="loading-block loading-line"></div>
          <div class="loading-block loading-line loading-line--medium"></div>
        </div>
      `).join("");
      return;
    }

    // 2. 오늘 픽업 보따리와 전체 보따리 분리 (오늘 수령 건도 regularProducts에 포함)
    const todayProducts = [];
    const regularProducts = [];
    const dateScopedProducts = selectedPickupDate
      ? (selectedDateProducts || allBundles.filter((product) => productPickupISO(product) === selectedPickupDate))
      : allBundles;

    allBundles.forEach((product) => {
      isClosedBundle(product, today);

      if (isTodayPickup(product, today)) {
        todayProducts.push(product);
      }
    });

    dateScopedProducts.forEach((product) => {
      isClosedBundle(product, today);
      regularProducts.push(product);
    });

    // 3. 필터링 (진행중 / 마감) 적용
    const filteredProducts = regularProducts.filter((product) => {
      const closed = product.isClosed;
      if (activeFilter === "ongoing") return !closed;
      if (activeFilter === "closed") return closed;
      return true;
    });

    // 4. 정렬 로직 적용
    filteredProducts.sort((a, b) => {
      if (sortMode === "pickup") {
        const aPickup = pickupDateForSort(a);
        const bPickup = pickupDateForSort(b);

        const todayTime = today.getTime();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        const tomorrowTime = tomorrow.getTime();

        const aTime = new Date(aPickup.getFullYear(), aPickup.getMonth(), aPickup.getDate()).getTime();
        const bTime = new Date(bPickup.getFullYear(), bPickup.getMonth(), bPickup.getDate()).getTime();

        // 우선순위 그룹 설정 (0: 내일 이후, 1: 오늘, 2: 과거)
        const getPriorityGroup = (time) => {
          if (time >= tomorrowTime) return 0; // 내일 이상
          if (time === todayTime) return 1;   // 오늘
          return 2;                            // 과거
        };

        const groupA = getPriorityGroup(aTime);
        const groupB = getPriorityGroup(bTime);

        // 1) 그룹이 다르면 그룹 순서대로 (미래 -> 오늘 -> 과거)
        if (groupA !== groupB) {
          return groupA - groupB;
        }

        // 2) 미래 그룹(내일 이후) 내부에서는 빠른 날짜순(오름차순) 정렬!
        if (groupA === 0) {
          return aTime - bTime; // 내일 -> 내일모레 -> 글피 순서
        } else if (groupA === 2) {
          return bTime - aTime; // 과거 그룹은 최근 지난 날짜순
        }
        
        return 0;
      }

      const aLatest = parseDate(a.createdAt || a.deadline)?.getTime() || 0;
      const bLatest = parseDate(b.createdAt || b.deadline)?.getTime() || 0;
      return bLatest - aLatest;
    });

    // 5. 오늘 픽업 화면에 그리기
    todayTrack.innerHTML = "";
    todaySection.hidden = todayProducts.length === 0;
    todayProducts.forEach((product) => {
      todayTrack.append(window.ProductUI.createProductCard(product));
    });

    // 6. 일반 보따리 목록 화면에 그리기
    track.innerHTML = "";
    if (selectedDateLoading) {
      track.innerHTML = Array.from({ length: 4 }, () => `
        <div class="product-loading-card" aria-hidden="true">
          <div class="loading-block product-loading-image"></div>
          <div class="loading-block loading-line loading-line--short"></div>
          <div class="loading-block loading-line"></div>
        </div>
      `).join("");
      return;
    }
    if (filteredProducts.length === 0) {
      const title = selectedDateError ? "목록을 불러오지 못했어요" : "해당 날짜의 보따리가 없어요";
      const detail = selectedDateError || "달력에서 다른 수령일을 선택해 주세요.";
      track.innerHTML = `<div class="product-list-empty"><strong>${title}</strong><p>${detail}</p></div>`;
      return;
    }

    filteredProducts.forEach((product) => {
      track.append(window.ProductUI.createProductCard(product));
    });
  }

  window.renderBundleList = renderBundleList;

  function initBundleList() {
    document.querySelectorAll("[data-bundle-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.bundleFilter;
        document.querySelectorAll("[data-bundle-filter]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
        renderBundleList();
      });
    });

    document.getElementById("bundle-sort")?.addEventListener("change", renderBundleList);
    document.getElementById("bundle-date-trigger")?.addEventListener("click", openCalendar);
    document.getElementById("bundle-date-reset")?.addEventListener("click", () => selectPickupDate(""));
    document.getElementById("bundle-calendar-close")?.addEventListener("click", closeCalendar);
    document.getElementById("bundle-calendar-backdrop")?.addEventListener("click", closeCalendar);
    document.getElementById("bundle-calendar-all")?.addEventListener("click", () => selectPickupDate(""));
    document.getElementById("bundle-calendar-prev")?.addEventListener("click", () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById("bundle-calendar-next")?.addEventListener("click", () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    document.getElementById("bundle-calendar-grid")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pickup-date]");
      if (button) selectPickupDate(button.dataset.pickupDate);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !document.getElementById("bundle-calendar-modal")?.hidden) {
        closeCalendar();
      }
    });
    updateDateFilterUI();
    renderBundleList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBundleList);
  } else {
    initBundleList();
  }
  window.addEventListener("todayFridgeCatalogUpdated", () => {
    renderCalendar();
    if (selectedPickupDate) selectPickupDate(selectedPickupDate);
    else renderBundleList();
  });
})();
