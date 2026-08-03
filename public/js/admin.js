// Admin Control Panel Logic
(function () {
  const API_BASE = window.location.origin;
  const authGate = document.getElementById("admin-auth-gate");
  const adminLayout = document.getElementById("admin-layout");
  const adminProductsTable = document.getElementById("admin-products-table");
  const restockDialog = document.getElementById("restock-dialog");
  const restockDialogTitle = document.getElementById("restock-dialog-title");
  const restockDialogContent = document.getElementById("restock-dialog-content");
  const productCategoryButtons = document.querySelectorAll("[data-product-category]");
  const productSearchInput = document.getElementById("admin-product-search");
  const bundlePickupDateField = document.getElementById("bundle-pickup-date-field");
  const bundlePickupDateInput = document.getElementById("admin-bundle-pickup-date");
  const productFilterReset = document.getElementById("product-filter-reset");
  const productResultCount = document.getElementById("admin-product-result-count");
  const arrivalManagementTable = document.getElementById("arrival-management-table");
  const arrivalManagementDate = document.getElementById("arrival-management-date");
  const recommendedSearchForm = document.getElementById("recommended-search-form");
  const recommendedSearchInput = document.getElementById("recommended-search-input");
  const recommendedSearchAdminList = document.getElementById("recommended-search-admin-list");
  const fruitHeroForm = document.getElementById("fruit-hero-form");
  const fruitHeroTitleInput = document.getElementById("fruit-hero-title-input");
  const fruitHeroDescriptionInput = document.getElementById("fruit-hero-description-input");
  const fruitHeroStatus = document.getElementById("fruit-hero-status");
  const fruitTypeForm = document.getElementById("fruit-type-form");
  const fruitTypeNameInput = document.getElementById("fruit-type-name");
  const fruitTypeStatus = document.getElementById("fruit-type-status");
  const fruitTypeList = document.getElementById("fruit-type-list");
  let productCategoryFilter = "all";

  function setFruitHeroStatus(message, tone = "") {
    if (!fruitHeroStatus) return;
    fruitHeroStatus.textContent = message;
    fruitHeroStatus.dataset.tone = tone;
  }

  async function loadFruitHeroAdmin() {
    if (!fruitHeroForm) return;
    setFruitHeroStatus("저장된 문구를 불러오고 있어요.");
    try {
      const response = await fetch(`${API_BASE}/api/admin/site-content/fruit-hero`, {
        headers: { Authorization: `Bearer ${accessToken()}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.setupRequired
          ? "Supabase에 021_site_content.sql을 먼저 실행해 주세요."
          : (result.error || "문구를 불러오지 못했습니다."));
      }
      fruitHeroTitleInput.value = result.data?.title || "";
      fruitHeroDescriptionInput.value = result.data?.description || "";
      setFruitHeroStatus("고객 화면과 연결되어 있습니다.", "success");
    } catch (error) {
      setFruitHeroStatus(error.message || "문구를 불러오지 못했습니다.", "error");
    }
  }

  fruitHeroForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = fruitHeroTitleInput?.value.trim();
    const description = fruitHeroDescriptionInput?.value.trim();
    if (!title || !description) {
      setFruitHeroStatus("제목과 소개 문구를 모두 입력해 주세요.", "error");
      return;
    }

    const submitButton = fruitHeroForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setFruitHeroStatus("저장하고 있어요.");
    try {
      const response = await fetch(`${API_BASE}/api/admin/site-content/fruit-hero`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken()}`
        },
        body: JSON.stringify({ title, description })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "문구를 저장하지 못했습니다.");
      fruitHeroTitleInput.value = result.data.title;
      fruitHeroDescriptionInput.value = result.data.description;
      setFruitHeroStatus("저장되었습니다. 고객 화면에 바로 반영됩니다.", "success");
    } catch (error) {
      setFruitHeroStatus(error.message || "문구를 저장하지 못했습니다.", "error");
    } finally {
      submitButton.disabled = false;
    }
  });

  function fruitTypeEscape(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  async function loadFruitTypesAdmin() {
    if (!fruitTypeList) return;
    fruitTypeList.innerHTML = "<p>과일 종류를 불러오고 있어요.</p>";
    try {
      const response = await fetch(`${API_BASE}/api/admin/fruit-types`, {
        headers: { Authorization: `Bearer ${accessToken()}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "과일 종류를 불러오지 못했습니다.");
      const items = result.data || [];
      const summaryCount = document.getElementById("fruit-type-summary-count");
      if (summaryCount) summaryCount.textContent = `${items.length}개`;
      fruitTypeList.innerHTML = items.length ? items.map((item) => `
        <div class="fruit-type-row" data-fruit-type-id="${item.id}">
          <strong>${fruitTypeEscape(item.name)}</strong>
          <span>${item.is_active ? "사용 중" : "숨김"}</span>
          <button type="button" data-fruit-type-toggle="${item.id}" data-next-active="${item.is_active ? "false" : "true"}">${item.is_active ? "숨기기" : "다시 사용"}</button>
        </div>`).join("") : "<p>등록된 과일 종류가 없습니다.</p>";
      if (fruitTypeStatus) fruitTypeStatus.textContent = `총 ${items.length}개 종류`;
    } catch (error) {
      fruitTypeList.innerHTML = `<p>${fruitTypeEscape(error.message || "과일 종류를 불러오지 못했습니다.")}</p>`;
    }
  }

  fruitTypeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = fruitTypeNameInput.value.trim();
    if (!name) return;
    try {
      const response = await fetch(`${API_BASE}/api/admin/fruit-types`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken()}` },
        body: JSON.stringify({ name })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "과일 종류를 추가하지 못했습니다.");
      fruitTypeNameInput.value = "";
      await loadFruitTypesAdmin();
    } catch (error) {
      fruitTypeStatus.textContent = error.message || "과일 종류를 추가하지 못했습니다.";
    }
  });

  fruitTypeList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-fruit-type-toggle]");
    if (!button) return;
    button.disabled = true;
    try {
      const response = await fetch(`${API_BASE}/api/admin/fruit-types/${button.dataset.fruitTypeToggle}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken()}` },
        body: JSON.stringify({ isActive: button.dataset.nextActive === "true" })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "상태를 변경하지 못했습니다.");
      await loadFruitTypesAdmin();
    } catch (error) {
      fruitTypeStatus.textContent = error.message || "상태를 변경하지 못했습니다.";
      button.disabled = false;
    }
  });

  const fruitTypeDialog = document.getElementById("fruit-type-dialog");
  document.getElementById("open-fruit-type-manager")?.addEventListener("click", () => {
    if (typeof fruitTypeDialog?.showModal === "function") fruitTypeDialog.showModal();
    else fruitTypeDialog?.setAttribute("open", "");
  });
  document.getElementById("close-fruit-type-manager")?.addEventListener("click", () => fruitTypeDialog?.close());
  fruitTypeDialog?.addEventListener("click", (event) => {
    if (event.target === fruitTypeDialog) fruitTypeDialog.close();
  });

  function readJSON(value) {
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function accessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const value = readJSON(localStorage.getItem(key));
      const token = value?.access_token || value?.currentSession?.access_token;
      if (token) return token;
    }
    return null;
  }

  function blockAdmin(reason, loginRequired) {
    authGate.innerHTML = `
      <strong>${loginRequired ? "로그인이 필요해요" : "접근 권한이 없어요"}</strong>
      <p>${reason}</p>
      <a class="admin-auth-link" href="${loginRequired ? "./login.html?next=admin" : "./index.html"}">
        ${loginRequired ? "관리자 계정으로 로그인" : "고객 화면으로 돌아가기"}
      </a>`;
    window.setTimeout(() => {
      window.location.replace(loginRequired ? "./login.html?next=admin" : "./index.html");
    }, 1200);
  }

  async function verifyAdmin() {
    const token = accessToken();
    if (!token) {
      blockAdmin("관리자 계정으로 다시 로그인해 주세요.", true);
      return false;
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();

      if (response.status === 401) {
        localStorage.removeItem("todayFridgeAccessToken");
        blockAdmin("로그인이 만료되었습니다.", true);
        return false;
      }
      if (!response.ok || result.profile?.role !== "admin") {
        blockAdmin("이 페이지는 관리자 계정만 사용할 수 있습니다.", false);
        return false;
      }

      authGate.hidden = true;
      adminLayout.setAttribute("aria-hidden", "false");
      document.body.classList.remove("is-auth-checking");
      return true;
    } catch (_) {
      blockAdmin("백엔드 서버 연결을 확인해 주세요.", true);
      return false;
    }
  }

  async function syncServerCatalogToLocal() {
    try {
      const token = accessToken();
      if (!token) return { success: false, error: "관리자 로그인이 필요합니다." };
      const response = await fetch(`${API_BASE}/api/admin/catalog`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (response.ok && result.success && Array.isArray(result.data) && window.FridgeDB) {
        window.FridgeDB.replaceProducts(result.data);
        return { success: true };
      }
      return { success: false, error: result.error || "상품을 불러오지 못했습니다." };
    } catch (error) {
      return { success: false, error: error.message || "상품을 불러오지 못했습니다." };
    }
  }

  async function syncAdminOrdersToLocal() {
    if (adminOrdersSyncing) return { success: true };
    const token = accessToken();
    if (!token || !window.FridgeDB?.replaceOrders) {
      return { success: false, error: "주문을 불러올 준비가 되지 않았습니다." };
    }
    adminOrdersSyncing = true;
    try {
      const response = await fetch(`${API_BASE}/api/admin/orders`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        return { success: false, error: result.error || "주문을 불러오지 못했습니다." };
      }
      window.FridgeDB.replaceOrders(result.data.map((order) => {
        const item = order.bundle_items || {};
        const product = item.products || {};
        return {
          id: order.id,
          orderNumber: order.order_number,
          userId: order.user_id,
          customerName: order.profiles?.name || "고객",
          productId: product.id,
          bundleItemId: order.bundle_item_id,
          productName: product.name || "",
          quantity: order.quantity,
          price: order.total_amount,
          paymentType: order.payment_type,
          paymentStatus: order.payment_status,
          transferApproved: order.payment_status === "confirmed",
          status: order.status,
          bundleDate: item.bundles?.default_pickup_date || order.pickup_date,
          pickupDate: order.pickup_date,
          pickupTime: order.pickup_time_label,
          depositorName: order.depositor_name || "",
          arrivalStatus: item.arrival_status,
          barcodeValue: item.barcode_value,
          barcodeLocked: order.barcode_locked,
          receivedAt: order.received_at,
          cancelledAt: order.cancelled_at,
          expiredAt: order.expired_at,
          restoredAt: order.restored_at,
          updatedAt: order.updated_at,
          createdAt: order.created_at
        };
      }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || "주문을 불러오지 못했습니다." };
    } finally {
      adminOrdersSyncing = false;
    }
  }

  async function renderRecommendedSearchAdmin() {
    if (!recommendedSearchAdminList) return;
    try {
      const response = await fetch(`${API_BASE}/api/search/recommendations`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "추천 검색어를 불러오지 못했습니다.");
      if (result.setupRequired) {
        recommendedSearchAdminList.innerHTML = `<p class="recommended-search-setup">Supabase에 추천 검색어 테이블을 먼저 생성해 주세요.</p>`;
        return;
      }
      recommendedSearchAdminList.innerHTML = result.data.length
        ? result.data.map((item) => `
            <span class="recommended-search-admin-chip">
              <b>${adminEscape(item.term)}</b>
              <button type="button" onclick="removeRecommendedSearch('${item.id}')" aria-label="${adminEscape(item.term)} 삭제">×</button>
            </span>`).join("")
        : `<p>직접 지정한 검색어가 없습니다. 현재는 판매 상품 기준으로 자동 추천됩니다.</p>`;
    } catch (error) {
      recommendedSearchAdminList.innerHTML = `<p>${adminEscape(error.message)}</p>`;
    }
  }

  recommendedSearchForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const term = recommendedSearchInput?.value.trim();
    if (!term) return;
    const token = accessToken();
    try {
      const response = await fetch(`${API_BASE}/api/admin/search/recommendations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ term })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "추천 검색어를 추가하지 못했습니다.");
      recommendedSearchInput.value = "";
      await renderRecommendedSearchAdmin();
    } catch (error) {
      alert(error.message);
    }
  });

  window.removeRecommendedSearch = async function (id) {
    const token = accessToken();
    try {
      const response = await fetch(`${API_BASE}/api/admin/search/recommendations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "추천 검색어를 삭제하지 못했습니다.");
      await renderRecommendedSearchAdmin();
    } catch (error) {
      alert(error.message);
    }
  };

  const statTodayOrders = document.getElementById("stat-today-orders");
  const statTodayOrdersDetail = document.getElementById("stat-today-orders-detail");
  const statTodayPickups = document.getElementById("stat-today-pickups");
  const statTodayPickupsDetail = document.getElementById("stat-today-pickups-detail");
  const statPendingApproval = document.getElementById("stat-pending-approval");
  const statExpiredOrders = document.getElementById("stat-expired-orders");
  const statTodayUnpaid = document.getElementById("stat-today-unpaid");
  const packingScopeLabel = document.getElementById("packing-scope-label");
  const packingOrderSearch = document.getElementById("packing-order-search");
  const packingPickupDate = document.getElementById("packing-pickup-date");
  const packingUnreceivedOnly = document.getElementById("packing-unreceived-only");
  const packingFilterReset = document.getElementById("packing-filter-reset");

  const packingTable = document.getElementById("packing-orders-table");
  const unclaimedTable = document.getElementById("unclaimed-orders-table");
  const expiredHistoryTable = document.getElementById("expired-history-table");
  const expiredHistoryTotal = document.getElementById("expired-history-total");
  const expiredRangeButtons = document.querySelectorAll("[data-expired-range]");
  const expiredDateFrom = document.getElementById("expired-date-from");
  const expiredDateTo = document.getElementById("expired-date-to");
  const expiredHistorySearch = document.getElementById("expired-history-search");
  const expiredHistoryStatus = document.getElementById("expired-history-status");
  
  const noshowCountDisplay = document.getElementById("noshow-count-display");
  const noshowUsername = document.getElementById("noshow-username");
  const noshowUserCode = document.getElementById("noshow-userkakao");
  const memberNoShowPanel = document.getElementById("member-noshow-panel");
  const adminReviewsContainer = document.getElementById("admin-reviews-container");
  const adminInquiriesContainer = document.getElementById("admin-inquiries-container");
  const memberAdminList = document.getElementById("member-admin-list");
  const memberSearchInput = document.getElementById("member-search-input");
  const memberChatUrlInput = document.getElementById("member-chat-url-input");
  const memberResultCount = document.getElementById("member-result-count");
  const notificationForm = document.getElementById("admin-notification-form");
  const notificationAudience = document.getElementById("admin-notification-audience");
  const notificationBundleField = document.getElementById("admin-notification-bundle-field");
  const notificationBundle = document.getElementById("admin-notification-bundle");
  const notificationMemberField = document.getElementById("admin-notification-member-field");
  const notificationMember = document.getElementById("admin-notification-member");
  const notificationTitle = document.getElementById("admin-notification-title");
  const notificationBody = document.getElementById("admin-notification-body");
  const notificationBodyCount = document.getElementById("admin-notification-body-count");
  const notificationLink = document.getElementById("admin-notification-link");
  const notificationPreviewButton = document.getElementById("admin-notification-preview-button");
  const notificationSendButton = document.getElementById("admin-notification-send-button");
  const notificationStatus = document.getElementById("admin-notification-status");
  const notificationPreviewTitle = document.getElementById("admin-notification-preview-title");
  const notificationPreviewBody = document.getElementById("admin-notification-preview-body");
  const notificationRecipientCount = document.getElementById("admin-notification-recipient-count");
  const filterProductSelect = document.getElementById("filter-order-product");

  let currentAdminTab = "display";
  let packingScope = "all";
  let adminOrdersSyncing = false;
  let expiredRange = "today";
  let currentNoShowSection = "unclaimed";
  let selectedNoShowMember = null;
  let memberCache = new Map();
  let notificationPreview = null;
  let notificationRequestKey = "";

  function localISO(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function orderDateISO(order) {
    const value = order.createdAt || order.orderedAt || order.bundleDate || "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  function pickupDateISO(order) {
    return String(order.pickupDateISO || order.pickupDate || "").slice(0, 10);
  }

  function shortPickupText(order) {
    const iso = pickupDateISO(order);
    const dateText = /^\d{4}-(\d{2})-(\d{2})$/.test(iso)
      ? iso.replace(/^\d{4}-(\d{2})-(\d{2})$/, "$1.$2")
      : (iso || "-");
    const timeText = String(order.pickupTime || "").trim();
    return timeText ? `${dateText} · ${timeText}` : dateText;
  }

  function expirationDateISO(order) {
    const timestamp = order.expiredAt
      || (String(order.status || "").toLowerCase() === "expired" ? order.updatedAt : "");
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? String(timestamp).slice(0, 10) : localISO(date);
  }

  function expirationTimeText(order) {
    const timestamp = order.expiredAt
      || (String(order.status || "").toLowerCase() === "expired" ? order.updatedAt : "");
    if (!timestamp) return "-";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return String(timestamp);
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function isUnprocessedMissedPickup(order, today = localISO()) {
    const status = String(order?.status || "").toLowerCase();
    const pickupDate = pickupDateISO(order);
    if (!pickupDate || pickupDate >= today) return false;
    if (["cancelled", "canceled", "completed", "expired"].includes(status)) return false;
    if (order?.receivedAt || order?.expiredAt || order?.restoredAt) return false;
    return ["pending", "applied", "ready"].includes(status);
  }

  function filterOrdersByScope(orders) {
    const today = localISO();
    const active = (order) => !["cancelled", "canceled"].includes(String(order.status || "").toLowerCase());
    if (packingScope === "today-orders") return orders.filter((order) => active(order) && orderDateISO(order) === today);
    if (packingScope === "today-pickups") return orders.filter((order) =>
      active(order) && pickupDateISO(order) === today && ["pending", "applied", "ready", "completed"].includes(order.status)
    );
    if (packingScope === "pending-transfer") return orders.filter((order) => active(order) && order.paymentType === "transfer" && ["pending", "applied", "ready"].includes(order.status) && !order.transferApproved);
    if (packingScope === "expired") return orders.filter((order) => order.status === "expired");
    return orders;
  }

  window.openPackingFilter = function (scope) {
    packingScope = scope;
    window.switchAdminTab("packing");
  };

  window.openExpiredHistory = function (range = "today") {
    expiredRange = range;
    syncExpiredRangeButtons();
    window.switchAdminTab("noshow");
    window.switchNoShowSection("history");
  };

  window.openUnclaimedOrders = function () {
    window.switchAdminTab("noshow");
    window.switchNoShowSection("unclaimed");
  };

  window.switchNoShowSection = function (section) {
    currentNoShowSection = section;
    document.querySelectorAll("[data-noshow-section]").forEach((panel) => {
      panel.hidden = panel.dataset.noshowSection !== section;
    });
    document.querySelectorAll("[data-noshow-tab]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.noshowTab === section);
    });
    if (section === "unclaimed") renderUnclaimedOrders();
    if (section === "history") renderExpiredHistory();
    if (section === "members") renderUserNoShowPanel();
  };

  window.switchAdminTab = function (tab) {
    currentAdminTab = tab;
    document.querySelectorAll(".admin-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("onclick").includes(tab));
    });
    
    document.querySelectorAll(".admin-tab-content").forEach((content) => {
      content.style.display = "none";
    });
    const isHomeTab = tab === "display";
    document.querySelector(".admin-main")?.classList.toggle("is-home-tab", isHomeTab);
    const homeStats = document.getElementById("admin-home-stats");
    if (homeStats) homeStats.hidden = !isHomeTab;

    const targetTab = document.getElementById(`tab-${tab}`);
    if (targetTab) {
      targetTab.style.display = "";
    }
    renderAdminDashboard();
  };

  function renderAdminDashboard() {
    renderStats();
    
    if (currentAdminTab === "products") {
      renderProductManagement();
    } else if (currentAdminTab === "arrivals") {
      renderArrivalManagement();
    } else if (currentAdminTab === "packing") {
      renderAdminOrders();
    } else if (currentAdminTab === "noshow") {
      renderExpiredHistory();
      renderUnclaimedOrders();
      renderUserNoShowPanel();
    } else if (currentAdminTab === "reviews") {
      renderReviewsPanel();
      renderInquiriesPanel();
    } else if (currentAdminTab === "members") {
      renderMemberManagement();
    } else if (currentAdminTab === "notifications") {
      prepareNotificationComposer();
    }
  }

  function notificationPayload(includeContent = false) {
    const payload = {
      audience: notificationAudience?.value || "",
      bundleItemId: notificationBundle?.value || null,
      memberId: notificationMember?.value || null
    };
    if (includeContent) {
      payload.title = notificationTitle?.value.trim() || "";
      payload.body = notificationBody?.value.trim() || "";
      payload.linkTarget = notificationLink?.value || "notifications";
      payload.requestKey = notificationRequestKey;
    }
    return payload;
  }

  function createNotificationRequestKey() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const randomPart = Math.random().toString(36).slice(2, 14);
    return `notice-${Date.now()}-${randomPart}`;
  }

  async function readNotificationResponse(response) {
    const raw = await response.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (_) {
      throw new Error(`서버 응답을 확인하지 못했습니다. (${response.status})`);
    }
  }

  function invalidateNotificationPreview(message = "대상 인원을 먼저 확인해 주세요.") {
    notificationPreview = null;
    notificationRequestKey = "";
    if (notificationRecipientCount) notificationRecipientCount.textContent = "-";
    if (notificationSendButton) notificationSendButton.disabled = true;
    if (notificationStatus) {
      notificationStatus.textContent = message;
      notificationStatus.dataset.tone = "";
    }
  }

  async function prepareNotificationComposer() {
    if (!notificationForm) return;
    const bundles = (window.FridgeDB?.getProducts?.() || [])
      .filter((product) => product.category === "bundle" && product.bundleItemId)
      .sort((left, right) => String(right.pickupDate || "").localeCompare(String(left.pickupDate || "")));
    const currentBundle = notificationBundle?.value || "";
    notificationBundle.innerHTML = `<option value="">보따리를 선택해 주세요</option>${bundles.map((product) =>
      `<option value="${adminEscape(product.bundleItemId)}" data-product-id="${adminEscape(product.id)}">${adminEscape(product.name)}${product.pickupDate ? ` · ${adminEscape(String(product.pickupDate).slice(5).replace("-", "."))} 수령` : ""}</option>`
    ).join("")}`;
    if ([...notificationBundle.options].some((option) => option.value === currentBundle)) notificationBundle.value = currentBundle;

    if (!memberCache.size) {
      try {
        const response = await fetch(`${API_BASE}/api/admin/members`, {
          headers: { Authorization: `Bearer ${accessToken()}` },
          cache: "no-store"
        });
        const result = await response.json();
        if (response.ok && result.success) memberCache = new Map(result.data.map((member) => [member.id, member]));
      } catch (_) {}
    }
    const currentMember = notificationMember?.value || "";
    notificationMember.innerHTML = `<option value="">회원을 선택해 주세요</option>${[...memberCache.values()]
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "ko-KR"))
      .map((member) => `<option value="${adminEscape(member.id)}">${adminEscape(member.name || "고객")} · ${adminEscape(String(member.id).slice(0, 8).toUpperCase())}</option>`)
      .join("")}`;
    if ([...notificationMember.options].some((option) => option.value === currentMember)) notificationMember.value = currentMember;
    syncNotificationAudienceFields();
  }

  function syncNotificationAudienceFields() {
    const audience = notificationAudience?.value || "";
    const linksToBundle = notificationLink?.value === "bundle_detail";
    const usesBundle = audience.startsWith("bundle_") || linksToBundle;
    if (notificationBundleField) notificationBundleField.hidden = !usesBundle;
    if (notificationMemberField) notificationMemberField.hidden = audience !== "member";
    invalidateNotificationPreview();
  }

  function syncNotificationPreviewCopy() {
    if (notificationPreviewTitle) notificationPreviewTitle.textContent = notificationTitle?.value.trim() || "알림 제목";
    if (notificationPreviewBody) notificationPreviewBody.textContent = notificationBody?.value.trim() || "입력한 안내 내용이 이곳에 표시됩니다.";
    if (notificationBodyCount) notificationBodyCount.textContent = String(notificationBody?.value.length || 0);
  }

  notificationAudience?.addEventListener("change", syncNotificationAudienceFields);
  notificationLink?.addEventListener("change", syncNotificationAudienceFields);
  notificationBundle?.addEventListener("change", () => invalidateNotificationPreview());
  notificationMember?.addEventListener("change", () => invalidateNotificationPreview());
  notificationTitle?.addEventListener("input", syncNotificationPreviewCopy);
  notificationBody?.addEventListener("input", syncNotificationPreviewCopy);

  async function verifyNotificationRecipients() {
    const target = notificationPayload(false);
    if (notificationLink?.value === "bundle_detail" && !target.bundleItemId) {
      throw new Error("이동할 보따리를 선택해 주세요.");
    }
    const response = await fetch(`${API_BASE}/api/admin/notifications/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken()}` },
      body: JSON.stringify(target)
    });
    const result = await readNotificationResponse(response);
    if (!response.ok || !result.success) throw new Error(result.error || "발송 대상을 확인하지 못했습니다.");
    notificationPreview = { ...target, count: Number(result.data?.count) || 0 };
    notificationRequestKey = createNotificationRequestKey();
    if (notificationRecipientCount) notificationRecipientCount.textContent = `${notificationPreview.count}명`;
    return notificationPreview;
  }

  notificationPreviewButton?.addEventListener("click", async () => {
    const button = notificationPreviewButton;
    button.disabled = true;
    invalidateNotificationPreview("대상 고객을 확인하고 있습니다.");
    try {
      await verifyNotificationRecipients();
      notificationSendButton.disabled = notificationPreview.count < 1;
      notificationStatus.textContent = notificationPreview.count
        ? `${notificationPreview.count}명에게 보낼 수 있습니다. 제목과 내용을 확인한 뒤 발송해 주세요.`
        : "조건에 맞는 고객이 없습니다.";
      notificationStatus.dataset.tone = notificationPreview.count ? "success" : "error";
    } catch (error) {
      notificationStatus.textContent = error.message || "발송 대상을 확인하지 못했습니다.";
      notificationStatus.dataset.tone = "error";
    } finally {
      button.disabled = false;
    }
  });

  notificationForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = notificationTitle?.value.trim() || "";
    const body = notificationBody?.value.trim() || "";
    if (title.length < 2 || body.length < 2) {
      notificationStatus.textContent = "알림 제목과 내용을 2자 이상 입력해 주세요.";
      notificationStatus.dataset.tone = "error";
      return;
    }
    notificationSendButton.disabled = true;
    notificationStatus.textContent = "발송 대상을 최종 확인하고 있습니다.";
    notificationStatus.dataset.tone = "";
    try {
      const verifiedPreview = await verifyNotificationRecipients();
      if (verifiedPreview.count < 1) throw new Error("조건에 맞는 고객이 없습니다. 대상을 다시 확인해 주세요.");
      if (!window.confirm(`${verifiedPreview.count}명에게 알림을 발송할까요?\n발송 후에는 고객 알림센터에서 회수할 수 없습니다.`)) {
        notificationStatus.textContent = `${verifiedPreview.count}명에게 보낼 수 있습니다.`;
        notificationStatus.dataset.tone = "success";
        notificationSendButton.disabled = false;
        return;
      }
      notificationStatus.textContent = "알림을 등록하고 있습니다.";
      const response = await fetch(`${API_BASE}/api/admin/notifications/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken()}` },
        body: JSON.stringify(notificationPayload(true))
      });
      const result = await readNotificationResponse(response);
      if (!response.ok || !result.success) throw new Error(result.error || "알림을 발송하지 못했습니다.");
      const savedCount = Number(result.data?.newlyQueued) || 0;
      if (savedCount < 1) throw new Error("새로 저장된 알림이 없습니다. 대상 인원을 다시 확인한 뒤 재시도해 주세요.");
      notificationStatus.textContent = `${savedCount}명의 알림센터에 등록하고 웹 푸시 발송을 요청했습니다.`;
      notificationStatus.dataset.tone = "success";
      notificationRequestKey = "";
      notificationPreview = null;
      notificationRecipientCount.textContent = `${savedCount}명 발송 완료`;
    } catch (error) {
      notificationStatus.textContent = error.message || "알림을 발송하지 못했습니다.";
      notificationStatus.dataset.tone = "error";
      notificationSendButton.disabled = false;
    }
  });

  async function renderMemberManagement() {
    if (!memberAdminList) return;
    memberAdminList.innerHTML = `<p class="member-list-empty">회원 목록을 불러오고 있습니다.</p>`;
    const token = accessToken();
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/api/admin/members`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "회원 목록을 불러오지 못했습니다.");
      memberCache = new Map(result.data.map((member) => [member.id, member]));
      const keyword = memberSearchInput?.value.trim().toLocaleLowerCase("ko-KR") || "";
      const members = result.data.filter((member) => {
        const memberCode = String(member.id || "").slice(0, 8).toLocaleLowerCase("ko-KR");
        const searchable = `${member.name || "고객"} ${memberCode}`.toLocaleLowerCase("ko-KR");
        return !keyword || searchable.includes(keyword);
      });
      if (memberResultCount) memberResultCount.textContent = `${members.length}명`;
      memberAdminList.innerHTML = members.length ? members.map((member) => `
        <article class="member-admin-row">
          <span class="member-avatar">${adminEscape((member.name || "고객").slice(0, 1))}</span>
          <div class="member-admin-copy">
            <strong>${adminEscape(member.name || "고객")}</strong>
            <small>회원번호 ${adminEscape(String(member.id).slice(0, 8).toUpperCase())} · 카카오 가입</small>
          </div>
          <div class="member-order-count"><strong>${Number(member.no_show_count) || 0}</strong><small>노쇼</small></div>
          <div class="member-row-actions">
            <button class="member-noshow-button" type="button" onclick="openMemberNoShow('${member.id}')">노쇼 관리</button>
            <button class="member-contact-button" type="button" onclick="sendMemberContactRequest('${member.id}', '${adminEscape(member.name || "고객")}')">연락 요청</button>
          </div>
        </article>`).join("") : `<p class="member-list-empty">${keyword ? "검색 결과가 없습니다." : "아직 가입한 고객 회원이 없습니다.<br>관리자 계정은 연락 대상에서 제외됩니다."}</p>`;
    } catch (error) {
      memberAdminList.innerHTML = `<p class="member-list-empty">${adminEscape(error.message || "회원 목록을 불러오지 못했습니다.")}</p>`;
    }
  }

  memberSearchInput?.addEventListener("input", renderMemberManagement);

  window.openMemberNoShow = function (memberId) {
    const member = memberCache.get(memberId);
    if (!member) {
      alert("선택한 회원 정보를 다시 불러와 주세요.");
      return;
    }
    selectedNoShowMember = { ...member };
    window.switchAdminTab("noshow");
    document.getElementById("member-noshow-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  if (memberChatUrlInput) {
    memberChatUrlInput.value = localStorage.getItem("todayFridgeAdminOpenChatUrl") || "";
    memberChatUrlInput.addEventListener("change", () => {
      localStorage.setItem("todayFridgeAdminOpenChatUrl", memberChatUrlInput.value.trim());
    });
  }

  window.sendMemberContactRequest = async function (memberId, memberName) {
    const openChatUrl = memberChatUrlInput?.value.trim() || "";
    if (!/^https:\/\/open\.kakao\.com\//i.test(openChatUrl)) {
      alert("회원 관리 상단에 카카오 1:1 오픈채팅 주소를 먼저 입력해 주세요.");
      memberChatUrlInput?.focus();
      return;
    }
    if (!confirm(`${memberName} 회원에게 1:1 채팅 연락 요청 알림을 보낼까요?`)) return;
    localStorage.setItem("todayFridgeAdminOpenChatUrl", openChatUrl);
    const token = accessToken();
    try {
      const response = await fetch(`${API_BASE}/api/admin/members/${encodeURIComponent(memberId)}/contact-request`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "확인할 내용이 있습니다. 1:1 채팅으로 연락 부탁드립니다.",
          openChatUrl
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "알림을 보내지 못했습니다.");
      alert(`${memberName} 회원에게 연락 요청 알림을 보냈습니다.`);
    } catch (error) {
      alert(error.message || "알림을 보내지 못했습니다.");
    }
  };

  function badgeSummary(product) {
    const badges = window.ProductRules.badges(product);
    if (!badges.length) return `<span class="admin-badge green">정상 판매</span>`;
    return badges.map((badge) => {
      const tone = badge.tone === "popular" ? "green" : badge.tone === "deadline" ? "black" : "red";
      return `<span class="admin-badge ${tone}">${badge.label}</span>`;
    }).join(" ");
  }

  function renderProductManagement() {
    if (!adminProductsTable) return;
    const searchTerm = productSearchInput?.value.trim().toLocaleLowerCase("ko-KR") || "";
    const pickupDate = bundlePickupDateInput?.value || "";
    const products = window.FridgeDB.getProducts().filter((product) => {
      if (productCategoryFilter !== "all" && product.category !== productCategoryFilter) return false;
      if (searchTerm && !`${product.name || ""} ${product.description || ""}`.toLocaleLowerCase("ko-KR").includes(searchTerm)) return false;
      if (productCategoryFilter === "bundle" && pickupDate && product.pickupDate !== pickupDate) return false;
      return true;
    });
    if (productResultCount) productResultCount.textContent = products.length;
    if (!products.length) {
      adminProductsTable.innerHTML = `
        <tr><td class="admin-empty-row" colspan="9">
          <strong>조건에 맞는 상품이 없습니다.</strong>
          <span>상품 유형이나 수령일을 다시 선택해 주세요.</span>
        </td></tr>`;
      return;
    }
    adminProductsTable.innerHTML = products.map((product) => `
      <tr>
        <td>
          <div class="admin-product-cell">
            <img src="${product.image}" alt="" />
            <span><strong>${product.name}</strong><small>${product.description || ""}</small></span>
          </div>
        </td>
        <td>${product.category === "bundle" ? "보따리" : product.category === "fruit" ? "오늘의 과일" : "매장 쇼룸"}</td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="admin-switch ${product.isRecommended ? "is-on" : ""}" type="button"
              onclick="toggleProductRecommended('${product.id}')" aria-label="추천 상품 전환"></button>
            <span>${product.isRecommended ? "추천" : "일반"}</span>
          </div>
        </td>
        <td><strong>${Number(product.price || 0).toLocaleString("ko-KR")}원</strong></td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="admin-switch ${product.showOriginalPrice ? "is-on" : ""}" type="button"
              onclick="toggleOriginalPrice('${product.id}')" aria-label="할인 전 가격 노출 전환"></button>
            <span>${product.showOriginalPrice ? `${Number(product.originalPrice || 0).toLocaleString("ko-KR")}원 노출` : "숨김"}</span>
          </div>
        </td>
        <td><div style="display:flex; flex-direction:column; gap:6px;"><span>${product.category === "fruit" ? "수량 관리 안 함" : `잔여 ${product.stock} / 전체 ${product.totalStock || product.stock}개`}</span><span>${badgeSummary(product)}</span></div></td>
        <td><button class="admin-link-button" type="button" onclick="showRestockSubscribers('${product.id}')">${window.ProductRules.canJoinWaitlist(product) ? `대기 ${product.waitlistRequests || 0}명` : `재입고 ${product.restockRequests || 0}명`} · 명단 보기</button></td>
        <td>
          <button class="admin-switch ${!product.isClosed ? "is-on" : ""}" type="button"
            onclick="toggleProductClosed('${product.id}')" aria-label="판매 상태 전환"></button>
        </td>
        <td>
          <div class="admin-row-actions">
            <a class="admin-edit-link" href="./admin-product-form.html?id=${encodeURIComponent(product.id)}">수정</a>
            <button class="admin-delete-link" type="button" onclick="deleteAdminProduct('${product.id}')">삭제</button>
          </div>
        </td>
      </tr>`).join("");
  }

  function adminEscape(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  function renderArrivalManagement() {
    if (!arrivalManagementTable) return;
    const today = localISO();
    
    if (arrivalManagementDate) {
      arrivalManagementDate.textContent = new Date(`${today}T00:00:00`).toLocaleDateString("ko-KR", {
        month: "long",
        day: "numeric",
        weekday: "short"
      });
    }

    const products = window.FridgeDB.getProducts().filter((product) => {
      if (product.category !== "bundle" || product.isActive === false) return false;
      const productPickupDate = String(product.pickupDate || "").slice(0, 10);
      return productPickupDate === today;
    });

    if (!products.length) {
      arrivalManagementTable.innerHTML = `
        <tr><td class="admin-empty-row" colspan="4">
          <strong>오늘 수령 예정인 보따리가 없습니다.</strong>
          <span>수령 지정일이 '오늘'인 보따리 상품만 이곳에 자동으로 표시됩니다.</span>
        </td></tr>`;
      return;
    }

    arrivalManagementTable.innerHTML = products.map((product) => {
      const currentStatus = product.arrivalStatus;
      const arrived = currentStatus === "arrived";

      return `
        <tr data-arrival-product="${adminEscape(product.id)}">
          <td>
            <div class="admin-product-cell">
              <img src="${adminEscape(product.image)}" alt="" />
              <span><strong>${adminEscape(product.name)}</strong><small>오늘 수령 예정</small></span>
            </div>
          </td>
          <td><span class="arrival-state-badge ${arrived ? "is-ready" : ""}">${arrived ? "수령 가능" : "입고 예정"}</span></td>
          <td><input class="arrival-text-input" maxlength="40" value="${adminEscape(product.arrivalExpectedText || "")}" placeholder="예: 오후 2시 입고 예정" ${arrived ? "disabled" : ""} /></td>
          <td>
            <div class="arrival-management-actions">
              ${arrived
                ? `<button class="arrival-secondary-button" type="button" onclick="toggleProductArrival('${product.id}')">예정으로 되돌리기</button>`
                : `<button class="arrival-save-button" type="button" onclick="saveArrivalSchedule('${product.id}')">예정 저장</button>
                   <button class="arrival-ready-button" type="button" onclick="toggleProductArrival('${product.id}')">입고 완료</button>`}
              ${product.bundleItemId
                ? `<button class="arrival-secondary-button" type="button" onclick="sendBundlePickupReminder('${product.bundleItemId}')">미수령 고객 알림</button>`
                : ""}
            </div>
          </td>
        </tr>`;
    }).join("");
  }

  window.sendBundlePickupReminder = async function (bundleItemId) {
    const token = accessToken();
    if (!token || !bundleItemId) {
      alert("로그인 상태와 보따리 연결 정보를 확인해 주세요.");
      return;
    }
    if (!confirm("이 보따리를 아직 수령하지 않은 고객 모두에게 수령 알림을 보낼까요?")) return;
    try {
      const response = await fetch(`${API_BASE}/api/admin/bundle-items/${bundleItemId}/pickup-reminder`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "알림을 보내지 못했습니다.");
      alert(`${Number(result.count) || 0}명에게 수령 알림을 보냈습니다.`);
    } catch (error) {
      alert(error.message || "알림을 보내지 못했습니다.");
    }
  };

  window.saveArrivalSchedule = async function (productId) {
    const row = document.querySelector(`[data-arrival-product="${productId}"]`);
    if (!row) return;
    const arrivalExpectedText = row.querySelector(".arrival-text-input")?.value.trim() || "";
    const token = accessToken();
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(productId) && token) {
      try {
        const response = await fetch(`${API_BASE}/api/admin/products/${encodeURIComponent(productId)}/arrival`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ arrivalStatus: "scheduled", arrivalExpectedText })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "입고 안내를 저장하지 못했습니다.");
      } catch (error) {
        alert(error.message || "입고 안내를 저장하지 못했습니다.");
        return;
      }
    }
    window.FridgeDB.updateProduct(productId, {
      arrivalExpectedTime: "",
      arrivalExpectedText,
      updatedAt: new Date().toISOString()
    });
    renderArrivalManagement();
    refreshPreviewIframe();
  };

  async function saveProductSettings(productId, changes) {
    const token = accessToken();
    if (!token) throw new Error("관리자 로그인이 필요합니다.");
    const response = await fetch(`${API_BASE}/api/admin/products/${encodeURIComponent(productId)}/settings`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(changes)
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || "상품 설정을 저장하지 못했습니다.");
    }
    window.FridgeDB.updateProduct(productId, result.data);
    return result.data;
  }

  window.toggleOriginalPrice = async function (productId) {
    const product = window.FridgeDB.getProducts().find((item) => item.id === productId);
    if (!product) return;
    try {
      await saveProductSettings(productId, { showOriginalPrice: !product.showOriginalPrice });
      renderAdminDashboard();
      refreshPreviewIframe();
    } catch (error) {
      alert(error.message);
    }
  };

  window.toggleProductRecommended = async function (productId) {
    const product = window.FridgeDB.getProducts().find((item) => item.id === productId);
    if (!product) return;
    try {
      await saveProductSettings(productId, { isRecommended: !product.isRecommended });
      renderAdminDashboard();
      refreshPreviewIframe();
    } catch (error) {
      alert(error.message);
    }
  };

  window.toggleProductClosed = async function (productId) {
    const product = window.FridgeDB.getProducts().find((item) => item.id === productId);
    if (!product) return;
    
    const nextIsClosed = !product.isClosed;
    const currentStock = Number(product.stock || 0);
    
    let newStock = currentStock;
    if (!nextIsClosed && currentStock <= 0) {
      const defaultRestock = Number(product.totalStock) > 0 ? Number(product.totalStock) : 10;
      newStock = defaultRestock;
    }

    try {
      await saveProductSettings(productId, {
        isClosed: nextIsClosed,
        stock: newStock,
        totalStock: Math.max(Number(product.totalStock || 0), newStock)
      });
      renderAdminDashboard();
      refreshPreviewIframe();
    } catch (error) {
      alert(error.message);
    }
  };

  window.toggleProductArrival = async function (productId) {
    const today = localISO();
    const products = window.FridgeDB.getProducts();
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    const isCurrentlyArrived = product.arrivalStatus === "arrived";
    const nextStatus = isCurrentlyArrived ? "scheduled" : "arrived";
    const arrivedAt = nextStatus === "arrived" ? new Date().toISOString() : null;

    const token = accessToken();
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(productId) && token) {
      try {
        const response = await fetch(`${API_BASE}/api/admin/products/${encodeURIComponent(productId)}/arrival`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            arrivalStatus: nextStatus,
            arrivalExpectedText: product.arrivalExpectedText || ""
          })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "입고 상태를 변경하지 못했습니다.");
      } catch (error) {
        alert(error.message || "입고 상태를 변경하지 못했습니다.");
        return;
      }
    }

    window.FridgeDB.updateProduct(productId, {
      arrivalStatus: nextStatus,
      arrivedAt: arrivedAt,
      pickupDate: product.pickupDate || today
    });

    window.FridgeDB.getOrders()
      .filter((order) => order.productId === productId && order.status === "pending")
      .forEach((order) => {
        window.FridgeDB.updateOrder(order.id, {
          arrivalStatus: nextStatus,
          arrivedAt: arrivedAt
        });
      });

    renderAdminDashboard();
    refreshPreviewIframe();
  };

  function selectProductCategory(category) {
    productCategoryFilter = category;
    productCategoryButtons.forEach((button) => {
      const active = button.dataset.productCategory === category;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (bundlePickupDateField) bundlePickupDateField.hidden = category !== "bundle";
    if (category !== "bundle" && bundlePickupDateInput) bundlePickupDateInput.value = "";
    renderProductManagement();
  }

  productCategoryButtons.forEach((button) => {
    button.addEventListener("click", () => selectProductCategory(button.dataset.productCategory));
  });
  productSearchInput?.addEventListener("input", renderProductManagement);
  bundlePickupDateInput?.addEventListener("change", renderProductManagement);
  productFilterReset?.addEventListener("click", () => {
    if (productSearchInput) productSearchInput.value = "";
    if (bundlePickupDateInput) bundlePickupDateInput.value = "";
    selectProductCategory("all");
  });

  window.closeRestockDialog = function () {
    restockDialog.classList.remove("is-visible");
    restockDialog.setAttribute("aria-hidden", "true");
  };

  window.showRestockSubscribers = async function (productId) {
    const product = window.FridgeDB.getProducts().find((item) => item.id === productId);
    if (!product) return;
    const requestType = window.ProductRules.canJoinWaitlist(product) ? "waitlist" : "restock";
    restockDialogTitle.textContent = `${product.name} ${requestType === "waitlist" ? "대기" : "재입고"} 신청자`;
    restockDialogContent.innerHTML = `<p class="panel-desc">신청자 명단을 불러오고 있습니다.</p>`;
    restockDialog.classList.add("is-visible");
    restockDialog.setAttribute("aria-hidden", "false");

    const token = accessToken();
    if (!token) {
      restockDialogContent.innerHTML = `<p class="panel-desc">Supabase 관리자 로그인 후 실제 신청자 명단을 확인할 수 있어요. 현재 예시 집계는 ${product.restockRequests || 0}명입니다.</p>`;
      return;
    }
    try {
      const params = new URLSearchParams({ type: requestType, name: product.name });
      const response = await fetch(`${API_BASE}/api/admin/products/${encodeURIComponent(productId)}/restock-subscribers?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      restockDialogContent.innerHTML = result.data.length
        ? result.data.map((item, index) => `<div class="restock-person">
            <span class="restock-order">${requestType === "waitlist" ? `${index + 1}번` : ""}</span>
            <span>
              <strong>${adminEscape(item.profiles?.name || "회원")}</strong>
              <small>${requestType === "waitlist"
                ? adminEscape(`${Number(item.quantity) || 1}개 · ${item.pickup_date || "수령일 미정"} · ${item.pickup_time_label || "시간 미정"} · ${item.payment_type === "transfer" ? "계좌이체" : "현장결제"}`)
                : adminEscape(item.profiles?.phone || "연락처 미등록")}</small>
            </span>
            <time>${new Date(item.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
            ${requestType === "waitlist"
              ? `<button class="waitlist-notify-button" type="button" onclick="notifyWaitlistCustomer('${product.id}', '${item.user_id}')">알림 전송</button>`
              : ""}
          </div>`).join("")
        : `<p class="panel-desc">아직 ${requestType === "waitlist" ? "대기" : "재입고 알림"} 신청자가 없습니다.</p>`;
    } catch (error) {
      restockDialogContent.innerHTML = `<p class="panel-desc">${error.message || "명단을 불러오지 못했습니다."}</p>`;
    }
  };

  window.notifyWaitlistCustomer = async function (productId, userId) {
    if (!confirm("이 대기 고객에게 지금 신청 가능 알림을 보낼까요?")) return;
    const token = accessToken();
    if (!token) return alert("관리자 로그인이 필요합니다.");
    try {
      const response = await fetch(`${API_BASE}/api/admin/products/${encodeURIComponent(productId)}/waitlist/${encodeURIComponent(userId)}/notify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "알림을 보내지 못했습니다.");
      alert("대기 고객에게 신청 가능 알림을 보냈습니다.");
      window.showRestockSubscribers(productId);
    } catch (error) {
      alert(error.message || "알림을 보내지 못했습니다.");
    }
  };

  window.deleteAdminProduct = async function (productId) {
    const product = window.FridgeDB.getProducts().find((item) => item.id === productId);
    const productName = product?.name || "선택한 상품";
    if (!confirm(`'${productName}' 상품을 삭제할까요?\n기존 주문·후기 기록은 보존되고 고객 화면에서는 사라집니다.`)) return;

    const token = accessToken();
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(productId)) {
      if (!token) return alert("관리자 로그인이 필요합니다.");
      try {
        const response = await fetch(`${API_BASE}/api/admin/products/${encodeURIComponent(productId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "상품을 삭제하지 못했습니다.");
        if (result.warning) console.warn("상품 삭제 후 정리 안내:", result.warning);
      } catch (error) {
        alert(error.message || "상품을 삭제하지 못했습니다.");
        return;
      }
    }
    window.FridgeDB.deleteProduct(productId);
    const sync = await syncCatalogFromServer();
    if (!sync.success) console.error("삭제 후 상품 목록 갱신 실패:", sync.error);
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.openProductCreateGuide = function () {
    restockDialogTitle.textContent = "새 상품 등록";
    restockDialogContent.innerHTML = `
      <form class="admin-product-form" id="admin-product-form">
        <label>상품명<input name="name" required /></label>
        <label>유형<select name="category"><option value="bundle">보따리</option><option value="fruit">오늘의 과일</option><option value="market">매장 쇼룸</option></select></label>
        <label>한 줄 소개<input name="description" required /></label>
        <div><label>판매가<input name="price" type="number" min="0" required /></label><label>할인 전 가격<input name="originalPrice" type="number" min="0" /></label></div>
        <div><label>전체 재고<input name="totalStock" type="number" min="1" required /></label><label>현재 재고<input name="stock" type="number" min="0" required /></label></div>
        <div><label>마감일<input name="deadline" type="date" /></label><label>마감시간<input name="deadlineTime" type="time" value="23:59" /></label></div>
        <label class="admin-check-row"><input name="showOriginalPrice" type="checkbox" /> 할인 전 가격을 고객 화면에 표시</label>
        <button class="admin-primary-btn" type="submit">상품 등록</button>
      </form>`;
    restockDialog.classList.add("is-visible");
    restockDialog.setAttribute("aria-hidden", "false");
  };

  function renderStats() {
    const orders = window.FridgeDB.getOrders();
    const today = localISO();
    const activeOrders = orders.filter((order) =>
      !["cancelled", "canceled"].includes(String(order.status || "").toLowerCase())
    );
    const todayOrders = activeOrders.filter((order) => orderDateISO(order) === today);
    const todayPickups = activeOrders.filter((order) =>
      pickupDateISO(order) === today && ["pending", "applied", "ready", "completed"].includes(order.status)
    );
    const todayOrderQuantity = todayOrders.reduce((total, order) => total + (Number(order.quantity) || 1), 0);
    const todayPickupQuantity = todayPickups.reduce((total, order) => total + (Number(order.quantity) || 1), 0);
    const todayPickupCustomers = new Set(todayPickups.map((order) =>
      order.customerId || order.userId || order.customerName || order.userName || order.id
    )).size;
    const todayOnsiteCount = todayPickups.filter((order) => order.paymentType === "onsite").length;
    const todayTransferCount = todayPickups.filter((order) => order.paymentType === "transfer").length;
    const todayUnpaidCount = todayPickups.filter((order) => order.paymentType === "transfer" && !order.transferApproved).length;
    const pendingApprovalCount = activeOrders.filter(o =>
      o.paymentType === "transfer" && ["pending", "applied", "ready"].includes(o.status) && !o.transferApproved
    ).length;
    const expiredCount = orders.filter((order) => isUnprocessedMissedPickup(order, today)).length;

    if (statTodayOrders) statTodayOrders.textContent = `${todayOrderQuantity}개`;
    if (statTodayOrdersDetail) statTodayOrdersDetail.textContent = `주문 ${todayOrders.length}건 · 상품 ${todayOrderQuantity}개`;
    if (statTodayPickups) statTodayPickups.textContent = `${todayPickupCustomers}명`;
    if (statTodayPickupsDetail) statTodayPickupsDetail.textContent = `상품 ${todayPickupQuantity}개 · 현장 ${todayOnsiteCount} · 이체 ${todayTransferCount}`;
    if (statTodayUnpaid) {
      statTodayUnpaid.hidden = todayUnpaidCount === 0;
      statTodayUnpaid.textContent = `미입금 ${todayUnpaidCount}건`;
    }
    if (statPendingApproval) statPendingApproval.textContent = `${pendingApprovalCount}건`;
    if (statExpiredOrders) statExpiredOrders.textContent = `${expiredCount}건`;
  }

  function populateProductFilter() {
    if (!filterProductSelect || filterProductSelect.children.length > 1) return;
    const products = window.FridgeDB.getProducts();
    products.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      filterProductSelect.appendChild(opt);
    });
  }

  function isOrderReceived(order) {
    return Boolean(order?.receivedAt)
      || String(order?.status || "").toLowerCase() === "completed";
  }

  function applyPackingFilters(orders) {
    const filterProduct = filterProductSelect?.value || "all";
    const pickupDate = packingPickupDate?.value || "";
    const searchTerm = packingOrderSearch?.value.trim().toLocaleLowerCase("ko-KR") || "";
    const unreceivedOnly = packingUnreceivedOnly?.checked === true;
    const productsById = new Map(
      window.FridgeDB.getProducts().map((product) => [product.id, product])
    );
    return filterOrdersByScope(orders).filter((order) => {
      if (filterProduct !== "all" && order.productId !== filterProduct) return false;
      if (unreceivedOnly && isOrderReceived(order)) return false;
      const productPickupDate = String(productsById.get(order.productId)?.pickupDate || "").slice(0, 10);
      if (pickupDate && productPickupDate !== pickupDate) return false;
      if (searchTerm) {
        const searchable = [
          order.id,
          order.customerName,
          order.userName,
          order.productName
        ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
        if (!searchable.includes(searchTerm)) return false;
      }
      return true;
    });
  }

  window.renderAdminOrders = function () {
    if (!packingTable) return;

    const orders = window.FridgeDB.getOrders();
    const account = window.FridgeDB.getUserAccount();
    packingTable.innerHTML = "";
    if (packingUnreceivedOnly) {
      const hasSelectedProduct = (filterProductSelect?.value || "all") !== "all";
      packingUnreceivedOnly.disabled = !hasSelectedProduct;
      if (!hasSelectedProduct) packingUnreceivedOnly.checked = false;
    }

    const filtered = applyPackingFilters(orders);
    const scopeLabels = {
      all: "전체 주문",
      "today-orders": "오늘 접수",
      "today-pickups": "오늘 수령 예정",
      "pending-transfer": "입금 확인 대기",
      expired: "미수령 만료"
    };
    if (packingScopeLabel) packingScopeLabel.textContent = scopeLabels[packingScope] || "전체 주문";

    if (filtered.length === 0) {
      packingTable.innerHTML = `<tr><td colspan="9" style="text-align:center; color:#999;">해당 조건의 주문 내역이 없습니다.</td></tr>`;
      return;
    }

    filtered.forEach(o => {
      let payTypeKo = o.paymentType === "onsite" ? "현장결제" : "계좌이체";
      let statusBadge = "";
      
      if (o.status === "completed") {
        statusBadge = `<span class="admin-badge green">수령 완료</span>`;
      } else if (o.status === "cancelled" || o.status === "canceled") {
        statusBadge = `<span class="admin-badge gray">주문 취소</span>`;
      } else if (o.status === "expired") {
        statusBadge = `<span class="admin-badge red">미수령 만료</span>`;
      } else {
        if (o.paymentType === "transfer") {
          statusBadge = o.transferApproved 
            ? `<span class="admin-badge green">확인 완료 (타입 B)</span>` 
            : `<span class="admin-badge yellow">입금 확인 대기</span>`;
        } else {
          statusBadge = `<span class="admin-badge yellow">결제 대기</span>`;
        }
      }

      const actionButtons = [];
      if (["pending", "applied"].includes(o.status) && o.paymentType === "transfer" && !o.transferApproved) {
        actionButtons.push(`<button onclick="approveTransfer('${o.id}')" class="approve-btn">입금 승인</button>`);
        actionButtons.push(`<button onclick="sendPaymentReminder('${o.id}')" class="restore-btn">입금 알림</button>`);
      } else if (o.status === "expired") {
        actionButtons.push(`<button onclick="restoreOrder('${o.id}')" class="restore-btn">상태 원복</button>`);
      }
      const canAdminComplete = ["pending", "applied", "ready"].includes(o.status)
        && o.arrivalStatus === "arrived"
        && (o.paymentType === "onsite" || o.transferApproved);
      if (canAdminComplete) {
        actionButtons.push(`<button onclick="completeOrderByAdmin('${o.id}')" class="complete-order-btn">수령 완료</button>`);
      }
      if (["pending", "applied", "ready"].includes(o.status)) {
        actionButtons.push(`<button onclick="showOrderCancelConfirmation(this, '${o.id}')" class="cancel-order-btn">주문 취소</button>`);
      }
      const actionBtn = actionButtons.length
        ? `<div class="order-action-buttons">${actionButtons.join("")}</div>`
        : "-";
      const receivedTime = o.receivedAt
        ? `<span class="receipt-check-time"><strong>${new Date(o.receivedAt).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
          })}</strong><small>수령 완료 시각</small></span>`
        : isOrderReceived(o)
          ? `<span class="receipt-check-time"><strong>수령 완료</strong><small>완료 시각 미기록</small></span>`
        : `<span class="receipt-check-empty">미체크</span>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><code>${o.id}</code></td>
        <td><strong>${o.customerName || o.userName || account?.name || "고객"}</strong></td>
        <td><strong>${o.productName}</strong></td>
        <td><strong>${Number(o.quantity) || 1}개</strong></td>
        <td>${shortPickupText(o)}</td>
        <td>${payTypeKo}</td>
        <td>${statusBadge}</td>
        <td>${receivedTime}</td>
        <td>${actionBtn}</td>
      `;
      packingTable.appendChild(tr);
    });
  }

  window.approveTransfer = async function (orderId) {
    const token = accessToken();
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId) && token) {
      try {
        const response = await fetch(`${API_BASE}/api/admin/orders/${orderId}/confirm-payment`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "입금 확인에 실패했습니다.");
      } catch (error) {
        alert(error.message || "입금 확인에 실패했습니다.");
        return;
      }
    }
    window.FridgeDB.updateOrder(orderId, { transferApproved: true });
    alert("💸 입금이 승인되었습니다. 고객의 스마트 수령증이 '확인 완료(타입 B - 바코드 제거)' 상태로 즉시 변경됩니다.");
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.sendPaymentReminder = async function (orderId) {
    const token = accessToken();
    if (!token || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId)) {
      alert("입금 요청 알림을 보냈습니다.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/admin/orders/${orderId}/payment-reminder`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "알림을 보내지 못했습니다.");
      alert("입금 요청 알림을 보냈습니다.");
    } catch (error) {
      alert(error.message || "알림을 보내지 못했습니다.");
    }
  };

  window.completeOrderByAdmin = async function (orderId) {
    const order = window.FridgeDB.getOrders().find((item) => String(item.id) === String(orderId));
    if (!order) return alert("주문을 찾지 못했습니다.");
    const customerName = order.customerName || order.userName || "고객";
    if (!confirm(`${customerName} 고객의 주문을 수령 완료 처리할까요?\n처리 시각과 관리자 작업 이력이 기록됩니다.`)) return;

    const token = accessToken();
    if (!token) return alert("관리자 로그인이 필요합니다.");
    try {
      const response = await fetch(`${API_BASE}/api/admin/orders/${encodeURIComponent(orderId)}/complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "수령 완료 처리에 실패했습니다.");
      }
      window.FridgeDB.updateOrder(orderId, {
        status: "completed",
        receivedAt: result.data.received_at,
        barcodeLocked: true
      });
      renderAdminDashboard();
      alert("수령 완료 처리했습니다.");
    } catch (error) {
      alert(error.message || "수령 완료 처리에 실패했습니다.");
    }
  };

  window.cancelOrderByAdmin = async function (orderId) {
    const order = window.FridgeDB.getOrders().find((item) => item.id === orderId);
    if (!order || !["pending", "applied", "ready"].includes(order.status)) {
      alert("현재 취소할 수 없는 주문입니다.");
      return;
    }
    const reason = prompt("주문 취소 사유를 입력해 주세요. 고객 주문내역에도 표시됩니다.", "");
    if (reason === null) return;
    if (!reason.trim()) {
      alert("취소 사유를 입력해 주세요.");
      return;
    }
    const token = accessToken();
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId) && token) {
      try {
        const response = await fetch(`${API_BASE}/api/admin/orders/${encodeURIComponent(orderId)}/cancel`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ reason: reason.trim() })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "주문을 취소하지 못했습니다.");
      } catch (error) {
        alert(error.message || "주문을 취소하지 못했습니다.");
        return;
      }
    }
    window.FridgeDB.updateOrder(orderId, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelReason: reason.trim(),
      cancelledBy: "admin"
    });
    const product = window.FridgeDB.getProducts().find((item) => item.id === order.productId);
    if (product) {
      const restoredStock = Number(product.stock || 0) + (Number(order.quantity) || 1);
      const totalStock = Number(product.totalStock || 0);
      window.FridgeDB.updateProduct(product.id, {
        stock: totalStock > 0 ? Math.min(restoredStock, totalStock) : restoredStock,
        isClosed: restoredStock <= 0
      });
    }
    alert("주문을 취소했습니다.");
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.showOrderCancelConfirmation = function (button, orderId) {
    const container = button?.closest(".order-action-buttons");
    if (!container) return;
    container.dataset.originalActions = container.innerHTML;
    container.innerHTML = `
      <span class="cancel-confirm-label">정말 취소할까요?</span>
      <button type="button" class="cancel-confirm-btn" onclick="cancelOrderByAdmin('${orderId}')">취소 확인</button>
      <button type="button" class="cancel-back-btn" onclick="renderAdminOrders()">돌아가기</button>
    `;
  };

  packingOrderSearch?.addEventListener("input", renderAdminOrders);
  packingPickupDate?.addEventListener("change", renderAdminOrders);
  packingUnreceivedOnly?.addEventListener("change", renderAdminOrders);
  packingFilterReset?.addEventListener("click", () => {
    if (packingOrderSearch) packingOrderSearch.value = "";
    if (packingPickupDate) packingPickupDate.value = "";
    if (packingUnreceivedOnly) packingUnreceivedOnly.checked = false;
    if (filterProductSelect) filterProductSelect.value = "all";
    packingScope = "all";
    renderAdminOrders();
  });

  function syncExpiredRangeButtons() {
    expiredRangeButtons.forEach((button) => {
      const active = button.dataset.expiredRange === expiredRange;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function expiredRangeBounds() {
    if (expiredDateFrom?.value || expiredDateTo?.value) {
      return { from: expiredDateFrom?.value || "", to: expiredDateTo?.value || "" };
    }
    if (expiredRange === "all") return { from: "", to: "" };
    const days = expiredRange === "today" ? 1 : Number(expiredRange);
    const to = localISO();
    const fromDate = new Date(`${to}T00:00:00`);
    fromDate.setDate(fromDate.getDate() - Math.max(0, days - 1));
    return { from: localISO(fromDate), to };
  }

  function renderExpiredHistory() {
    if (!expiredHistoryTable) return;
    const account = window.FridgeDB.getUserAccount();
    const history = window.FridgeDB.getOrders()
      .filter((order) => order.status === "expired" || order.expiredAt || order.restoredAt);
    if (expiredHistoryTotal) expiredHistoryTotal.textContent = history.length;
    const { from, to } = expiredRangeBounds();
    const term = expiredHistorySearch?.value.trim().toLocaleLowerCase("ko-KR") || "";
    const status = expiredHistoryStatus?.value || "all";
    const filtered = history.filter((order) => {
      const date = expirationDateISO(order);
      if (from && date < from) return false;
      if (to && date > to) return false;
      const restored = Boolean(order.restoredAt);
      if (status === "active" && restored) return false;
      if (status === "restored" && !restored) return false;
      const customer = order.customerName || order.userName || account?.name || "고객";
      if (term && !`${customer} ${order.productName || ""}`.toLocaleLowerCase("ko-KR").includes(term)) return false;
      return true;
    }).sort((a, b) => expirationDateISO(b).localeCompare(expirationDateISO(a)));

    if (!filtered.length) {
      expiredHistoryTable.innerHTML = `<tr><td colspan="7" class="admin-empty-row"><strong>조건에 맞는 만료 내역이 없습니다.</strong><span>기간이나 처리 상태를 변경해 주세요.</span></td></tr>`;
      return;
    }
    let lastDate = "";
    expiredHistoryTable.innerHTML = filtered.map((order) => {
      const date = expirationDateISO(order);
      const dateRow = date !== lastDate ? `<tr class="expired-date-row"><td colspan="7">${date}</td></tr>` : "";
      lastDate = date;
      const restored = Boolean(order.restoredAt);
      return `${dateRow}<tr>
        <td>${expirationTimeText(order)}</td>
        <td><strong>${order.customerName || order.userName || account?.name || "고객"}</strong></td>
        <td>${order.productName || "-"}</td>
        <td>${order.pickupDate || order.pickupDateISO || "-"}</td>
        <td>${order.paymentType === "onsite" ? "현장결제" : "계좌이체"}</td>
        <td><span class="admin-badge ${restored ? "green" : "red"}">${restored ? "원복 완료" : "미처리"}</span></td>
        <td>${!restored && order.status === "expired" ? `<button onclick="restoreOrder('${order.id}')" class="restore-btn">상태 원복</button>` : "—"}</td>
      </tr>`;
    }).join("");
  }

  expiredRangeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      expiredRange = button.dataset.expiredRange;
      if (expiredDateFrom) expiredDateFrom.value = "";
      if (expiredDateTo) expiredDateTo.value = "";
      syncExpiredRangeButtons();
      renderExpiredHistory();
    });
  });
  [expiredDateFrom, expiredDateTo].forEach((input) => input?.addEventListener("change", () => {
    expiredRange = "custom";
    syncExpiredRangeButtons();
    renderExpiredHistory();
  }));
  expiredHistorySearch?.addEventListener("input", renderExpiredHistory);
  expiredHistoryStatus?.addEventListener("change", renderExpiredHistory);

  function renderUnclaimedOrders() {
    if (!unclaimedTable) return;

    const orders = window.FridgeDB.getOrders();
    const account = window.FridgeDB.getUserAccount();
    unclaimedTable.innerHTML = "";

    const activeOrders = orders
      .filter((order) => isUnprocessedMissedPickup(order))
      .sort((a, b) => pickupDateISO(a).localeCompare(pickupDateISO(b)));

    if (activeOrders.length === 0) {
      unclaimedTable.innerHTML = `<tr><td colspan="6" class="admin-empty-row"><strong>확인할 미수령 주문이 없습니다.</strong><span>수령일이 오늘 이후인 주문은 여기에 표시되지 않습니다.</span></td></tr>`;
      return;
    }

    activeOrders.forEach(o => {
      let payTypeKo = o.paymentType === "onsite" ? "현장결제" : "계좌이체";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><code>${o.id}</code></td>
        <td><strong>${o.customerName || o.userName || account?.name || "고객"}</strong></td>
        <td><strong>${o.productName}</strong></td>
        <td>${o.pickupDate}</td>
        <td>${payTypeKo}</td>
        <td>
          <button onclick="expireOrder('${o.id}')" class="expire-btn">만료 회수 처리</button>
        </td>
      `;
      unclaimedTable.appendChild(tr);
    });
  }

  window.expireOrder = async function (orderId) {
    const orders = window.FridgeDB.getOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    try {
      const response = await fetch(`${API_BASE}/api/admin/orders/${encodeURIComponent(orderId)}/no-show`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "미수령 만료 처리에 실패했습니다.");
    } catch (error) {
      alert(error.message);
      return;
    }

    const updates = { status: "expired", expiredAt: new Date().toISOString(), restoredAt: null, barcodeLocked: true };
    
    const noShowIncremented = true;
    updates.userNoShowStacked = true;

    window.FridgeDB.updateOrder(orderId, updates);
    alert(`🚨 미수령 만료 처리가 완료되었습니다.\n\n- 바코드 강제 잠금\n- 빨간색 만료 스탬프 오버레이\n${noShowIncremented ? '- 고객 노쇼 1스택 누적 (현장결제 자동 제한 여부 갱신)' : ''}`);
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.restoreOrder = async function (orderId) {
    const orders = window.FridgeDB.getOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    try {
      const response = await fetch(`${API_BASE}/api/admin/orders/${encodeURIComponent(orderId)}/no-show`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken()}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "주문 상태 원복에 실패했습니다.");
    } catch (error) {
      alert(error.message);
      return;
    }

    const updates = { status: "pending", restoredAt: new Date().toISOString(), barcodeLocked: false };

    updates.userNoShowStacked = false;

    window.FridgeDB.updateOrder(orderId, updates);
    alert("✅ 주문 상태가 정상 대기 상태로 원복되었습니다. 고객의 바코드가 즉시 복구됩니다.");
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  function renderUserNoShowPanel() {
    if (!noshowCountDisplay) return;
    const member = selectedNoShowMember;
    let clearButton = document.getElementById("clear-noshow-member-button");
    if (!clearButton && memberNoShowPanel) {
      clearButton = document.createElement("button");
      clearButton.id = "clear-noshow-member-button";
      clearButton.className = "clear-noshow-member-button";
      clearButton.type = "button";
      clearButton.textContent = "관리 대상에서 제외";
      clearButton.addEventListener("click", () => window.clearMemberNoShow());
      memberNoShowPanel.appendChild(clearButton);
    }
    noshowCountDisplay.textContent = `${Number(member?.no_show_count) || 0}회`;
    if (noshowUsername) {
      noshowUsername.textContent = member ? `고객: ${member.name || "고객"}` : "선택된 회원이 없습니다";
    }
    if (noshowUserCode) {
      noshowUserCode.textContent = member ? String(member.id).slice(0, 8).toUpperCase() : "-";
    }
    if (memberNoShowPanel) {
      memberNoShowPanel.classList.toggle("is-empty", !member);
    }
    if (clearButton) clearButton.hidden = !member;
  }

  window.clearMemberNoShow = function () {
    if (!selectedNoShowMember) return;
    selectedNoShowMember = null;
    renderUserNoShowPanel();
  };

  async function updateSelectedMemberNoShow(action, reason = "") {
    if (!selectedNoShowMember) {
      alert("회원 관리에서 고객을 먼저 선택해 주세요.");
      window.switchAdminTab("members");
      return;
    }
    const token = accessToken();
    const response = await fetch(`${API_BASE}/api/admin/members/${encodeURIComponent(selectedNoShowMember.id)}/no-show`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, reason })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "노쇼 스택을 변경하지 못했습니다.");
    selectedNoShowMember.no_show_count = Number(result.data.no_show_count) || 0;
    const cached = memberCache.get(selectedNoShowMember.id);
    if (cached) cached.no_show_count = selectedNoShowMember.no_show_count;
    renderUserNoShowPanel();
    return selectedNoShowMember.no_show_count;
  }

  window.adjustNoShow = async function (amount) {
    if (!selectedNoShowMember) {
      alert("회원 관리에서 고객을 먼저 선택해 주세요.");
      window.switchAdminTab("members");
      return;
    }
    const action = amount > 0 ? "increment" : "decrement";
    let reason = "";
    if (action === "increment") {
      reason = prompt("노쇼 스택을 추가하는 사유를 입력해 주세요.", "수령 완료 허위 체크 확인") || "";
      if (!reason.trim()) return;
    } else if (!confirm(`${selectedNoShowMember.name || "선택 회원"}의 노쇼 스택을 1회 차감할까요?`)) {
      return;
    }
    try {
      const nextStack = await updateSelectedMemberNoShow(action, reason);
      alert(`노쇼 스택을 변경했습니다. 현재 ${nextStack}회입니다.`);
    } catch (error) {
      alert(error.message);
    }
  };

  window.resetNoShow = async function () {
    if (!selectedNoShowMember) {
      alert("회원 관리에서 고객을 먼저 선택해 주세요.");
      window.switchAdminTab("members");
      return;
    }
    if (!confirm(`${selectedNoShowMember.name || "선택 회원"}의 노쇼 스택을 0회로 초기화할까요?`)) return;
    try {
      await updateSelectedMemberNoShow("reset", "관리자 수동 초기화");
      alert("노쇼 스택을 0회로 초기화했습니다.");
    } catch (error) {
      alert(error.message);
    }
  };

  function renderReviewsPanel() {
    if (!adminReviewsContainer) return;

    const reviews = window.FridgeDB.getReviews();
    adminReviewsContainer.innerHTML = "";

    reviews.forEach(r => {
      const card = document.createElement("div");
      card.className = "feedback-card";
      
      const blindBtnLabel = r.isVisible ? "블라인드 처리" : "블라인드 해제";
      const blindBtnColor = r.isVisible ? "#ef4b43" : "#1f5f43";
      
      let replySectionHTML = "";
      if (r.reply) {
        replySectionHTML = `
          <div style="background:#eef6f2; padding:10px; border-radius:8px; font-size:11px; margin-bottom:10px; border-left:3px solid #1f5f43;">
            <strong>🏪 답글 등록됨:</strong> ${r.reply}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="feedback-card-head">
          <span>${r.userName} | ${r.productName} (${r.date})</span>
          <span style="font-weight:bold; color:${r.isVisible ? '#1f5f43' : '#b94242'};">
            ${r.isVisible ? '● 노출 중' : '● 블라인드 됨'}
          </span>
        </div>
        <div class="feedback-card-body">"${r.comment}"</div>
        ${replySectionHTML}
        <div style="display:flex; gap:10px; margin-top:8px;">
          <input type="text" id="reply-input-${r.id}" placeholder="피드백 답글을 입력해 주세요" style="flex:1; padding:6px 10px; border:1px solid #ddd; border-radius:6px; font-size:11px; outline:none;">
          <button onclick="submitReviewReply('${r.id}')" style="background:#1f5f43; color:#fff; padding:6px 12px; border:0; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer;">답글 등록</button>
          <button onclick="toggleReviewBlind('${r.id}')" style="background:${blindBtnColor}; color:#fff; padding:6px 12px; border:0; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer;">${blindBtnLabel}</button>
        </div>
      `;
      adminReviewsContainer.appendChild(card);
    });
  }

  window.toggleReviewBlind = async function (reviewId) {
    const reviews = window.FridgeDB.getReviews();
    const review = reviews.find(r => r.id === reviewId);
    if (!review) return;

    const nextVisible = !review.isVisible;
    try {
      const response = await fetch(`${API_BASE}/api/admin/reviews/${encodeURIComponent(reviewId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ is_visible: nextVisible })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "후기 상태를 변경하지 못했습니다.");
    } catch (error) {
      alert(error.message);
      return;
    }
    window.FridgeDB.updateReview(reviewId, { isVisible: nextVisible });
    alert(`리뷰 상태가 변경되었습니다: ${!review.isVisible ? '블라인드 완료(홈 화면에서 차단)' : '노출 해제 완료'}`);
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.submitReviewReply = async function (reviewId) {
    const input = document.getElementById(`reply-input-${reviewId}`);
    const text = input.value.trim();
    if (!text) {
      alert("답변 내용을 입력해 주세요.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/admin/reviews/${encodeURIComponent(reviewId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ admin_reply: text })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "후기 답변을 저장하지 못했습니다.");
    } catch (error) {
      alert(error.message);
      return;
    }
    window.FridgeDB.updateReview(reviewId, { reply: text });
    input.value = "";
    alert("🏪 후기 답글이 등록되었습니다. 상세페이지 및 홈 화면 리뷰 아래에 하위 리플라이 UI로 매칭 노출됩니다.");
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  async function renderInquiriesPanel() {
    if (!adminInquiriesContainer) return;
    adminInquiriesContainer.innerHTML = `<div class="admin-empty-row">문의 내역을 불러오고 있습니다.</div>`;
    const token = accessToken();
    try {
      const response = await fetch(`${API_BASE}/api/admin/inquiries`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "문의 내역을 불러오지 못했습니다.");
      const inquiries = result.data || [];
      if (!inquiries.length) {
        adminInquiriesContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#999; font-size:12px;">등록된 고객 1:1 문의사항이 없습니다.</div>`;
        return;
      }
      adminInquiriesContainer.innerHTML = inquiries.map((inquiry) => `
        <div class="feedback-card">
          <div class="feedback-card-head">
            <span>상품: ${adminEscape(inquiry.products?.name || "상품 문의")} · ${new Date(inquiry.created_at).toLocaleDateString("ko-KR")}</span>
            <span style="font-weight:bold;color:${inquiry.answer ? '#1f5f43' : '#b94242'};">${inquiry.answer ? "답변완료" : "대기중"}</span>
          </div>
          <div class="feedback-card-body" style="font-size:12px;color:#555;">Q. ${adminEscape(inquiry.content)}</div>
          ${inquiry.answer ? `<div style="background:#eef6f2;padding:8px;border-radius:6px;margin-bottom:8px;font-size:11px;border-left:3px solid #1f5f43;"><strong>내 답변:</strong> ${adminEscape(inquiry.answer)}</div>` : ""}
          <div style="display:flex;gap:10px;margin-top:8px;">
            <input type="text" id="answer-input-${inquiry.id}" placeholder="답변 내용을 작성해 주세요" style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:11px;outline:none;">
            <button onclick="submitInquiryAnswer('${inquiry.id}')" style="background:#1f5f43;color:#fff;padding:6px 12px;border:0;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;">답변 등록</button>
          </div>
        </div>`).join("");
    } catch (error) {
      adminInquiriesContainer.innerHTML = `<div class="admin-empty-row">${adminEscape(error.message || "문의 내역을 불러오지 못했습니다.")}</div>`;
    }
  }

  window.submitInquiryAnswer = async function (inquiryId) {
    const input = document.getElementById(`answer-input-${inquiryId}`);
    const text = input.value.trim();
    if (!text) {
      alert("답변 내용을 입력해 주세요.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/admin/inquiries/${encodeURIComponent(inquiryId)}/answer`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ answer: text })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "답변을 등록하지 못했습니다.");
      input.value = "";
      alert("문의 답변을 등록하고 고객에게 알림을 보냈습니다.");
      renderInquiriesPanel();
      refreshPreviewIframe();
    } catch (error) {
      alert(error.message || "답변을 등록하지 못했습니다.");
    }
  };

  window.simulatePrint = async function () {
    const latestOrderSync = await syncAdminOrdersToLocal();
    if (!latestOrderSync.success) {
      alert("최신 수령 상태를 불러오지 못해 인쇄를 중단했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const orders = window.FridgeDB.getOrders();
    const filterProduct = filterProductSelect?.value || "all";
    const filtered = applyPackingFilters(orders);

    if (!filtered.length) {
      alert("인쇄할 주문이 없습니다.");
      return;
    }

    const products = window.FridgeDB.getProducts();
    const account = window.FridgeDB.getUserAccount();
    const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
    const pickupText = (order) => {
      return shortPickupText(order);
    };
    const grouped = filtered.reduce((result, order) => {
      const key = order.productId || "unknown";
      if (!result[key]) result[key] = [];
      result[key].push(order);
      return result;
    }, {});
    const selectedProduct = products.find((product) => product.id === filterProduct);
    const nameOf = (order) => order.customerName || order.userName || account?.name || "고객";
    const sections = Object.entries(grouped).map(([productId, productOrders]) => {
      const product = products.find((item) => item.id === productId);
      const mergedByCustomer = [...productOrders].reduce((map, order) => {
        const customerKey = order.userId || nameOf(order).trim().toLocaleLowerCase("ko-KR");
        const pickup = pickupText(order);
        const payment = order.paymentType === "onsite" ? "현장" : "이체";
        if (!map.has(customerKey)) {
          const receivedQuantity = isOrderReceived(order) ? (Number(order.quantity) || 1) : 0;
          map.set(customerKey, {
            ...order,
            quantity: Number(order.quantity) || 1,
            printPickups: [pickup],
            printPayments: [payment],
            printReceivedQuantity: receivedQuantity
          });
          return map;
        }
        const merged = map.get(customerKey);
        merged.quantity += Number(order.quantity) || 1;
        if (isOrderReceived(order)) {
          merged.printReceivedQuantity += Number(order.quantity) || 1;
        }
        if (!merged.printPickups.includes(pickup)) merged.printPickups.push(pickup);
        if (!merged.printPayments.includes(payment)) merged.printPayments.push(payment);
        return map;
      }, new Map());
      const sortedOrders = [...mergedByCustomer.values()].sort((left, right) =>
        nameOf(left).localeCompare(nameOf(right), "ko-KR", { sensitivity: "base" })
      );
      const columnSize = Math.ceil(sortedOrders.length / 3);
      const columns = Array.from({ length: 3 }, (_, index) =>
        sortedOrders.slice(index * columnSize, (index + 1) * columnSize)
      ).filter((column) => column.length);
      const tables = columns.map((column) => {
        const rows = column.map((order) => {
          const totalQuantity = Number(order.quantity) || 1;
          const receivedQuantity = Number(order.printReceivedQuantity) || 0;
          const receiptMark = receivedQuantity >= totalQuantity
            ? `<span class="print-received-mark" aria-label="수령 완료">✓</span>`
            : receivedQuantity > 0
              ? `<span class="print-partial-mark">일부</span>`
              : "";
          return `
        <tr>
          <td>${escapeHTML(nameOf(order))}</td>
          <td class="quantity">${Number(order.quantity) || 1}개</td>
          <td>${escapeHTML([...(order.printPickups || [pickupText(order)])].sort((left, right) =>
            left.localeCompare(right, "ko-KR", { numeric: true })
          )[0])}</td>
          <td>${escapeHTML((order.printPayments || [order.paymentType === "onsite" ? "현장" : "이체"]).join("·"))}</td>
          <td class="check-cell">${receiptMark}</td>
        </tr>`;
        }).join("");
        return `<table>
          <thead><tr><th>고객명</th><th>수량</th><th>수령 예약일시</th><th>결제</th><th>확인</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      }).join("");
      return `
        <section>
          <h2>${escapeHTML(product?.name || productOrders[0]?.productName || "상품")} <small>${sortedOrders.length}명</small></h2>
          <div class="print-columns">${tables}</div>
        </section>`;
    }).join("");

    const printWindow = window.open("", "_blank", "width=1000,height=760");
    if (!printWindow) {
      alert("인쇄 창이 차단되었습니다. 브라우저의 팝업 허용 후 다시 눌러주세요.");
      return;
    }
    printWindow.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
      <title>패킹 주문 리스트</title>
      <style>
        @page{size:A4 portrait;margin:11mm}
        *{box-sizing:border-box}body{margin:0;color:#171c19;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
        header{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:6px;border-bottom:1.5px solid #1d2e26}
        h1{margin:0;font-size:16px}header p{margin:0;color:#66716c;font-size:8px}
        section{margin-top:9px;break-inside:auto}h2{margin:0 0 4px;font-size:10px}h2 small{color:#77817c;font-size:8px}
        .print-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4mm;align-items:start}
        table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:6.6px;break-inside:auto}
        thead{display:table-header-group}tr{break-inside:avoid}
        th{padding:2.5px 2px;border:1px solid #cfd6d2;background:#f3f6f4;text-align:left;white-space:nowrap}
        td{height:21px;padding:2px;border:1px solid #d9dfdc;vertical-align:middle;line-height:1.1}
        th:nth-child(1){width:31%}th:nth-child(2){width:9%}th:nth-child(3){width:38%}th:nth-child(4){width:15%}th:nth-child(5){width:7%}
        td:nth-child(1),td:nth-child(3),td:nth-child(4){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .quantity{text-align:center;font-weight:700}.check-cell{padding:0;text-align:center}
        .print-received-mark{font-size:10px;font-weight:900;color:#1f5f43}
        .print-partial-mark{font-size:5.8px;font-weight:800;color:#68736d}
        footer{margin-top:6px;color:#77817c;font-size:7px;text-align:right}
      </style></head><body>
      <header><div><h1>패킹 주문 리스트</h1><p>${escapeHTML(selectedProduct?.name || "전체 상품")}</p></div><p>${new Date().toLocaleString("ko-KR")} · 총 ${filtered.length}건</p></header>
      ${sections}<footer>오늘의 냉장고 관리자 센터</footer>
      <script>window.addEventListener("load",()=>{window.print();});<\/script>
      </body></html>`);
    printWindow.document.close();
  };

  window.refreshPreviewIframe = function () {
    const iframe = document.getElementById("preview-iframe");
    if (iframe) {
      iframe.src = iframe.src;
    }
  };

  verifyAdmin().then(async (allowed) => {
    if (!allowed) return;
    const catalogSync = await syncServerCatalogToLocal();
    const orderSync = await syncAdminOrdersToLocal();
    populateProductFilter();
    loadFruitHeroAdmin();
    loadFruitTypesAdmin();
    renderRecommendedSearchAdmin();
    renderAdminDashboard();
    if (!catalogSync?.success && adminProductsTable) {
      adminProductsTable.innerHTML = `
        <tr><td class="admin-empty-row" colspan="9">
          <strong>상품을 불러오지 못했습니다.</strong>
          <span>${adminEscape(catalogSync?.error || "서버 연결을 확인한 뒤 다시 시도해 주세요.")}</span>
        </td></tr>`;
    }
    if (!orderSync?.success) {
      console.error("관리자 주문 불러오기 실패:", orderSync?.error || "알 수 없는 오류");
    }

    window.addEventListener("storage", () => {
      renderAdminDashboard();
    });
    window.addEventListener("pageshow", async () => {
      await syncServerCatalogToLocal();
      await syncAdminOrdersToLocal();
      renderAdminDashboard();
    });
    window.addEventListener("focus", async () => {
      await syncServerCatalogToLocal();
      await syncAdminOrdersToLocal();
      renderAdminDashboard();
    });
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "admin-product-form") return;
    event.preventDefault();
    const form = new FormData(event.target);
    const category = form.get("category");
    const stock = Number(form.get("stock")) || 0;

    window.FridgeDB.addProduct({
      id: `product-${Date.now()}`,
      name: String(form.get("name") || "").trim(),
      category,
      categoryLabel: category === "bundle" ? "공구" : category === "fruit" ? "오늘의 과일" : "매장픽",
      purchaseMode: category === "bundle" ? "reservation" : "store",
      description: String(form.get("description") || "").trim(),
      price: Number(form.get("price")) || 0,
      originalPrice: Number(form.get("originalPrice")) || 0,
      showOriginalPrice: form.get("showOriginalPrice") === "on",
      stock: stock,
      totalStock: Math.max(Number(form.get("totalStock")) || 0, stock),
      deadline: form.get("deadline") || (category === "bundle" ? "" : "상시 판매"),
      deadlineTime: form.get("deadlineTime") || "23:59",
      image: "./asset-store-market.png",
      images: ["./asset-store-market.png"],
      salesCount: 0,
      rating: 0,
      reviewsCount: 0,
      isClosed: stock <= 0,
      restockRequests: 0,
      waitlistRequests: 0,
      tags: []
    });
    closeRestockDialog();
    renderProductManagement();
    refreshPreviewIframe();
  });
})();
