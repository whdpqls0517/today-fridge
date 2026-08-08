// 서버 데이터를 화면에 전달하는 공통 메모리 저장소입니다.
// 상품·주문·후기·회원 정보는 localStorage를 원본으로 사용하지 않습니다.
(function (global) {
  const state = {
    products: [],
    orders: [],
    reviews: [],
    userAccount: null,
    catalogLoaded: false
  };
  const catalogCacheKey = "todayFridgeCatalogCache:v1";

  try {
    const cached = JSON.parse(sessionStorage.getItem(catalogCacheKey));
    if (Array.isArray(cached?.data) && Date.now() - Number(cached.savedAt || 0) < 10 * 60 * 1000) {
      state.products = cached.data;
    }
  } catch (_) {
    sessionStorage.removeItem(catalogCacheKey);
  }

  const legacyKeys = [
    "todayFridgeDB",
    "todayFridgeAuthSession",
    "todayFridgeBoundUserId",
    "todayFridgeNotificationsFeed"
  ];

  function clearLegacySampleData() {
    legacyKeys.forEach((key) => localStorage.removeItem(key));
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (
        key?.startsWith("todayFridgeInquiries_")
        || key?.startsWith("restock_requested_")
        || key?.startsWith("waitlist_requested_")
      ) {
        localStorage.removeItem(key);
      }
    }
  }

  function emitDataChange(type, detail) {
    global.dispatchEvent(new CustomEvent("todayFridgeDataUpdated", {
      detail: { type, data: detail }
    }));
    global.dispatchEvent(new Event("storage"));
    if (type === "products") {
      global.dispatchEvent(new CustomEvent("todayFridgeCatalogUpdated", { detail }));
    }
  }

  function replaceCollection(key, value) {
    if (!Array.isArray(value)) return false;
    state[key] = value;
    emitDataChange(key, value);
    return true;
  }

  const DB = {
    getData() {
      return state;
    },
    resetData() {
      state.products = [];
      state.orders = [];
      state.reviews = [];
      state.userAccount = null;
      emitDataChange("all", state);
      return state;
    },
    getProducts() {
      return state.products;
    },
    isCatalogLoaded() {
      return state.catalogLoaded;
    },
    replaceProducts(products) {
      return replaceCollection("products", products);
    },
    updateProduct(id, updates) {
      const index = state.products.findIndex((product) => String(product.id) === String(id));
      if (index < 0) return false;
      state.products[index] = { ...state.products[index], ...updates };
      emitDataChange("products", state.products);
      return true;
    },
    addProduct(product) {
      state.products.unshift(product);
      emitDataChange("products", state.products);
      return true;
    },
    deleteProduct(id) {
      const next = state.products.filter((product) => String(product.id) !== String(id));
      if (next.length === state.products.length) return false;
      state.products = next;
      emitDataChange("products", state.products);
      return true;
    },
    getOrders() {
      return state.orders;
    },
    replaceOrders(orders) {
      return replaceCollection("orders", orders);
    },
    updateOrder(id, updates) {
      const index = state.orders.findIndex((order) => String(order.id) === String(id));
      if (index < 0) return false;
      state.orders[index] = { ...state.orders[index], ...updates };
      emitDataChange("orders", state.orders);
      return true;
    },
    addOrder(order) {
      state.orders.push(order);
      emitDataChange("orders", state.orders);
      return true;
    },
    getReviews() {
      return state.reviews;
    },
    replaceReviews(reviews) {
      return replaceCollection("reviews", reviews);
    },
    addReview(review) {
      state.reviews.unshift(review);
      emitDataChange("reviews", state.reviews);
      return true;
    },
    updateReview(id, updates) {
      const index = state.reviews.findIndex((review) => String(review.id) === String(id));
      if (index < 0) return false;
      state.reviews[index] = { ...state.reviews[index], ...updates };
      emitDataChange("reviews", state.reviews);
      return true;
    },
    getUserAccount() {
      return state.userAccount;
    },
    setUserAccount(account) {
      state.userAccount = account ? { ...account } : null;
      emitDataChange("user", state.userAccount);
      return true;
    },
    updateUserAccount(updates) {
      if (!state.userAccount) return false;
      state.userAccount = { ...state.userAccount, ...updates };
      emitDataChange("user", state.userAccount);
      return true;
    },
    bindAuthenticatedUser(user) {
      if (!user?.id) return false;
      state.userAccount = {
        userId: String(user.id),
        name: user.nickname || user.name || "고객",
        email: user.email || "",
        provider: "kakao",
        noShowStack: Number(user.noShowStack ?? user.no_show_count) || 0,
        role: user.role || "customer"
      };
      emitDataChange("user", state.userAccount);
      return true;
    },
    clearAuthenticatedUser() {
      state.userAccount = null;
      state.orders = [];
      emitDataChange("user", null);
      emitDataChange("orders", []);
    }
  };

  global.FridgeDB = DB;
  clearLegacySampleData();

  function accessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const session = JSON.parse(localStorage.getItem(key));
        const token = session?.access_token || session?.currentSession?.access_token;
        if (token) return token;
      } catch (_) {}
    }
    return null;
  }

  function mapOrder(order) {
    const item = order.bundle_items || {};
    const product = item.products || {};
    return {
      id: order.id,
      orderNumber: order.order_number,
      productId: product.id,
      bundleItemId: order.bundle_item_id,
      productName: product.name || "",
      optionName: order.option_name || "",
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
      createdAt: order.created_at
    };
  }

  if (!global.location.protocol.startsWith("http")) return;

  DB.catalogReady = fetch(`${global.location.origin}/api/catalog`, { cache: "no-store" })
    .then((response) => response.json())
    .then((result) => {
      if (result?.success && Array.isArray(result.data)) {
        state.catalogLoaded = true;
        sessionStorage.setItem(catalogCacheKey, JSON.stringify({
          savedAt: Date.now(),
          data: result.data
        }));
        DB.replaceProducts(result.data);
      }
      return DB.getProducts();
    })
    .catch(() => DB.getProducts())
    .finally(() => {
      state.catalogLoaded = true;
    });

  fetch(`${global.location.origin}/api/reviews`, { cache: "no-store" })
    .then((response) => response.json())
    .then((result) => {
      if (result?.success && Array.isArray(result.data)) DB.replaceReviews(result.data);
    })
    .catch(() => {});

  const token = accessToken();
  if (!token) {
    DB.clearAuthenticatedUser();
    return;
  }

  fetch(`${global.location.origin}/api/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  })
    .then((response) => response.json())
    .then((result) => {
      if (result?.success && Array.isArray(result.data)) DB.replaceOrders(result.data.map(mapOrder));
      else DB.replaceOrders([]);
    })
    .catch(() => DB.replaceOrders([]));
})(window);
