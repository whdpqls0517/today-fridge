// Receipt modal and interactive components script.
// Handles dynamic rendering of receipts, reviews, and interactive modals.
(function () {
  // 1. DOM Elements
  const receiptLayer = document.querySelector(".receipt-layer");
  const receiptListContainer = document.getElementById("receipt-list");
  const receiptTabDescription = document.getElementById("receipt-tab-description");

  const toast = document.querySelector(".undo-toast");
  const undoButton = toast?.querySelector("button");
  const datePicker = document.querySelector(".date-picker");
  const dateClose = document.querySelector(".date-close");
  const barcodeModal = document.querySelector(".barcode-modal");
  const barcodeClose = document.querySelector(".barcode-close");
  const receiptCloseButtons = receiptLayer?.querySelectorAll(".receipt-close, .layer-backdrop");

  const homeReviewTrack = document.getElementById("home-review-track");
  const homeReviewTabs = document.getElementById("home-review-tabs");

  // 2. State & Constants
  const TEXT = {
    complete: "수령 완료",
    completeToast: "수령 완료 처리됨",
    paymentWaiting: "결제 대기",
    checked: "확인 완료",
    expiredContact: "미수령 만료 건은 매장에 문의해 주세요",
    dateChange: "날짜 변경",
    dateChanged: "수령 예정일이 변경됨"
  };

  let lastCompletedItem = null;
  let dateTargetOrderId = null;
  let toastTimer = null;
  let currentGroupedReceipts = [];
  let receiptOrdersLoading = false;

  const CODE39 = {
    "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw",
    "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn",
    "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn",
    "9": "nnwwnnwnn", "*": "nwnnwnwnn"
  };

  function barcodeSvg(value) {
    const clean = String(value || "").replace(/\D/g, "").slice(0, 24);
    if (!clean) return "";
    const encoded = `*${clean}*`;
    let x = 8;
    const bars = [];
    [...encoded].forEach((character) => {
      [...CODE39[character]].forEach((widthCode, index) => {
        const width = widthCode === "w" ? 5 : 2;
        if (index % 2 === 0) bars.push(`<rect x="${x}" y="4" width="${width}" height="58" rx=".3"/>`);
        x += width;
      });
      x += 2;
    });
    return `<svg viewBox="0 0 ${x + 8} 70" role="img" aria-label="바코드 ${clean}" preserveAspectRatio="none">${bars.join("")}</svg>`;
  }

  function closeReceiptToPreviousPage(event) {
    event.preventDefault();

    const storedReturnUrl = sessionStorage.getItem("todayFridgeReceiptReturnUrl");
    if (storedReturnUrl && !storedReturnUrl.includes("/index.html#receipt")) {
      sessionStorage.removeItem("todayFridgeReceiptReturnUrl");
      window.location.replace(storedReturnUrl);
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.replace("./index.html");
  }

  receiptCloseButtons?.forEach((button) => {
    button.addEventListener("click", closeReceiptToPreviousPage);
  });

  // 3. Dynamic Rendering of Receipts
  let currentReceiptTab = "available"; // 'available' or 'pending'

  function updateReceiptTabDescription() {
    if (!receiptTabDescription) return;
    receiptTabDescription.textContent = currentReceiptTab === "available"
      ? "입고가 완료된 주문을 확인하세요"
      : "입고 예정인 주문을 미리 확인하세요";
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function parseOrderDate(value, fallbackYear = new Date().getFullYear()) {
    if (!value) return null;

    const isoMatch = String(value).match(/(20\d{2})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    }

    const shortMatch = String(value).match(/(\d{1,2})[./-](\d{1,2})/);
    if (!shortMatch) return null;
    return new Date(fallbackYear, Number(shortMatch[1]) - 1, Number(shortMatch[2]));
  }

  function getBundleDate(order, products, today) {
    const product = products.find(item => item.id === order.productId);
    return parseOrderDate(order.bundleDate || order.arrivedAt || product?.deadline, today.getFullYear());
  }

  function getPickupDate(order, today) {
    return parseOrderDate(order.pickupDateISO || order.pickupDate, today.getFullYear());
  }

  function isSameDay(left, right) {
    return Boolean(left && right && left.getTime() === right.getTime());
  }

  function getAvailableOrderPriority(order, products, today) {
    const bundleDate = getBundleDate(order, products, today);
    const pickupDate = getPickupDate(order, today);

    if (isSameDay(bundleDate, today)) return 0;
    if (order.status === "pending" && bundleDate && bundleDate < today && isSameDay(pickupDate, today)) return 1;
    return 2;
  }

  function formatPickupOption(date) {
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const iso = `${date.getFullYear()}-${month}-${day}`;
    return {
      iso,
      shortLabel: `${month}.${day} ${weekdays[date.getDay()]}`,
      pickupLabel: `${month}.${day} ${weekdays[date.getDay()]} 오후 7시 이후`
    };
  }

  function formatPickupDisplay(order, today) {
    const pickupDate = getPickupDate(order, today);
    if (!pickupDate) return "오후 7시 이후";
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    const month = String(pickupDate.getMonth() + 1).padStart(2, "0");
    const day = String(pickupDate.getDate()).padStart(2, "0");
    return `${month}.${day} ${weekdays[pickupDate.getDay()]} · 오후 7시 이후`;
  }

  function renderDateOptions() {
    const container = datePicker?.querySelector(".date-options");
    if (!container) return;

    const today = startOfDay(new Date());
    container.innerHTML = Array.from({ length: 6 }, (_, index) => {
      const optionDate = new Date(today);
      optionDate.setDate(today.getDate() + index + 1);
      const option = formatPickupOption(optionDate);
      return `<button type="button" data-date-label="${option.pickupLabel}" data-date-iso="${option.iso}">${option.shortLabel}</button>`;
    }).join("");
  }

  // 💡 [개선] LocalStorage 보존 상태까지 체크하는 입고 완료 판별 함수
  function checkHasArrived(order, product) {
    return order.arrivalStatus === "arrived" || product?.arrivalStatus === "arrived";
  }

  function receiptAccessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const session = JSON.parse(localStorage.getItem(key));
        if (session?.access_token) return session.access_token;
        if (session?.currentSession?.access_token) return session.currentSession.access_token;
      } catch (_) {}
    }
    return null;
  }

  async function syncReceiptOrders() {
    if (receiptOrdersLoading) return;
    const token = receiptAccessToken();
    if (!token) return;
    receiptOrdersLoading = true;
    try {
      const response = await fetch(`${location.origin}/api/orders`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success || !Array.isArray(result.data)) return;
      const orders = result.data.map((order) => {
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
      window.FridgeDB.replaceOrders(orders);
      renderReceipts();
    } catch (_) {
      // 기존에 동기화된 주문 데이터로 계속 표시합니다.
    } finally {
      receiptOrdersLoading = false;
    }
  }

  function syncMissedOrders(orders, products, today) {
    // 주문 만료와 노쇼 누적은 서버만 변경할 수 있습니다.
    // 수령증 화면은 서버에서 확정된 상태를 표시만 해야 여러 기기에서 같은 결과가 보입니다.
    void orders;
    void products;
    void today;
  }

  function renderReceipts() {
    if (!receiptListContainer) return;

    const today = startOfDay(new Date());
    let orders = window.FridgeDB.getOrders();
    const products = window.FridgeDB.getProducts();

    syncMissedOrders(orders, products, today);
    orders = window.FridgeDB.getOrders();

    const oldestVisibleDate = new Date(today);
    oldestVisibleDate.setDate(oldestVisibleDate.getDate() - 7);

    const filteredOrders = orders
      .filter(order => !["cancelled", "canceled"].includes(String(order.status || "").toLowerCase()))
      .filter(order => String(order.paymentStatus || "").toLowerCase() !== "cancelled")
      .filter(order => !order.cancelledAt)
      .filter(order => {
        const bundleDate = getBundleDate(order, products, today);
        const product = products.find((item) => item.id === order.productId);
        
        // 💡 [수정] LocalStorage 상태를 추가 확인하여 정확한 입고 유무 판단
        const hasArrived = checkHasArrived(order, product);
        const isRecentBundle = bundleDate && bundleDate >= oldestVisibleDate && bundleDate <= today;

        if (currentReceiptTab === "available") {
          return hasArrived && isRecentBundle;
        }
        return !hasArrived || (bundleDate && bundleDate > today);
      })
      .sort((a, b) => {
        const aDate = getBundleDate(a, products, today)?.getTime() || 0;
        const bDate = getBundleDate(b, products, today)?.getTime() || 0;
        if (currentReceiptTab === "available") {
          const priorityGap = getAvailableOrderPriority(a, products, today)
            - getAvailableOrderPriority(b, products, today);
          if (priorityGap !== 0) return priorityGap;

          if (aDate === bDate) {
            const statusOrder = { pending: 0, completed: 1, expired: 2 };
            return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
          }
          return bDate - aDate;
        }
        return aDate - bDate;
      });

    currentGroupedReceipts = filteredOrders.reduce((acc, currentOrder) => {
      const bundleDate = getBundleDate(currentOrder, products, today)?.getTime() || 0;
      const isPendingTransfer = currentOrder.paymentType === "transfer"
        && currentOrder.transferApproved !== true;
      const lifecycleGroup = currentOrder.status === "completed"
        ? "completed"
        : currentOrder.status === "expired"
          ? "expired"
          : "active";
      const groupKey = `${currentOrder.productId}_${bundleDate}_${lifecycleGroup}_${isPendingTransfer ? "payment-pending" : "payable"}`;

      const existing = acc.find(item => item.groupKey === groupKey);

      if (existing) {
        existing.quantity = (Number(existing.quantity) || 1) + (Number(currentOrder.quantity) || 1);
        existing.price = (Number(existing.price) || 0) + (Number(currentOrder.price) || 0);
        existing.groupedOrderIds.push(currentOrder.id);
        if (currentOrder.paymentType === "onsite") {
          existing.paymentType = "onsite";
          existing.barcodeValue = currentOrder.barcodeValue || existing.barcodeValue;
        }
        const statusPriority = { applied: 0, pending: 0, ready: 0, completed: 1, expired: 2 };
        if ((statusPriority[currentOrder.status] ?? 3) < (statusPriority[existing.status] ?? 3)) {
          existing.status = currentOrder.status;
        }
      } else {
        acc.push({
          ...currentOrder,
          groupKey,
          quantity: Number(currentOrder.quantity) || 1,
          price: Number(currentOrder.price) || 0,
          groupedOrderIds: [currentOrder.id]
        });
      }
      return acc;
    }, []);

    receiptListContainer.innerHTML = "";

    if (currentGroupedReceipts.length === 0) {
      receiptListContainer.innerHTML = `
        <div style="text-align:center; padding:50px 20px; color:#666; font-size:15px; line-height:1.6; font-weight:500;">
          <span style="font-size:36px; display:block; margin-bottom:12px;">📦</span>
          해당하는 수령증 카드가 없습니다.<br>
          <span style="color:#1f5f43; font-weight:700;">오늘의 신선 보따리를 예약하고 혜택을 받으세요!</span>
        </div>
      `;
      return;
    }

    currentGroupedReceipts.forEach(order => {
      const isComplete = order.status === "completed";
      const isExpired = order.status === "expired";
      const isAwaitingPayment = order.paymentType === "transfer"
        && order.transferApproved !== true;
      const isAvailableTab = currentReceiptTab === "available";
      const bundleDate = getBundleDate(order, products, today);
      const bundleDateText = bundleDate
        ? `${String(bundleDate.getMonth() + 1).padStart(2, "0")}.${String(bundleDate.getDate()).padStart(2, "0")}`
        : "-";
      const pickupDisplayText = formatPickupDisplay(order, today);
      
      let statusBadgeClass = "status";
      let statusText = "확인 완료";
      if (order.paymentType === "onsite") {
        statusBadgeClass = "status onsite";
        statusText = "결제 대기";
      }
      if (isAwaitingPayment) {
        statusBadgeClass = "status";
        statusText = "입금 확인 대기";
      }
      if (isExpired) {
        statusBadgeClass = "status expired";
        statusText = "미수령";
      }
      if (isComplete) {
        statusText = "수령 완료";
      }

      let guideText = "";
      if (!isAvailableTab) {
        guideText = "입고가 완료되면 수령 가능 탭에서 바코드와 수령 안내를 확인할 수 있어요.";
      } else if (isExpired) {
        guideText = "수령 마감 시간이 지나 직접 연기할 수 없어요.";
      } else if (isAwaitingPayment) {
        guideText = "입금 확인이 완료되면 수령 완료 슬라이드가 활성화됩니다.";
      } else if (order.paymentType === "onsite") {
        guideText = "현장결제 주문은 수령할 때 확인증 바코드로 결제한 뒤 상품을 가져가 주세요.";
      } else {
        guideText = "선입금 주문은 상품을 수령한 뒤 수령 완료 버튼을 밀어 주세요.";
      }

      const itemCard = document.createElement("article");
      itemCard.className = `receipt-item ${order.paymentType === "onsite" ? "pay-kiosk" : "transfer-done"} ${isComplete ? "is-complete" : ""} ${isExpired ? "is-expired" : ""}`;
      itemCard.style.position = "relative";
      itemCard.dataset.orderId = order.id;

      let barcodeHTML = "";
      if (isAvailableTab && !isComplete && !isExpired && order.paymentType === "onsite") {
        const product = products.find((item) => item.id === order.productId);
        const barcodeValue = order.barcodeValue || product?.barcodeValue || "";
        barcodeHTML = `
          <button class="barcode" type="button" data-barcode-value="${barcodeValue}" aria-label="오더퀸 결제용 바코드 크게 보기">
            ${barcodeSvg(barcodeValue)}
          </button>
        `;
      }

      let postponeButtonHTML = "";
      if (isExpired) {
        postponeButtonHTML = `<button class="postpone-button store-contact" type="button">매장 문의</button>`;
      } else if (!isComplete) {
        postponeButtonHTML = `<button class="postpone-button" type="button">수령일 변경</button>`;
      }

      let slideButtonHTML = "";
      if (isAvailableTab && !isComplete && !isExpired && !isAwaitingPayment) {
        const slideText = order.paymentType === "onsite" ? "밀어서 결제 및 수령 완료" : "밀어서 물품 수령 완료";
        slideButtonHTML = `
          <button class="slide-button" type="button" data-complete-label="${order.productName} 총 ${order.quantity}개 수령 완료">
            <span class="slide-thumb" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M7 6l6 6-6 6"/><path d="M12 6l6 6-6 6"/></svg>
            </span>
            <span class="slide-text">${slideText}</span>
          </button>
        `;
      }

      const expiredBarcodeLockHTML = isExpired ? `
        <div class="expired-barcode-lock" role="status" aria-label="바코드 사용 불가">
          <span class="expired-lock-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="5" y="10" width="14" height="10" rx="3"></rect>
              <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"></path>
            </svg>
          </span>
          <div>
            <strong>바코드 사용이 종료됐어요</strong>
            <span>결제 바코드와 수령 완료 기능을 사용할 수 없습니다.</span>
          </div>
        </div>
      ` : "";

      const qtyBadge = `<span style="display:inline-block; margin-left:6px; font-size:13px; color:#1f5f43; background:#e4f3ec; padding:2px 8px; border-radius:12px; font-weight:800;">총 ${Number(order.quantity) || 1}개</span>`;

      itemCard.innerHTML = `
        <header>
          <span class="${statusBadgeClass}">${statusText}</span>
          <strong>${isComplete ? "수령 완료" : (isExpired ? "수령 기간 종료" : (isAwaitingPayment ? "입금 확인 전" : (order.paymentType === 'onsite' ? "현장 결제" : "결제 확인")))}</strong>
        </header>
        <h3>${escapeHTML(order.productName)}${qtyBadge}</h3>
        <div class="pickup-meta ${isExpired ? 'expired' : ''}">
          <div class="pickup-schedule">
            <span class="bundle-date-label">보따리 입고 ${bundleDateText}</span>
            <span class="pickup-time">지정 수령 ${pickupDisplayText}</span>
          </div>
          ${postponeButtonHTML}
        </div>
        <p>${guideText}</p>
        ${barcodeHTML}
        ${expiredBarcodeLockHTML}
        ${slideButtonHTML}
        <div class="receipt-done" style="${isComplete ? 'display:flex;' : 'display:none;'}">✓ 수령 완료</div>
      `;

      receiptListContainer.appendChild(itemCard);
    });

    initSlideButtons();
  }

  function escapeHTML(str) {
    return String(str || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  // 4. Slide Button Interaction Setup
  function initSlideButtons() {
    const slideButtons = receiptListContainer?.querySelectorAll(".slide-button");
    if (!slideButtons) return;

    slideButtons.forEach((button) => {
      const thumb = button.querySelector(".slide-thumb");
      if (!thumb) return;

      let startX = 0;
      let currentX = 0;
      let maxX = 0;
      let dragging = false;

      function resetThumb() {
        currentX = 0;
        thumb.style.transform = "translateX(0)";
        button.style.setProperty("--slide-progress", "0px");
      }

      button.addEventListener("pointerdown", (event) => {
        const item = button.closest(".receipt-item");
        if (item?.classList.contains("is-complete") || item?.classList.contains("is-expired")) return;

        dragging = true;
        startX = event.clientX;
        maxX = button.clientWidth - thumb.clientWidth - 10;
        button.setPointerCapture(event.pointerId);
        button.classList.add("is-dragging");
      });

      button.addEventListener("pointermove", (event) => {
        if (!dragging) return;

        currentX = Math.max(0, Math.min(event.clientX - startX, maxX));
        thumb.style.transform = `translateX(${currentX}px)`;
        button.style.setProperty("--slide-progress", `${currentX}px`);
      });

      button.addEventListener("pointerup", async () => {
        if (!dragging) return;

        dragging = false;
        button.classList.remove("is-dragging");
        if (currentX > maxX * 0.72) {
          thumb.style.transform = `translateX(${maxX}px)`;
          button.style.setProperty("--slide-progress", `${maxX}px`);
          
          const item = button.closest(".receipt-item");
          const orderId = item?.dataset.orderId;
          if (orderId) {
            const targetGroup = currentGroupedReceipts.find(g => g.id === orderId || (g.groupedOrderIds && g.groupedOrderIds.includes(orderId)));
            const idsToUpdate = targetGroup ? targetGroup.groupedOrderIds : [orderId];
            const token = receiptAccessToken();
            button.disabled = true;
            try {
              const completedOrders = [];
              for (const id of idsToUpdate) {
                const response = await fetch(`${location.origin}/api/orders/${encodeURIComponent(id)}/complete`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` }
                });
                const result = await response.json();
                if (!response.ok || !result.success) {
                  throw new Error(result.error || "수령 완료 시간을 기록하지 못했습니다.");
                }
                completedOrders.push(result.data);
              }
              completedOrders.forEach((completedOrder) => {
                window.FridgeDB.updateOrder(completedOrder.id, {
                  status: "completed",
                  receivedAt: completedOrder.received_at
                });
              });
              showToast(button.dataset.completeLabel || TEXT.completeToast, idsToUpdate, true);
              renderReceipts();
            } catch (error) {
              resetThumb();
              button.disabled = false;
              alert(error.message || "수령 완료 시간을 기록하지 못했습니다.");
            }
          }
        } else {
          resetThumb();
        }
      });

      button.addEventListener("pointercancel", () => {
        dragging = false;
        button.classList.remove("is-dragging");
        resetThumb();
      });
    });
  }

  // 5. Toast & Undo
  function showToast(message, orderIds = null, canUndo = false) {
    lastCompletedItem = orderIds;
    const toastText = toast?.querySelector("span");
    if (toastText) toastText.textContent = message;
    if (undoButton) undoButton.hidden = !canUndo;

    toast?.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast?.classList.remove("is-visible");
      lastCompletedItem = null;
    }, 3000);
  }

  undoButton?.addEventListener("click", async () => {
    if (!lastCompletedItem || undoButton.disabled) return;
    const idsToRestore = Array.isArray(lastCompletedItem) ? lastCompletedItem : [lastCompletedItem];
    const token = receiptAccessToken();
    undoButton.disabled = true;
    try {
      const restoredOrders = [];
      for (const id of idsToRestore) {
        const response = await fetch(`${location.origin}/api/orders/${encodeURIComponent(id)}/complete/undo`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        const responseText = await response.text();
        let result = {};
        try {
          result = responseText ? JSON.parse(responseText) : {};
        } catch {
          result = {};
        }
        if (!response.ok || !result.success) {
          const message = response.status === 404
            ? "되돌리기 기능을 사용하려면 백엔드 서버를 다시 실행해 주세요."
            : (result.error || "수령 완료를 되돌리지 못했습니다. 잠시 후 다시 시도해 주세요.");
          throw new Error(message);
        }
        restoredOrders.push(result.data);
      }
      restoredOrders.forEach((order) => {
        window.FridgeDB.updateOrder(order.id, {
          status: order.status,
          receivedAt: order.received_at
        });
      });
      renderReceipts();
      toast?.classList.remove("is-visible");
      clearTimeout(toastTimer);
      lastCompletedItem = null;
    } catch (error) {
      alert(error.message || "수령 완료를 되돌리지 못했습니다.");
    } finally {
      undoButton.disabled = false;
    }
  });

  // 6. Tab switching inside receipt sheet
  receiptLayer?.querySelectorAll("[data-receipt-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      currentReceiptTab = tab.dataset.receiptTab;
      receiptLayer.querySelectorAll("[data-receipt-tab]").forEach((button) => {
        button.classList.toggle("active", button === tab);
      });
      updateReceiptTabDescription();
      renderReceipts();
    });
  });

  // 7. Postpone Picker Logic
  function closeDatePicker() {
    datePicker?.classList.remove("is-visible");
    datePicker?.setAttribute("aria-hidden", "true");
    dateTargetOrderId = null;
  }

  document.addEventListener("click", (e) => {
    const postponeBtn = e.target.closest(".postpone-button");
    if (postponeBtn) {
      const item = postponeBtn.closest(".receipt-item");
      const orderId = item?.dataset.orderId;
      if (!orderId) return;

      if (postponeBtn.classList.contains("store-contact")) {
        showToast(TEXT.expiredContact);
        return;
      }

      dateTargetOrderId = orderId;
      renderDateOptions();
      datePicker?.classList.add("is-visible");
      datePicker?.setAttribute("aria-hidden", "false");
    }
  });

  dateClose?.addEventListener("click", closeDatePicker);

  datePicker?.addEventListener("click", (event) => {
    if (event.target === datePicker) closeDatePicker();
  });

  datePicker?.addEventListener("click", (event) => {
    const dateButton = event.target.closest("[data-date-label]");
    if (!dateButton || !dateTargetOrderId) return;

    const targetGroup = currentGroupedReceipts.find(g => g.id === dateTargetOrderId || (g.groupedOrderIds && g.groupedOrderIds.includes(dateTargetOrderId)));
    const idsToUpdate = targetGroup ? targetGroup.groupedOrderIds : [dateTargetOrderId];

    idsToUpdate.forEach(id => {
      window.FridgeDB.updateOrder(id, {
        pickupDate: dateButton.dataset.dateLabel,
        pickupDateISO: dateButton.dataset.dateIso,
        pickupHour: 19,
        isPostponed: true
      });
    });

    showToast(TEXT.dateChanged);
    closeDatePicker();
    renderReceipts();
  });

  // 8. Barcode modal zoom
  function closeBarcodeModal() {
    barcodeModal?.classList.remove("is-visible");
    barcodeModal?.setAttribute("aria-hidden", "true");
  }

  document.addEventListener("click", (e) => {
    const barcodeBtn = e.target.closest(".barcode");
    if (barcodeBtn) {
      const value = barcodeBtn.dataset.barcodeValue || "";
      const largeBarcode = barcodeModal?.querySelector(".barcode-large");
      const barcodeNumber = barcodeModal?.querySelector(".barcode-number");
      if (largeBarcode) largeBarcode.innerHTML = barcodeSvg(value);
      if (barcodeNumber) barcodeNumber.textContent = value;
      barcodeModal?.classList.add("is-visible");
      barcodeModal?.setAttribute("aria-hidden", "false");
    }
  });

  barcodeClose?.addEventListener("click", closeBarcodeModal);

  barcodeModal?.addEventListener("click", (event) => {
    if (event.target === barcodeModal) closeBarcodeModal();
  });

  // 9. Home Screen Reviews Carousel Rendering
  function renderHomeReviews(category = "all") {
    if (!homeReviewTrack) return;

    const reviews = window.FridgeDB.getReviews().filter(r => r.isVisible);
    
    const filteredReviews = reviews.filter(r => {
      if (category === "all") return true;
      if (category === "bundle") return r.productName.includes("보따리");
      if (category === "fruit") return r.productName.includes("과일") || r.productName.includes("딸기") || r.productName.includes("귤");
      if (category === "market") return !r.productName.includes("보따리") && !r.productName.includes("과일");
      return true;
    });

    homeReviewTrack.innerHTML = "";

    if (filteredReviews.length === 0) {
      homeReviewTrack.innerHTML = `
        <div style="padding:20px; text-align:center; color:#888; font-size:13px; width:100%;">
          해당 분야 리뷰가 아직 없습니다.
        </div>
      `;
      return;
    }

    filteredReviews.forEach(r => {
      const card = document.createElement("a");
      card.className = `review-card ${r.photoClass ? 'with-photo' : ''}`;
      card.href = `./product-detail.html?id=${encodeURIComponent(r.productId)}`;
      
      let stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
      
      let bodyHTML = `
        <div class="review-body">
          <p>${r.comment}</p>
          ${r.photoClass ? `<div class="photo-review ${r.photoClass}"></div>` : ''}
        </div>
      `;

      let replyHTML = "";
      if (r.reply) {
        replyHTML = `
          <div style="margin-top:10px; padding:8px 10px; background:#f4f9f6; border-radius:10px; font-size:11px; border-left:3px solid #1f5f43; color:#222;">
            <strong style="color:#1f5f43; display:block; margin-bottom:2px;">🏪 사장님 답글</strong>
            ${r.reply}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="review-head">
          <strong>${stars} ${r.userName}</strong>
          <span>${r.date}</span>
        </div>
        ${bodyHTML}
        ${replyHTML}
        <span class="product-label">${r.productName}</span>
      `;
      homeReviewTrack.appendChild(card);
    });
  }

  homeReviewTabs?.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      homeReviewTabs.querySelectorAll("button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderHomeReviews(btn.dataset.reviewCat);
    });
  });

  // 10. Interactive App Modals Control
  window.showAppModal = function (id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");

    if (id === "modal-vote") {
      renderVoteOptions();
    } else if (id === "modal-reviews") {
      renderAllReviewsList();
    }
  };

  window.closeAppModal = function (id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
    }
  };

  document.getElementById("btn-open-chat")?.addEventListener("click", () => showAppModal("modal-chat"));
  document.getElementById("btn-vote")?.addEventListener("click", () => showAppModal("modal-vote"));
  document.getElementById("btn-guide")?.addEventListener("click", () => {
    window.location.href = "./guide.html";
  });
  document.getElementById("btn-all-reviews")?.addEventListener("click", () => showAppModal("modal-reviews"));

  // 11. Vote Modal Logic
  const VOTE_KEY = "todayFridgeVotesData";
  const defaultVotes = [
    { id: "shine", name: "🍇 프리미엄 샤인머스캣 보따리", count: 45 },
    { id: "potato", name: "🎃 단호박 & 고구마 구황작물 보따리", count: 32 },
    { id: "egg", name: "🥚 무항생제 신선 달걀 & 두부 보따리", count: 58 }
  ];

  function getVotes() {
    const saved = localStorage.getItem(VOTE_KEY);
    if (!saved) return defaultVotes;
    return JSON.parse(saved);
  }

  function saveVotes(votes) {
    localStorage.setItem(VOTE_KEY, JSON.stringify(votes));
  }

  function renderVoteOptions() {
    const container = document.getElementById("vote-options-container");
    if (!container) return;

    const votes = getVotes();
    const hasVoted = localStorage.getItem("todayFridgeHasVoted") === "true";
    const totalVotes = votes.reduce((acc, curr) => acc + curr.count, 0);

    container.innerHTML = "";

    votes.forEach(opt => {
      const percentage = totalVotes > 0 ? Math.round((opt.count / totalVotes) * 100) : 0;
      
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #eef1f3; border-radius:12px; padding:12px; background:#fff; display:flex; flex-direction:column; gap:8px; position:relative; overflow:hidden;";

      if (hasVoted) {
        card.innerHTML = `
          <div style="position:absolute; left:0; top:0; bottom:0; width:${percentage}%; background:#e4f3ec; z-index:0; transition:width 0.5s ease;"></div>
          <div style="position:relative; z-index:1; display:flex; justify-content:space-between; font-weight:800; font-size:13px;">
            <span>${opt.name}</span>
            <span style="color:#1f5f43;">${opt.count}표 (${percentage}%)</span>
          </div>
        `;
      } else {
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:700; font-size:13px;">${opt.name}</span>
            <button class="vote-btn" data-id="${opt.id}" style="background:#1f5f43; color:#fff; padding:6px 12px; border-radius:8px; font-size:11px; font-weight:800;">투표</button>
          </div>
        `;
      }
      container.appendChild(card);
    });

    if (!hasVoted) {
      container.querySelectorAll(".vote-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const optId = btn.dataset.id;
          const votesList = getVotes();
          const targetOpt = votesList.find(v => v.id === optId);
          if (targetOpt) {
            targetOpt.count += 1;
            saveVotes(votesList);
            localStorage.setItem("todayFridgeHasVoted", "true");
            alert("투표가 완료되었습니다! 내일 아침 사입 결정에 반영됩니다.");
            renderVoteOptions();
          }
        });
      });
    }
  }

  // 12. Render All Reviews List Modal
  function renderAllReviewsList() {
    const container = document.getElementById("all-reviews-list-container");
    if (!container) return;

    const reviews = window.FridgeDB.getReviews().filter(r => r.isVisible);
    container.innerHTML = "";

    reviews.forEach(r => {
      const card = document.createElement("article");
      card.style.cssText = "border: 1px solid #eef1f3; border-radius: 12px; padding: 14px; background: #fff;";

      let stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
      let replyHTML = "";
      if (r.reply) {
        replyHTML = `
          <div style="margin-top:10px; padding:8px 10px; background:#f4f9f6; border-radius:10px; font-size:11px; border-left:3px solid #1f5f43; color:#222;">
            <strong style="color:#1f5f43; display:block; margin-bottom:2px;">🏪 사장님 답글</strong>
            ${r.reply}
          </div>
        `;
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="color:#4f8f64; font-size:14px;">${stars} ${r.userName}</strong>
          <span style="color:#9299a1; font-size:11px;">${r.date}</span>
        </div>
        <p style="margin:0 0 8px 0; font-size:13px; line-height:1.45; color:#333;">${r.comment}</p>
        <span style="font-size:11px; color:#1f5f43; background:#e4f3ec; padding:4px 8px; border-radius:99px; font-weight:800;">${r.productName}</span>
        ${replyHTML}
      `;
      container.appendChild(card);
    });
  }

  window.addEventListener("storage", () => {
    renderReceipts();
    renderHomeReviews();
  });
  window.addEventListener("pageshow", syncReceiptOrders);
  window.addEventListener("hashchange", () => {
    if (location.hash === "#receipt") syncReceiptOrders();
  });

  renderReceipts();
  syncReceiptOrders();
  renderHomeReviews();
})();
