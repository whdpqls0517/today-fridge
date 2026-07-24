// 공통 데이터베이스 스크립트 (localStorage 연동)
(function (global) {
  const STORAGE_KEY = "todayFridgeDB";
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  function relativeDate(offset) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return date;
  }

  function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function relativeISO(offset) {
    return isoDate(relativeDate(offset));
  }

  function pickupLabel(offset, hour = 19) {
    const date = relativeDate(offset);
    return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${WEEKDAYS[date.getDay()]} ${String(hour).padStart(2, "0")}:00`;
  }

  // 기본 모의 데이터 정의
  const defaultData = {
    sampleDataVersion: 14,
    sampleDateStamp: relativeISO(0),
    products: [
      {
        id: "bundle-citrus",
        name: "제주 감귤 보따리",
        category: "bundle",
        categoryLabel: "공구",
        purchaseMode: "reservation",
        price: 15000,
        originalPrice: 22000,
        showOriginalPrice: false,
        description: "제주 직송! 당도 최고 조생 감귤 한 보따리",
        image: "./asset-bundle-food-gradient.png",
        images: ["./asset-bundle-food-gradient.png", "./asset-daily-fruit.png", "./asset-store-market.png"],
        deadline: relativeISO(0),
        pickupDate: relativeISO(0),
        barcodeValue: "880123456701",
        arrivalStatus: "arrived",
        stock: 5,
        totalStock: 50,
        salesCount: 35,
        rating: 4.9,
        reviewsCount: 82,
        isClosed: false,
        restockRequests: 0,
        tags: ["#제주산", "#산지직송", "#당도보장"]
      },
      {
        id: "bundle-tomato",
        name: "토마토 한정 보따리",
        category: "bundle",
        categoryLabel: "공구",
        purchaseMode: "reservation",
        price: 10000,
        originalPrice: 15000,
        showOriginalPrice: false,
        description: "완토 보따리! 찰토마토 선별 10kg 한정 수량",
        image: "./asset-bundle-mixed-food.png",
        images: ["./asset-bundle-mixed-food.png", "./asset-bundle-produce.png", "./asset-store-market.png"],
        deadline: relativeISO(-2),
        pickupDate: relativeISO(-1),
        barcodeValue: "880123456702",
        arrivalStatus: "scheduled",
        stock: 2,
        totalStock: 20,
        salesCount: 42,
        rating: 4.8,
        reviewsCount: 51,
        isClosed: true,
        restockRequests: 0,
        tags: ["#완숙토마토", "#한정판매", "#신선야채"]
      },
      {
        id: "bundle-salad",
        name: "샐러드 채소 보따리",
        category: "bundle",
        categoryLabel: "공구",
        purchaseMode: "reservation",
        price: 9000,
        originalPrice: 12000,
        showOriginalPrice: false,
        description: "아침에 딴 아삭아삭 샐러드용 채소 팩",
        image: "./asset-bundle-produce.png",
        images: ["./asset-bundle-produce.png", "./asset-bundle-mixed-food.png"],
        deadline: relativeISO(-4),
        pickupDate: relativeISO(-3),
        barcodeValue: "880123456703",
        arrivalStatus: "arrived",
        stock: 6, // 재고가 남아 있어도 마감일 경과로 자동 마감되는 예시
        totalStock: 30,
        salesCount: 18,
        rating: 4.7,
        reviewsCount: 39,
        isClosed: false, // 화면 규칙이 마감일 경과를 자동 판정
        restockRequests: 14, // 기존 신청자 수
        tags: ["#친환경", "#다이어트", "#매일아침"]
      },
      {
        id: "bundle-meal",
        name: "냉장고 한끼 보따리",
        category: "bundle",
        categoryLabel: "공구",
        purchaseMode: "reservation",
        price: 12900,
        originalPrice: 19000,
        showOriginalPrice: false,
        description: "밀키트와 야채를 한 번에 해결하는 올인원 보따리",
        image: "./asset-bundle-food-gradient.png",
        images: ["./asset-bundle-food-gradient.png", "./asset-store-market.png", "./asset-bundle-mixed-food.png"],
        deadline: relativeISO(1),
        pickupDate: relativeISO(2),
        barcodeValue: "880123456704",
        arrivalStatus: "scheduled",
        stock: 1, // 마감임박
        totalStock: 10,
        salesCount: 32,
        prepaymentOnly: true,
        rating: 4.9,
        reviewsCount: 82,
        isClosed: false,
        restockRequests: 0,
        tags: ["#간편한끼", "#밀키트세트", "#가성비최고"]
      },
      {
        id: "daily-fruit",
        name: "성주 꿀참외 1.5kg (특과)",
        category: "fruit",
        categoryLabel: "오늘의 과일",
        purchaseMode: "store",
        price: 8800,
        originalPrice: 11000,
        showOriginalPrice: true,
        description: "오늘 아침 산지에서 갓 수확한 당도 14브릭스 이상 참외입니다.",
        image: "./asset-daily-fruit.png",
        images: ["./asset-daily-fruit.png", "./asset-bundle-food-gradient.png"],
        deadline: relativeISO(0),
        detailSpecs: [
          { title: "🍎 과일 정밀 당도 및 생산 스펙", body: "" },
          { title: "🍯 평균 당도 보장", body: "14 Brix 이상 (명품 달콤당도 🍯)" },
          { title: "📍 산지 원산지", body: "경북 성주 명품 참외단지 산지직송" },
          { title: "📦 패키지 중량", body: "성주 꿀참외 1.5kg 내외 (4~6과입)" },
          { title: "🌡️ 권장 보관 및 숙성", body: "수령 후 하루 통풍 보관 후 냉장고 냉장실 보관" }
        ],
        stock: 15,
        totalStock: 30,
        salesCount: 10,
        rating: 4.8,
        reviewsCount: 22,
        isClosed: false,
        restockRequests: 0,
        tags: ["#비타민충전", "#직판장", "#당일입고"]
      },
      {
        id: "salad-produce",
        name: "샐러드 채소 모음",
        category: "market",
        categoryLabel: "매장픽",
        purchaseMode: "store",
        price: 9900,
        originalPrice: 14000,
        showOriginalPrice: true,
        description: "여러 가지 쌈채소와 양상추가 가득 담긴 보따리",
        image: "./asset-bundle-produce.png",
        images: ["./asset-bundle-produce.png", "./asset-bundle-mixed-food.png"],
        deadline: relativeISO(1),
        stock: 8,
        totalStock: 40,
        salesCount: 29,
        rating: 4.7,
        reviewsCount: 15,
        isClosed: false,
        restockRequests: 0,
        tags: ["#유기농", "#아침식단", "#프레시"]
      },
      {
        id: "store-pick",
        name: "매장 진열 추천팩",
        category: "market",
        categoryLabel: "매장픽",
        purchaseMode: "store",
        price: 15500,
        originalPrice: 20000,
        showOriginalPrice: false,
        description: "매장에 상시 판매중인 베스트셀러 밀키트 라인업",
        image: "./asset-store-market.png",
        images: ["./asset-store-market.png", "./asset-bundle-food-gradient.png"],
        deadline: "상시 판매",
        stock: 0,
        totalStock: 20,
        salesCount: 5,
        rating: 4.6,
        reviewsCount: 28,
        isClosed: true,
        restockRequests: 0,
        tags: ["#밀키트", "#상시할인", "#방문구매"]
      }
    ],
    orders: [
      {
        id: "order-1",
        productId: "bundle-citrus",
        productName: "제주 감귤 보따리",
        paymentType: "onsite", // 현장결제
        status: "expired", // 지정 수령일이 지나 미수령 처리
        bundleDate: relativeISO(-3),
        arrivalStatus: "arrived",
        pickupDate: pickupLabel(-2),
        pickupDateISO: relativeISO(-2),
        pickupHour: 18,
        price: 15000,
        userNoShowStacked: true
      },
      {
        id: "order-2",
        productId: "bundle-tomato",
        productName: "토마토 한정 보따리",
        paymentType: "transfer", // 계좌이체
        status: "pending", // pending 상태이나 계좌이체대기
        bundleDate: relativeISO(1),
        arrivalStatus: "scheduled",
        pickupDate: pickupLabel(2, 20),
        pickupDateISO: relativeISO(2),
        pickupHour: 20,
        price: 10000,
        userNoShowStacked: false
      },
      {
        id: "order-3",
        productId: "bundle-salad",
        productName: "샐러드 채소 보따리",
        paymentType: "transfer",
        status: "expired", // 미수령 만료
        bundleDate: relativeISO(-4),
        arrivalStatus: "arrived",
        pickupDate: pickupLabel(-3, 20),
        pickupDateISO: relativeISO(-3),
        pickupHour: 20,
        price: 9000,
        userNoShowStacked: true
      },
      {
        id: "order-4",
        productId: "bundle-meal",
        productName: "냉장고 한끼 보따리",
        paymentType: "onsite",
        status: "pending",
        bundleDate: relativeISO(-2),
        arrivalStatus: "arrived",
        pickupDate: pickupLabel(0),
        pickupDateISO: relativeISO(0),
        pickupHour: 18,
        price: 12900,
        userNoShowStacked: false
      },
      {
        id: "demo-ready-transfer",
        productId: "bundle-tomato",
        productName: "예시 · 토마토 보따리",
        paymentType: "transfer",
        transferApproved: true,
        status: "pending",
        bundleDate: relativeISO(0),
        arrivalStatus: "arrived",
        pickupDate: pickupLabel(0),
        pickupDateISO: relativeISO(0),
        pickupHour: 19,
        price: 10000,
        userNoShowStacked: false
      },
      {
        id: "demo-ready-postponed",
        productId: "bundle-citrus",
        productName: "예시 · 과거 입고 / 오늘 수령",
        paymentType: "onsite",
        status: "pending",
        bundleDate: relativeISO(-3),
        arrivalStatus: "arrived",
        pickupDate: pickupLabel(0),
        pickupDateISO: relativeISO(0),
        pickupHour: 18,
        isPostponed: true,
        price: 15000,
        userNoShowStacked: false
      },
      {
        id: "demo-completed",
        productId: "bundle-meal",
        productName: "예시 · 수령 완료 보따리",
        paymentType: "transfer",
        transferApproved: true,
        status: "completed",
        bundleDate: relativeISO(-2),
        arrivalStatus: "arrived",
        pickupDate: pickupLabel(-1),
        pickupDateISO: relativeISO(-1),
        pickupHour: 17,
        price: 12900,
        userNoShowStacked: false
      },
      {
        id: "demo-expired",
        productId: "bundle-salad",
        productName: "예시 · 미수령 보따리",
        paymentType: "onsite",
        status: "expired",
        bundleDate: relativeISO(-2),
        arrivalStatus: "arrived",
        pickupDate: pickupLabel(-1),
        pickupDateISO: relativeISO(-1),
        pickupHour: 18,
        price: 9000,
        userNoShowStacked: true
      },
      {
        id: "demo-scheduled-onsite",
        productId: "bundle-citrus",
        productName: "예시 · 내일 입고 보따리",
        paymentType: "onsite",
        status: "pending",
        bundleDate: relativeISO(1),
        arrivalStatus: "scheduled",
        pickupDate: pickupLabel(2),
        pickupDateISO: relativeISO(2),
        pickupHour: 18,
        price: 15000,
        userNoShowStacked: false
      },
      {
        id: "demo-scheduled-transfer",
        productId: "bundle-tomato",
        productName: "예시 · 입고 예정 계좌이체",
        paymentType: "transfer",
        transferApproved: false,
        status: "pending",
        bundleDate: relativeISO(2),
        arrivalStatus: "scheduled",
        pickupDate: pickupLabel(3, 20),
        pickupDateISO: relativeISO(3),
        pickupHour: 20,
        price: 10000,
        userNoShowStacked: false
      }

      
    ],
    reviews: [
      {
        id: "review-1",
        productId: "bundle-citrus",
        productName: "보따리 · 제주 감귤",
        userName: "쿠루님",
        rating: 5,
        date: "26.03.18",
        comment: "퇴근 후 무인 수령했는데 안내가 단순해서 바로 찾아왔어요.",
        photoClass: "citrus-photo",
        isVisible: true,
        reply: null
      },
      {
        id: "review-2",
        productId: "bundle-tomato",
        productName: "보따리 · 토마토 한정",
        userName: "민지님",
        rating: 5,
        date: "26.03.21",
        comment: "남은 수량이 보여서 보따리 놓치지 않고 예약했어요.",
        photoClass: null,
        isVisible: true,
        reply: null
      },
      {
        id: "review-3",
        productId: "daily-fruit",
        productName: "오늘의 과일 · 딸기",
        userName: "하루님",
        rating: 5,
        date: "26.03.24",
        comment: "과일 상태가 좋아서 내일 투표도 참여하게 되네요.",
        photoClass: "berry-photo",
        isVisible: true,
        reply: null
      }
    ],
    userAccount: {
      userId: "user1",
      name: "김단골",
      phone: "010-1234-5678",
      email: "kakao-user@example.com",
      provider: "kakao",
      noShowStack: 3,
      kakaoId: "kakao_user_12345"
    }
  };

  function normalizeData(data) {
    const previousSampleDataVersion = data.sampleDataVersion || 0;
    const shouldRefreshSampleDates = data.sampleDateStamp !== relativeISO(0);
    const defaultProducts = defaultData.products;
    const products = Array.isArray(data.products) ? data.products : [];

    data.products = products.map((product) => {
      const defaultProduct = defaultProducts.find((item) => item.id === product.id) || {};
      const legacyFruitPatch = product.id === "daily-fruit" && product.name === "아침 제철 과일팩"
        ? {
            name: defaultProduct.name,
            description: defaultProduct.description,
            tags: defaultProduct.tags
          }
        : {};
      return {
        ...defaultProduct,
        ...product,
        ...legacyFruitPatch,
        ...(previousSampleDataVersion < 11 && defaultProduct.id
          ? { deadline: defaultProduct.deadline, pickupDate: defaultProduct.pickupDate }
          : {}),
        ...(previousSampleDataVersion < 12 && defaultProduct.id
          ? {
              stock: defaultProduct.stock,
              totalStock: defaultProduct.totalStock,
              isClosed: defaultProduct.isClosed
            }
          : {}),
        ...(previousSampleDataVersion < 13 && defaultProduct.id
          ? {
              barcodeValue: defaultProduct.barcodeValue,
              arrivalStatus: defaultProduct.arrivalStatus || null
            }
          : {}),
        ...((previousSampleDataVersion < 14 || shouldRefreshSampleDates) && defaultProduct.id
          ? {
              deadline: defaultProduct.deadline,
              pickupDate: defaultProduct.pickupDate,
              isClosed: defaultProduct.isClosed
            }
          : {}),
        showOriginalPrice: typeof product.showOriginalPrice === "boolean"
          ? product.showOriginalPrice
          : Boolean(defaultProduct.showOriginalPrice),
        totalStock: Math.max(
          Number(product.totalStock || defaultProduct.totalStock || product.stock || 0),
          Number(product.stock || 0)
        ),
        images: Array.isArray(product.images) && product.images.length > 0
          ? product.images
          : (defaultProduct.images || [product.image || defaultProduct.image]).filter(Boolean),
        deadline: previousSampleDataVersion < 11 && defaultProduct.id
          ? defaultProduct.deadline
          : (product.deadline || defaultProduct.deadline || "2026-07-14")
        ,
        categoryLabel: product.categoryLabel || defaultProduct.categoryLabel || (
          product.category === "bundle" ? "공구" : product.category === "fruit" ? "오늘의 과일" : "매장픽"
        ),
        productCategory: product.productCategory || defaultProduct.productCategory || ({
          "bundle-citrus": "fruit",
          "bundle-tomato": "vegetable",
          "bundle-salad": "vegetable",
          "bundle-meal": "meal-kit",
          "daily-fruit": "fruit",
          "salad-produce": "vegetable",
          "store-pick": "meal-kit"
        }[product.id] || "etc"),
        purchaseMode: product.purchaseMode || defaultProduct.purchaseMode || (
          product.category === "bundle" ? "reservation" : "store"
        ),
        detailSpecs: Array.isArray(product.detailSpecs) && product.detailSpecs.length > 0
          ? product.detailSpecs
          : (defaultProduct.detailSpecs || [])
      };
    });

    const savedOrders = Array.isArray(data.orders) ? data.orders : [];
    const demoOrders = defaultData.orders.filter((order) => order.id.startsWith("demo-"));
    const ordersWithSamples = previousSampleDataVersion < defaultData.sampleDataVersion
      ? [
          ...savedOrders,
          ...demoOrders.filter((sample) => !savedOrders.some((order) => order.id === sample.id))
        ]
      : savedOrders;

    data.orders = ordersWithSamples.map((order) => {
      const defaultOrder = defaultData.orders.find((item) => item.id === order.id) || {};
      const product = data.products.find((item) => item.id === order.productId);
      return {
        ...defaultOrder,
        ...order,
        ...(previousSampleDataVersion < 11 && defaultOrder.id
          ? {
              bundleDate: defaultOrder.bundleDate,
              pickupDate: defaultOrder.pickupDate,
              pickupDateISO: defaultOrder.pickupDateISO,
              pickupHour: defaultOrder.pickupHour
            }
          : {}),
        bundleDate: previousSampleDataVersion < 11 && defaultOrder.id
          ? defaultOrder.bundleDate
          : (order.bundleDate || defaultOrder.bundleDate || product?.deadline || null),
        arrivalStatus: order.arrivalStatus || defaultOrder.arrivalStatus || "scheduled"
      };
    });
    if (previousSampleDataVersion < 4) {
      const legacyCitrusOrder = data.orders.find((order) => order.id === "order-1");
      if (legacyCitrusOrder) {
        legacyCitrusOrder.bundleDate = "2026-07-14";
        legacyCitrusOrder.arrivalStatus = "arrived";
      }
    }
    data.sampleDateStamp = relativeISO(0);
    if (previousSampleDataVersion < 5) {
      const pastBundleTodayPickup = data.orders.find((order) => order.id === "demo-ready-postponed");
      if (pastBundleTodayPickup) {
        Object.assign(pastBundleTodayPickup, {
          productName: "예시 · 과거 입고 / 오늘 수령",
          status: "pending",
          bundleDate: "2026-07-17",
          arrivalStatus: "arrived",
          pickupDate: "07.20 월 18:00",
          pickupDateISO: "2026-07-20",
          pickupHour: 18,
          isPostponed: true,
          userNoShowStacked: false
        });
      }
    }
    if (previousSampleDataVersion < 3) {
      data.userAccount = {
        ...(data.userAccount || defaultData.userAccount),
        noShowStack: 1
      };
    }
    if (previousSampleDataVersion < 6) {
      data.orders.forEach((order) => {
        order.pickupHour = 19;
      });
      const expiredOrderCount = data.orders.filter((order) => order.status === "expired").length;
      data.userAccount = {
        ...(data.userAccount || defaultData.userAccount),
        noShowStack: Math.min(3, expiredOrderCount)
      };
    }
    data.sampleDataVersion = defaultData.sampleDataVersion;

    return data;
  }

  // 데이터 로드
  function loadDB() {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      saveDB(defaultData);
      return defaultData;
    }
    try {
      const normalizedData = normalizeData(JSON.parse(data));
      saveDB(normalizedData);
      return normalizedData;
    } catch (e) {
      saveDB(defaultData);
      return defaultData;
    }
  }

  // 데이터 저장
  function saveDB(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // DB API 정의
  const DB = {
    getData: function () {
      return loadDB();
    },
    resetData: function () {
      saveDB(defaultData);
      return defaultData;
    },
    getProducts: function () {
      return loadDB().products;
    },
    replaceProducts: function (products) {
      if (!Array.isArray(products) || !products.length) return false;
      const data = loadDB();
      data.products = products;
      saveDB(data);
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new CustomEvent("todayFridgeCatalogUpdated", { detail: products }));
      return true;
    },
    updateProduct: function (id, updates) {
      const data = loadDB();
      const idx = data.products.findIndex((p) => p.id === id);
      if (idx !== -1) {
        data.products[idx] = { ...data.products[idx], ...updates };
        saveDB(data);
        // Dispatch event for other pages to update
        window.dispatchEvent(new Event("storage"));
      }
    },
    addProduct: function (product) {
      const data = loadDB();
      data.products.unshift(product);
      saveDB(data);
      window.dispatchEvent(new Event("storage"));
    },
    getOrders: function () {
      return loadDB().orders;
    },
    updateOrder: function (id, updates) {
      const data = loadDB();
      const idx = data.orders.findIndex((o) => o.id === id);
      if (idx !== -1) {
        data.orders[idx] = { ...data.orders[idx], ...updates };
        saveDB(data);
        window.dispatchEvent(new Event("storage"));
      }
    },
    addOrder: function (order) {
      const data = loadDB();
      data.orders.push(order);
      saveDB(data);
      window.dispatchEvent(new Event("storage"));
    },
    getReviews: function () {
      return loadDB().reviews;
    },
    addReview: function (review) {
      const data = loadDB();
      data.reviews.unshift(review);
      saveDB(data);
      window.dispatchEvent(new Event("storage"));
    },
    updateReview: function (id, updates) {
      const data = loadDB();
      const idx = data.reviews.findIndex((r) => r.id === id);
      if (idx !== -1) {
        data.reviews[idx] = { ...data.reviews[idx], ...updates };
        saveDB(data);
        window.dispatchEvent(new Event("storage"));
      }
    },
    getUserAccount: function () {
      return loadDB().userAccount;
    },
    updateUserAccount: function (updates) {
      const data = loadDB();
      data.userAccount = { ...data.userAccount, ...updates };
      saveDB(data);
      window.dispatchEvent(new Event("storage"));
    },
    bindAuthenticatedUser: function (user) {
      if (!user?.id) return false;

      const BOUND_USER_KEY = "todayFridgeBoundUserId";
      const previousUserId = localStorage.getItem(BOUND_USER_KEY);
      const isNewBrowserUser = previousUserId !== String(user.id);
      const data = JSON.parse(JSON.stringify(loadDB()));

      if (isNewBrowserUser) {
        data.orders = [];
        data.userAccount = {
          userId: String(user.id),
          name: user.name || "고객",
          phone: user.phone || "",
          email: user.email || "",
          provider: user.provider === "google" ? "google" : "kakao",
          noShowStack: 0,
          kakaoId: null
        };
        saveDB(data);

        localStorage.setItem("todayFridgeFavorites", "[]");
        localStorage.setItem("todayFridgeNotificationsFeed", "[]");
        localStorage.removeItem("todayFridgeHasVoted");

        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith("todayFridgeInquiries_") || key.startsWith("restock_requested_") || key.startsWith("waitlist_requested_")) {
            localStorage.removeItem(key);
          }
        });
      } else {
        data.userAccount = {
          ...data.userAccount,
          userId: String(user.id),
          name: user.name || data.userAccount?.name || "고객",
          phone: user.phone || data.userAccount?.phone || "",
          email: user.email || data.userAccount?.email || "",
          provider: user.provider === "google" ? "google" : "kakao"
        };
        saveDB(data);
      }

      localStorage.setItem(BOUND_USER_KEY, String(user.id));
      window.dispatchEvent(new Event("storage"));
      return isNewBrowserUser;
    }
  };

  global.FridgeDB = DB;
  if (window.location.protocol.startsWith("http")) {
    fetch(`${window.location.origin}/api/catalog`)
      .then((response) => response.json())
      .then((result) => {
        if (result?.success && Array.isArray(result.data) && result.data.length) {
          DB.replaceProducts(result.data);
        }
      })
      .catch(() => {});
    fetch(`${window.location.origin}/api/reviews`)
      .then((response) => response.json())
      .then((result) => {
        if (!result?.success || !Array.isArray(result.data) || !result.data.length) return;
        const data = loadDB();
        data.reviews = result.data;
        saveDB(data);
        window.dispatchEvent(new Event("storage"));
      })
      .catch(() => {});
    let authToken = localStorage.getItem("todayFridgeAccessToken");
    if (!authToken) {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        try {
          const session = JSON.parse(localStorage.getItem(key));
          authToken = session?.access_token || session?.currentSession?.access_token || null;
        } catch (_) {}
      }
    }
    if (authToken) {
      fetch(`${window.location.origin}/api/orders`, {
        headers: { Authorization: `Bearer ${authToken}` }
      })
        .then((response) => response.json())
        .then((result) => {
          if (!result?.success || !Array.isArray(result.data)) return;
          const data = loadDB();
          data.orders = result.data.map((order) => {
            const item = order.bundle_items || {};
            const product = item.products || {};
            return {
              id: order.id,
              orderNumber: order.order_number,
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
              createdAt: order.created_at
            };
          });
          saveDB(data);
          window.dispatchEvent(new Event("storage"));
        })
        .catch(() => {});
    }
  }
})(window);
