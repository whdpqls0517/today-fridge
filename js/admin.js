// Admin Control Panel Logic
(function () {
  const API_BASE = "http://localhost:3000";
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
  let productCategoryFilter = "all";

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
      <a class="admin-auth-link" href="${loginRequired ? "./login.html?next=admin" : "./main.html"}">
        ${loginRequired ? "관리자 계정으로 로그인" : "고객 화면으로 돌아가기"}
      </a>`;
    window.setTimeout(() => {
      window.location.replace(loginRequired ? "./login.html?next=admin" : "./main.html");
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
  // 1. DOM Elements
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
  const packingFilterReset = document.getElementById("packing-filter-reset");

  const purchaseTable = document.getElementById("purchase-guideline-table");
  const storeInventoryTable = document.getElementById("store-inventory-guideline-table");
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
  const adminReviewsContainer = document.getElementById("admin-reviews-container");
  const adminInquiriesContainer = document.getElementById("admin-inquiries-container");
  const filterProductSelect = document.getElementById("filter-order-product");

  let currentAdminTab = "products";
  let packingScope = "all";
  let expiredRange = "today";

  function localISO(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function orderDateISO(order) {
    return String(order.createdAt || order.orderedAt || order.bundleDate || "").slice(0, 10);
  }

  function pickupDateISO(order) {
    return String(order.pickupDateISO || order.pickupDate || "").slice(0, 10);
  }

  function expirationDateISO(order) {
    return String(order.expiredAt || order.pickupDateISO || order.pickupDate || "").slice(0, 10);
  }

  function filterOrdersByScope(orders) {
    const today = localISO();
    if (packingScope === "today-orders") return orders.filter((order) => orderDateISO(order) === today);
    if (packingScope === "today-pickups") return orders.filter((order) => pickupDateISO(order) === today && order.status === "pending");
    if (packingScope === "pending-transfer") return orders.filter((order) => order.paymentType === "transfer" && order.status === "pending" && !order.transferApproved);
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
  };

  // 2. Tab switching
  window.switchAdminTab = function (tab) {
    currentAdminTab = tab;
    document.querySelectorAll(".admin-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("onclick").includes(tab));
    });
    
    document.getElementById("tab-guideline").style.display = "none";
    document.getElementById("tab-packing").style.display = "none";
    document.getElementById("tab-products").style.display = "none";
    document.getElementById("tab-arrivals").style.display = "none";
    document.getElementById("tab-noshow").style.display = "none";
    document.getElementById("tab-reviews").style.display = "none";

    document.getElementById(`tab-${tab}`).style.display = "block";
    renderAdminDashboard();
  };

  // 3. Main render function
  function renderAdminDashboard() {
    renderStats();
    
    if (currentAdminTab === "products") {
      renderProductManagement();
    } else if (currentAdminTab === "arrivals") {
      renderArrivalManagement();
    } else if (currentAdminTab === "guideline") {
      renderGuidelineTable();
      renderStoreInventoryGuideline();
    } else if (currentAdminTab === "packing") {
      renderAdminOrders();
    } else if (currentAdminTab === "noshow") {
      renderExpiredHistory();
      renderUnclaimedOrders();
      renderUserNoShowPanel();
    } else if (currentAdminTab === "reviews") {
      renderReviewsPanel();
      renderInquiriesPanel();
    }
  }

  function badgeSummary(product) {
    const badges = window.ProductRules.badges(product);
    if (!badges.length) return `<span class="admin-badge green">정상 판매</span>`;
    return badges.map((badge) => {
      const tone = badge.tone === "popular" ? "green" : badge.tone === "deadline" ? "yellow" : "red";
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
        <td><div style="display:flex; flex-direction:column; gap:6px;"><span>잔여 ${product.stock} / 전체 ${product.totalStock || product.stock}개</span><span>${badgeSummary(product)}</span></div></td>
        <td><button class="admin-link-button" type="button" onclick="showRestockSubscribers('${product.id}')">${window.ProductRules.canJoinWaitlist(product) ? `대기 ${product.waitlistRequests || 0}명` : `재입고 ${product.restockRequests || 0}명`} · 명단 보기</button></td>
        <td>
          <button class="admin-switch ${!product.isClosed ? "is-on" : ""}" type="button"
            onclick="toggleProductClosed('${product.id}')" aria-label="판매 상태 전환"></button>
        </td>
        <td><a class="admin-edit-link" href="./admin-product-form.html?id=${encodeURIComponent(product.id)}">수정</a></td>
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
    const products = window.FridgeDB.getProducts().filter((product) =>
      product.category === "bundle"
      && product.isActive !== false
      && String(product.pickupDate || "").slice(0, 10) === today
    );

    if (!products.length) {
      arrivalManagementTable.innerHTML = `
        <tr><td class="admin-empty-row" colspan="4">
          <strong>오늘 수령 예정인 보따리가 없습니다.</strong>
          <span>상품의 수령일이 오늘인 경우 이곳에 자동으로 표시됩니다.</span>
        </td></tr>`;
      return;
    }

    arrivalManagementTable.innerHTML = products.map((product) => {
      const arrived = product.arrivalStatus === "arrived";
      return `
        <tr data-arrival-product="${adminEscape(product.id)}">
          <td>
            <div class="admin-product-cell">
              <img src="${adminEscape(product.image)}" alt="" />
              <span><strong>${adminEscape(product.name)}</strong><small>오늘 수령</small></span>
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

  window.saveArrivalSchedule = function (productId) {
    const row = document.querySelector(`[data-arrival-product="${productId}"]`);
    if (!row) return;
    const arrivalExpectedText = row.querySelector(".arrival-text-input")?.value.trim() || "";
    window.FridgeDB.updateProduct(productId, {
      arrivalExpectedTime: "",
      arrivalExpectedText,
      updatedAt: new Date().toISOString()
    });
    renderArrivalManagement();
    refreshPreviewIframe();
  };

  window.toggleOriginalPrice = function (productId) {
    const product = window.FridgeDB.getProducts().find((item) => item.id === productId);
    if (!product) return;
    window.FridgeDB.updateProduct(productId, { showOriginalPrice: !product.showOriginalPrice });
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.toggleProductRecommended = function (productId) {
    const product = window.FridgeDB.getProducts().find((item) => item.id === productId);
    if (!product) return;
    window.FridgeDB.updateProduct(productId, {
      isRecommended: !product.isRecommended,
      updatedAt: new Date().toISOString()
    });
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.toggleProductClosed = function (productId) {
    const product = window.FridgeDB.getProducts().find((item) => item.id === productId);
    if (!product) return;
    window.FridgeDB.updateProduct(productId, { isClosed: !product.isClosed });
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.toggleProductArrival = function (productId) {
    const product = window.FridgeDB.getProducts().find((item) => item.id === productId);
    if (!product || product.category !== "bundle") return;
    const arrived = product.arrivalStatus !== "arrived";
    const arrivedAt = arrived ? new Date().toISOString() : null;
    window.FridgeDB.updateProduct(productId, {
      arrivalStatus: arrived ? "arrived" : "scheduled",
      arrivedAt
    });
    window.FridgeDB.getOrders()
      .filter((order) => order.productId === productId && order.status === "pending")
      .forEach((order) => {
        window.FridgeDB.updateOrder(order.id, {
          arrivalStatus: arrived ? "arrived" : "scheduled",
          arrivedAt
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
        ? result.data.map((item) => `<div class="restock-person"><span><strong>${item.profiles?.name || "회원"}</strong><small>${item.profiles?.phone || "연락처 미등록"}</small></span><time>${new Date(item.created_at).toLocaleDateString("ko-KR")}</time></div>`).join("")
        : `<p class="panel-desc">아직 재입고 알림 신청자가 없습니다.</p>`;
    } catch (error) {
      restockDialogContent.innerHTML = `<p class="panel-desc">${error.message || "명단을 불러오지 못했습니다."}</p>`;
    }
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

  // Statistics cards
  function renderStats() {
    const orders = window.FridgeDB.getOrders();
    const today = localISO();
    const todayOrders = orders.filter((order) => orderDateISO(order) === today);
    const todayPickups = orders.filter((order) => pickupDateISO(order) === today && order.status === "pending");
    const todayOrderQuantity = todayOrders.reduce((total, order) => total + (Number(order.quantity) || 1), 0);
    const todayPickupQuantity = todayPickups.reduce((total, order) => total + (Number(order.quantity) || 1), 0);
    const todayPickupCustomers = new Set(todayPickups.map((order) =>
      order.customerId || order.userId || order.customerName || order.userName || order.id
    )).size;
    const todayOnsiteCount = todayPickups.filter((order) => order.paymentType === "onsite").length;
    const todayTransferCount = todayPickups.filter((order) => order.paymentType === "transfer").length;
    const todayUnpaidCount = todayPickups.filter((order) => order.paymentType === "transfer" && !order.transferApproved).length;
    // 계좌이체 중 승인대기 건 (transferApproved가 명시적으로 false이거나 없는 건)
    const pendingApprovalCount = orders.filter(o => o.paymentType === "transfer" && o.status === "pending" && !o.transferApproved).length;
    const expiredCount = orders.filter((order) =>
      (order.status === "expired" || order.expiredAt) && expirationDateISO(order) === today
    ).length;

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

  // Guideline table: 아침 사입 계산 공식 연산
  function renderGuidelineTable() {
    if (!purchaseTable) return;

    const products = window.FridgeDB.getProducts();
    const orders = window.FridgeDB.getOrders();

    purchaseTable.innerHTML = "";

    products.filter((product) => product.category === "bundle").forEach(p => {
      // 해당 상품의 주문 확정 수량 (pending 또는 completed 상태)
      const confirmedOrdersCount = orders
        .filter(o => o.productId === p.id && (o.status === "pending" || o.status === "completed"))
        .reduce((total, order) => total + (Number(order.quantity) || 1), 0);
      const restockReqs = Number(p.waitlistRequests || p.restockRequests) || 0;

      // 공식: 현재 주문 확정 수량 + 재입고 알림 신청 유저 수 * 0.7
      const recommendedQty = Math.ceil(confirmedOrdersCount + (restockReqs * 0.7));

      let alertText = "재고 여유";
      let alertClass = "admin-badge green";
      
      if (p.stock === 0 || p.isClosed) {
        alertText = "품절 대응";
        alertClass = "admin-badge red";
      } else if (window.ProductRules.isClosingSoon(p)) {
        alertText = "사입 필요";
        alertClass = "admin-badge yellow";
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${p.name}</strong></td>
        <td>${p.stock}개</td>
        <td>${confirmedOrdersCount}건</td>
        <td>${restockReqs}명</td>
        <td style="font-size:15px; font-weight:800; color:#1f5f43;">${recommendedQty}개</td>
        <td><span class="${alertClass}">${alertText}</span></td>
      `;
      purchaseTable.appendChild(tr);
    });
  }

  function renderStoreInventoryGuideline() {
    if (!storeInventoryTable) return;
    const products = window.FridgeDB.getProducts()
      .filter((product) => product.category === "fruit" || product.category === "market");
    if (!products.length) {
      storeInventoryTable.innerHTML = `<tr><td colspan="7" class="admin-empty-row"><strong>매장 판매 상품이 없습니다.</strong></td></tr>`;
      return;
    }

    storeInventoryTable.innerHTML = products.map((product) => {
      const recentSales = Number(product.posSales7d ?? product.salesCount) || 0;
      const expectedDailySales = Math.ceil(recentSales / 7);
      const safetyStock = Math.ceil(expectedDailySales * 0.2);
      const recommendedQty = Math.max(0, expectedDailySales + safetyStock - (Number(product.stock) || 0));
      const connected = Number.isFinite(Number(product.posSales7d));
      return `
        <tr>
          <td><strong>${product.name}</strong></td>
          <td>${product.category === "fruit" ? "오늘의 과일" : "둘러보기 상품"}</td>
          <td>${Number(product.stock) || 0}개</td>
          <td>${recentSales}개 / 7일</td>
          <td>${expectedDailySales}개</td>
          <td style="font-size:15px;font-weight:800;color:#1f5f43;">${recommendedQty}개</td>
          <td><span class="admin-badge ${connected ? "green" : "yellow"}">${connected ? "POS 연동" : "임시 추정"}</span></td>
        </tr>`;
    }).join("");
  }

  // Populating product filter dropdown
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

  function applyPackingFilters(orders) {
    const filterProduct = filterProductSelect?.value || "all";
    const pickupDate = packingPickupDate?.value || "";
    const searchTerm = packingOrderSearch?.value.trim().toLocaleLowerCase("ko-KR") || "";
    const productsById = new Map(
      window.FridgeDB.getProducts().map((product) => [product.id, product])
    );
    return filterOrdersByScope(orders).filter((order) => {
      if (filterProduct !== "all" && order.productId !== filterProduct) return false;
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

  // Order table
  window.renderAdminOrders = function () {
    if (!packingTable) return;

    const orders = window.FridgeDB.getOrders();
    const account = window.FridgeDB.getUserAccount();
    packingTable.innerHTML = "";

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
      packingTable.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#999;">해당 조건의 주문 내역이 없습니다.</td></tr>`;
      return;
    }

    filtered.forEach(o => {
      let payTypeKo = o.paymentType === "onsite" ? "현장결제" : "계좌이체";
      let statusBadge = "";
      
      // 입금 승인 여부에 따른 표시 분기
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

      // 조작 버튼
      const actionButtons = [];
      if (["pending", "applied"].includes(o.status) && o.paymentType === "transfer" && !o.transferApproved) {
        actionButtons.push(`<button onclick="approveTransfer('${o.id}')" class="approve-btn">입금 승인</button>`);
        actionButtons.push(`<button onclick="sendPaymentReminder('${o.id}')" class="restore-btn">입금 알림</button>`);
      } else if (o.status === "expired") {
        actionButtons.push(`<button onclick="restoreOrder('${o.id}')" class="restore-btn">상태 원복</button>`);
      }
      if (["pending", "applied"].includes(o.status)) {
        actionButtons.push(`<button onclick="showOrderCancelConfirmation(this, '${o.id}')" class="cancel-order-btn">주문 취소</button>`);
      }
      const actionBtn = actionButtons.length
        ? `<div class="order-action-buttons">${actionButtons.join("")}</div>`
        : "-";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><code>${o.id}</code></td>
        <td><strong>${o.customerName || o.userName || account?.name || "고객"}</strong></td>
        <td><strong>${o.productName}</strong></td>
        <td><strong>${Number(o.quantity) || 1}개</strong></td>
        <td>${o.pickupDate}</td>
        <td>${payTypeKo}</td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      `;
      packingTable.appendChild(tr);
    });
  }

  // Transfer approval action
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

  window.cancelOrderByAdmin = function (orderId) {
    const order = window.FridgeDB.getOrders().find((item) => item.id === orderId);
    if (!order || order.status !== "pending") {
      alert("현재 취소할 수 없는 주문입니다.");
      return;
    }
    const reason = prompt("주문 취소 사유를 입력해 주세요. 고객 주문내역에도 표시됩니다.", "");
    if (reason === null) return;
    if (!reason.trim()) {
      alert("취소 사유를 입력해 주세요.");
      return;
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
        stock: totalStock > 0 ? Math.min(restoredStock, totalStock) : restoredStock
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
  packingFilterReset?.addEventListener("click", () => {
    if (packingOrderSearch) packingOrderSearch.value = "";
    if (packingPickupDate) packingPickupDate.value = "";
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
        <td>${date}</td>
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

  // Expiration Panel rendering
  function renderUnclaimedOrders() {
    if (!unclaimedTable) return;

    const orders = window.FridgeDB.getOrders();
    const account = window.FridgeDB.getUserAccount();
    unclaimedTable.innerHTML = "";

    // 아직 완료되지 않고, 만료되지 않은 대기 주문들
    const activeOrders = orders.filter(o => o.status === "pending");

    if (activeOrders.length === 0) {
      unclaimedTable.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#999;">현재 관리 대상인 대기 주문 건이 없습니다.</td></tr>`;
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

  // Force Expire Order & Increment No-Show
  window.expireOrder = function (orderId) {
    const orders = window.FridgeDB.getOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // 만료 상태 변경
    const updates = { status: "expired", expiredAt: new Date().toISOString(), restoredAt: null };
    
    // 노쇼 스택을 올리지 않았던 건이면 유저의 노쇼 스택 증가
    let noShowIncremented = false;
    if (!order.userNoShowStacked) {
      const user = window.FridgeDB.getUserAccount();
      const nextStack = Math.min(3, (user.noShowStack || 0) + 1);
      window.FridgeDB.updateUserAccount({ noShowStack: nextStack });
      updates.userNoShowStacked = true;
      noShowIncremented = true;
    }

    window.FridgeDB.updateOrder(orderId, updates);
    alert(`🚨 미수령 만료 처리가 완료되었습니다.\n\n- 바코드 강제 잠금\n- 빨간색 만료 스탬프 오버레이\n${noShowIncremented ? '- 고객 노쇼 1스택 누적 (현장결제 자동 제한 여부 갱신)' : ''}`);
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  // Restore order to pending & revert no-show if needed
  window.restoreOrder = function (orderId) {
    const orders = window.FridgeDB.getOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const updates = { status: "pending", restoredAt: new Date().toISOString() };

    // 이 주문으로 노쇼 스택이 올라갔었다면 복원
    if (order.userNoShowStacked) {
      const user = window.FridgeDB.getUserAccount();
      const nextStack = Math.max(0, (user.noShowStack || 0) - 1);
      window.FridgeDB.updateUserAccount({ noShowStack: nextStack });
      updates.userNoShowStacked = false;
    }

    window.FridgeDB.updateOrder(orderId, updates);
    alert("✅ 주문 상태가 정상 대기 상태로 원복되었습니다. 고객의 바코드가 즉시 복구됩니다.");
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  // User No-Show Panel
  function renderUserNoShowPanel() {
    if (!noshowCountDisplay) return;
    const user = window.FridgeDB.getUserAccount();
    noshowCountDisplay.textContent = `${user.noShowStack}회`;
  }

  window.adjustNoShow = function (amount) {
    const user = window.FridgeDB.getUserAccount();
    const nextStack = Math.max(0, Math.min(3, (user.noShowStack || 0) + amount));
    window.FridgeDB.updateUserAccount({ noShowStack: nextStack });
    alert(`👤 노쇼 스택이 조정되었습니다: 현재 ${nextStack}회\n(3회 이상 시 현장결제가 원천 차단됩니다)`);
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.resetNoShow = function () {
    window.FridgeDB.updateUserAccount({ noShowStack: 0 });
    alert("👤 단골 고객의 노쇼 횟수가 0회로 완전히 초기화되었습니다.");
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  // Review blind and reply panel
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

  window.toggleReviewBlind = function (reviewId) {
    const reviews = window.FridgeDB.getReviews();
    const review = reviews.find(r => r.id === reviewId);
    if (!review) return;

    window.FridgeDB.updateReview(reviewId, { isVisible: !review.isVisible });
    alert(`리뷰 상태가 변경되었습니다: ${!review.isVisible ? '블라인드 완료(홈 화면에서 차단)' : '노출 해제 완료'}`);
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  window.submitReviewReply = function (reviewId) {
    const input = document.getElementById(`reply-input-${reviewId}`);
    const text = input.value.trim();
    if (!text) {
      alert("답변 내용을 입력해 주세요.");
      return;
    }

    window.FridgeDB.updateReview(reviewId, { reply: text });
    input.value = "";
    alert("🏪 후기 답글이 등록되었습니다. 상세페이지 및 홈 화면 리뷰 아래에 하위 리플라이 UI로 매칭 노출됩니다.");
    renderAdminDashboard();
    refreshPreviewIframe();
  };

  // Inquiry Panel rendering
  function renderInquiriesPanel() {
    if (!adminInquiriesContainer) return;

    const products = window.FridgeDB.getProducts();
    adminInquiriesContainer.innerHTML = "";

    let hasAnyInquiry = false;

    products.forEach(p => {
      const key = "todayFridgeInquiries_" + p.id;
      const inquiries = JSON.parse(localStorage.getItem(key) || "[]");

      if (inquiries.length > 0) {
        hasAnyInquiry = true;
        inquiries.forEach((inq, idx) => {
          const card = document.createElement("div");
          card.className = "feedback-card";

          let answerHTML = `<span style="color:#aaa;">미답변</span>`;
          if (inq.answer) {
            answerHTML = `<div style="background:#eef6f2; padding:8px; border-radius:6px; margin-bottom:8px; font-size:11px; border-left:3px solid #1f5f43;"><strong>🏪 내 답변:</strong> ${inq.answer}</div>`;
          }

          card.innerHTML = `
            <div class="feedback-card-head">
              <span>상품: ${p.name} | 질문 #${idx + 1} | ${inq.date}</span>
              <span style="font-weight:bold; color:${inq.answer ? '#1f5f43' : '#b94242'};">${inq.answer ? '답변완료' : '대기중'}</span>
            </div>
            <div class="feedback-card-body" style="font-size:12px; color:#555;">Q. ${inq.question}</div>
            ${answerHTML}
            <div style="display:flex; gap:10px; margin-top:8px;">
              <input type="text" id="answer-input-${p.id}-${idx}" placeholder="답변 내용을 작성해 주세요" style="flex:1; padding:6px 10px; border:1px solid #ddd; border-radius:6px; font-size:11px; outline:none;">
              <button onclick="submitInquiryAnswer('${p.id}', ${idx})" style="background:#1f5f43; color:#fff; padding:6px 12px; border:0; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer;">답변 등록</button>
            </div>
          `;
          adminInquiriesContainer.appendChild(card);
        });
      }
    });

    if (!hasAnyInquiry) {
      adminInquiriesContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#999; font-size:12px;">등록된 고객 1:1 문의사항이 없습니다.</div>`;
    }
  }

  window.submitInquiryAnswer = function (productId, index) {
    const input = document.getElementById(`answer-input-${productId}-${index}`);
    const text = input.value.trim();
    if (!text) {
      alert("답변 내용을 입력해 주세요.");
      return;
    }

    const key = "todayFridgeInquiries_" + productId;
    const inquiries = JSON.parse(localStorage.getItem(key) || "[]");
    
    if (inquiries[index]) {
      inquiries[index].answer = text;
      localStorage.setItem(key, JSON.stringify(inquiries));
      input.value = "";
      alert("🏪 문의 사항에 대한 답글이 전송되었습니다. 고객 상세페이지 문의 내역에 반영됩니다.");
      renderAdminDashboard();
      refreshPreviewIframe();
    }
  };

  // 4. Print simulation
  window.simulatePrint = function () {
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
      const date = order.pickupDate || order.pickupDateISO || "-";
      const hour = Number(order.pickupHour);
      return `${date}${Number.isFinite(hour) ? ` · ${String(hour).padStart(2, "0")}:00` : ""}`;
    };
    const grouped = filtered.reduce((result, order) => {
      const key = order.productId || "unknown";
      if (!result[key]) result[key] = [];
      result[key].push(order);
      return result;
    }, {});
    const selectedProduct = products.find((product) => product.id === filterProduct);
    const sections = Object.entries(grouped).map(([productId, productOrders]) => {
      const product = products.find((item) => item.id === productId);
      const rows = productOrders.map((order) => `
        <tr>
          <td>${escapeHTML(order.customerName || order.userName || account?.name || "고객")}</td>
          <td class="quantity">${Number(order.quantity) || 1}개</td>
          <td>${escapeHTML(pickupText(order))}</td>
          <td>${order.paymentType === "onsite" ? "현장결제" : "계좌이체"}</td>
          <td class="check-cell"><span></span></td>
        </tr>`).join("");
      return `
        <section>
          <h2>${escapeHTML(product?.name || productOrders[0]?.productName || "상품")}</h2>
          <table>
            <thead><tr><th>고객 이름</th><th>수령 수량</th><th>수령 예약일시</th><th>결제방식</th><th>확인</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
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
        @page{size:A4 portrait;margin:14mm}
        *{box-sizing:border-box}body{margin:0;color:#171c19;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
        header{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:12px;border-bottom:2px solid #1d2e26}
        h1{margin:0;font-size:21px}header p{margin:0;color:#66716c;font-size:10px}
        section{margin-top:20px;break-inside:avoid}h2{margin:0 0 8px;font-size:14px}
        table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px}
        th{padding:9px 8px;border:1px solid #cfd6d2;background:#f3f6f4;text-align:left}
        td{height:42px;padding:8px;border:1px solid #d9dfdc;vertical-align:middle}
        th:nth-child(1){width:20%}th:nth-child(2){width:13%}th:nth-child(3){width:31%}th:nth-child(4){width:20%}th:nth-child(5){width:16%}
        .quantity{text-align:center;font-weight:700}.check-cell{text-align:center}.check-cell span{display:inline-block;width:18px;height:18px;border:1.5px solid #57645e;border-radius:3px}
        footer{margin-top:12px;color:#77817c;font-size:9px;text-align:right}
      </style></head><body>
      <header><div><h1>패킹 주문 리스트</h1><p>${escapeHTML(selectedProduct?.name || "전체 상품")}</p></div><p>${new Date().toLocaleString("ko-KR")} · 총 ${filtered.length}건</p></header>
      ${sections}<footer>오늘의 냉장고 관리자 센터</footer>
      <script>window.addEventListener("load",()=>{window.print();});<\/script>
      </body></html>`);
    printWindow.document.close();
    return;

    let printHTML = `========================================\n`;
    printHTML += `        오늘의 냉장고 포장/패킹 리스트 (A4)\n`;
    printHTML += `        출력 시간: 2026. 07. 14 화요일\n`;
    printHTML += `========================================\n\n`;

    filtered.forEach((o, i) => {
      printHTML += `${i+1}. 주문ID: ${o.id}\n`;
      printHTML += `   상품명  : ${o.productName}\n`;
      printHTML += `   수령예정 : ${o.pickupDate}\n`;
      printHTML += `   결제유형 : ${o.paymentType === 'onsite' ? '현장결제' : '계좌이체'}\n`;
      printHTML += `   주문상태 : ${o.status === 'completed' ? '수령 완료' : (o.status === 'expired' ? '미수령 만료' : '대기 중')}\n`;
      printHTML += `----------------------------------------\n`;
    });

    console.log(printHTML);
    alert(`🖨️ 포장/패킹 주문 리스트 인쇄를 시작합니다.\n\n(자세한 텍스트 데이터는 개발자 도구 콘솔 로그에 인쇄 포맷으로 정돈되어 출력되었습니다.)\n\n총 ${filtered.length}건 출력 완료.`);
  };

  // 5. Database control
  const RESET_PASSWORD_HASH_KEY = "todayFridgeAdminResetPasswordHash";

  async function hashResetPassword(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  window.changeResetPassword = async function () {
    const savedHash = localStorage.getItem(RESET_PASSWORD_HASH_KEY);
    if (savedHash) {
      const current = prompt("현재 초기화 비밀번호를 입력해 주세요.");
      if (current === null) return;
      if (await hashResetPassword(current) !== savedHash) {
        alert("현재 비밀번호가 일치하지 않습니다.");
        return;
      }
    }

    const password = prompt("새 초기화 비밀번호를 입력해 주세요. (4자 이상)");
    if (password === null) return;
    if (password.length < 4) {
      alert("비밀번호는 4자 이상으로 설정해 주세요.");
      return;
    }
    const confirmation = prompt("새 비밀번호를 한 번 더 입력해 주세요.");
    if (confirmation === null) return;
    if (password !== confirmation) {
      alert("입력한 비밀번호가 서로 다릅니다.");
      return;
    }
    localStorage.setItem(RESET_PASSWORD_HASH_KEY, await hashResetPassword(password));
    alert("초기화 확인 비밀번호를 설정했습니다.");
  };

  window.resetAllDatabaseData = async function () {
    const savedHash = localStorage.getItem(RESET_PASSWORD_HASH_KEY);
    if (!savedHash) {
      alert("먼저 ‘초기화 비밀번호 설정’에서 확인 비밀번호를 등록해 주세요.");
      return;
    }
    const password = prompt("데이터 초기화 비밀번호를 입력해 주세요.");
    if (password === null) return;
    if (await hashResetPassword(password) !== savedHash) {
      alert("비밀번호가 일치하지 않아 초기화를 중단했습니다.");
      return;
    }
    if (confirm("정말로 모든 데이터를 초기화하시겠습니까? 수령증 상태, 리뷰 답변, 문의 사항이 초기 프로토타입 상태로 원복됩니다.")) {
      window.FridgeDB.resetData();
      
      // Clear specific local storage keys
      localStorage.removeItem("todayFridgeHasVoted");
      
      // Clear product inquiry keys
      const products = window.FridgeDB.getProducts();
      products.forEach(p => {
        localStorage.removeItem("todayFridgeInquiries_" + p.id);
        localStorage.removeItem("restock_requested_" + p.id);
      });

      alert("🔄 데이터베이스 및 관련 설정이 성공적으로 초기화되었습니다.");
      renderAdminDashboard();
      refreshPreviewIframe();
    }
  };

  // 6. Iframe Preview Controller
  window.refreshPreviewIframe = function () {
    const iframe = document.getElementById("preview-iframe");
    if (iframe) {
      iframe.src = iframe.src; // Reload
    }
  };

  // 7. 관리자 인증이 끝난 뒤에만 화면 데이터와 조작 기능을 시작합니다.
  verifyAdmin().then((allowed) => {
    if (!allowed) return;
    populateProductFilter();
    renderRecommendedSearchAdmin();
    renderAdminDashboard();

    window.addEventListener("storage", () => {
      renderAdminDashboard();
    });
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "admin-product-form") return;
    event.preventDefault();
    const form = new FormData(event.target);
    const category = form.get("category");
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
      stock: Number(form.get("stock")) || 0,
      totalStock: Math.max(Number(form.get("totalStock")) || 0, Number(form.get("stock")) || 0),
      deadline: form.get("deadline") || (category === "bundle" ? "" : "상시 판매"),
      deadlineTime: form.get("deadlineTime") || "23:59",
      image: "./asset-store-market.png",
      images: ["./asset-store-market.png"],
      salesCount: 0,
      rating: 0,
      reviewsCount: 0,
      isClosed: false,
      restockRequests: 0,
      waitlistRequests: 0,
      tags: []
    });
    closeRestockDialog();
    renderProductManagement();
  });
})();
