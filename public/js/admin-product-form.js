(function () {
  const API_BASE = window.location.origin;
  const authGate = document.getElementById("product-form-auth");
  const page = document.getElementById("product-form-page");
  const form = document.getElementById("product-create-form");
  const toast = document.getElementById("form-toast");
  const fileInput = document.getElementById("product-image-files");
  const previewList = document.getElementById("image-preview-list");
  const formTitle = document.getElementById("product-form-title");
  const submitButton = document.getElementById("product-submit-button");
  const editingId = new URLSearchParams(window.location.search).get("id");
  const MAX_IMAGES = 30;
  const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024;
  const fruitPriceRows = document.getElementById("fruit-price-rows");
  let editingProduct = null;
  let imageItems = [];
  let mainImageSrc = "";

  async function loadFruitTypes(selectedId = "") {
    const select = form.elements.fruitTypeId;
    if (!select) return;
    const response = await fetch(`${API_BASE}/api/fruit-types`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "과일 종류를 불러오지 못했습니다.");
    select.innerHTML = `<option value="">과일 종류를 선택해 주세요</option>${(result.data || []).map((item) =>
      `<option value="${item.id}">${String(item.name).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}</option>`
    ).join("")}`;
    if (selectedId) select.value = selectedId;
  }

  function readJSON(value) {
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function accessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const session = readJSON(localStorage.getItem(key));
      if (session?.access_token) return session.access_token;
    }
    return null;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  async function verifyAdmin() {
    const token = accessToken();
    if (!token) {
      window.location.replace("./login.html?next=admin");
      return false;
    }
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok || result.profile?.role !== "admin") {
        window.location.replace("./index.html");
        return false;
      }
      authGate.hidden = true;
      page.setAttribute("aria-hidden", "false");
      return true;
    } catch (_) {
      authGate.innerHTML = "<strong>관리자 서버에 연결하지 못했습니다.</strong><p>백엔드 서버 상태를 확인해 주세요.</p>";
      return false;
    }
  }

  function selectedCategory() {
    return form.elements.category.value;
  }

  function addFruitPriceRow(option = {}) {
    if (!fruitPriceRows) return;
    const row = document.createElement("div");
    row.className = "fruit-price-row";
    const label = document.createElement("input");
    label.name = "fruitPriceLabel";
    label.maxLength = 40;
    label.placeholder = "규격 · 구성 (예: 1팩 · 5과)";
    label.value = String(option.title || option.label || "");
    const price = document.createElement("input");
    price.name = "fruitPriceAmount";
    price.type = "number";
    price.min = "0";
    price.placeholder = "가격";
    price.value = Number(option.price) > 0 ? String(Number(option.price)) : "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "가격 구성 삭제");
    remove.textContent = "×";
    row.append(label, price, remove);
    fruitPriceRows.appendChild(row);
  }

  function fruitPriceOptions() {
    return Array.from(fruitPriceRows?.querySelectorAll(".fruit-price-row") || []).map((row) => ({
      type: "price",
      title: String(row.querySelector('[name="fruitPriceLabel"]')?.value || "").trim(),
      price: Number(row.querySelector('[name="fruitPriceAmount"]')?.value) || 0
    })).filter((option) => option.title || option.price);
  }

  function renderFruitPriceOptions(options = []) {
    if (!fruitPriceRows) return;
    fruitPriceRows.innerHTML = "";
    (options.length ? options : [{}]).forEach(addFruitPriceRow);
  }

  function updateCategoryPanels() {
    const category = selectedCategory();
    const fruitTypeField = document.querySelector("[data-fruit-type-field]");
    const fruitTypeSelect = form.elements.fruitTypeId;
    if (fruitTypeField) fruitTypeField.hidden = category !== "fruit";
    if (fruitTypeSelect) {
      fruitTypeSelect.required = category === "fruit";
      fruitTypeSelect.disabled = category !== "fruit";
    }
    const fruitPriceField = document.querySelector("[data-fruit-price-field]");
    if (fruitPriceField) fruitPriceField.hidden = category !== "fruit";
    document.querySelectorAll("[data-standard-price-field]").forEach((field) => {
      const input = field.querySelector("input");
      field.hidden = category === "fruit";
      if (input) {
        input.disabled = category === "fruit";
        input.required = category !== "fruit" && input.name === "price";
      }
    });
    if (category === "fruit" && fruitPriceRows && !fruitPriceRows.children.length) addFruitPriceRow();
    document.querySelectorAll("[data-category-panel]").forEach((panel) => {
      const active = panel.dataset.categoryPanel === category;
      panel.hidden = !active;
      panel.querySelectorAll("[data-required-for]").forEach((input) => {
        input.required = active && input.dataset.requiredFor === category;
      });
    });
    document.querySelectorAll("[data-stock-field]").forEach((field) => {
      const input = field.querySelector("input");
      const usesStock = category !== "fruit";
      field.hidden = !usesStock;
      if (input) {
        input.required = usesStock;
        input.disabled = !usesStock;
      }
    });
  }

  function renderImageGallery() {
    previewList.innerHTML = "";
    imageItems.forEach((item, index) => {
      const button = document.createElement("div");
      button.className = `image-preview-item${item.src === mainImageSrc ? " is-main" : ""}`;
      button.setAttribute("role", "button");
      button.tabIndex = 0;
      button.innerHTML = `
        <img src="${item.src}" alt="상품 이미지 ${index + 1}" />
        ${item.src === mainImageSrc ? "<b>대표</b>" : ""}
        <button type="button" data-remove-image="${index}" aria-label="이미지 삭제">×</button>
      `;
      button.addEventListener("click", (event) => {
        if (event.target.closest("[data-remove-image]")) return;
        mainImageSrc = item.src;
        renderImageGallery();
      });
      previewList.append(button);
    });
  }

  function syncUrlImages() {
    const fileItems = imageItems.filter((item) => item.kind !== "url");
    const available = Math.max(0, MAX_IMAGES - fileItems.length);
    const urls = [
      form.elements.image.value.trim(),
      ...form.elements.images.value.split(/\r?\n/).map((item) => item.trim())
    ].filter(Boolean).slice(0, available);
    imageItems = [
      ...fileItems,
      ...urls.map((src) => ({ src, kind: "url" }))
    ].filter((item, index, list) => list.findIndex((candidate) => candidate.src === item.src) === index);
    if (!mainImageSrc || !imageItems.some((item) => item.src === mainImageSrc)) {
      mainImageSrc = imageItems[0]?.src || "";
    }
    renderImageGallery();
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const maxSize = 1000;
          const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/webp", .78));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function addSelectedFiles(files) {
    const available = Math.max(0, MAX_IMAGES - imageItems.length);
    const selected = Array.from(files).slice(0, available);
    if (!selected.length) {
      showToast(`상품 이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.`);
      return;
    }
    const oversized = selected.find((file) => Number(file.size) > MAX_SOURCE_IMAGE_BYTES);
    if (oversized) {
      showToast(`"${oversized.name}" 파일이 너무 큽니다. 이미지 한 장은 15MB 이하로 올려 주세요.`);
      return;
    }
    const unsupported = selected.find((file) => !/^image\/(jpeg|png|webp)$/i.test(file.type));
    if (unsupported) {
      showToast("상품 이미지는 JPG, PNG, WEBP 형식만 올릴 수 있습니다.");
      return;
    }
    showToast(files.length > selected.length
      ? `최대 ${MAX_IMAGES}장까지만 추가됩니다.`
      : "이미지를 준비하고 있어요.");
    const compressed = await Promise.all(selected.map(compressImage));
    imageItems.push(...compressed.map((src) => ({ src, kind: "file" })));
    if (!mainImageSrc) mainImageSrc = imageItems[0]?.src || "";
    renderImageGallery();
  }

  async function uploadPendingImages(token) {
    const pending = imageItems.filter((item) => item.kind === "file");
    for (let index = 0; index < pending.length; index += 1) {
      showToast(`이미지 ${index + 1}/${pending.length} 업로드 중`);
      const item = pending[index];
      const previousSrc = item.src;
      const response = await fetch(`${API_BASE}/api/admin/uploads/product-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ dataUrl: item.src })
      });
      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (_) {
        throw new Error(response.status === 413
          ? "이미지 용량이 너무 큽니다. 더 작은 이미지로 다시 시도해 주세요."
          : `이미지 업로드 서버 응답을 확인할 수 없습니다. (${response.status})`);
      }
      if (!response.ok || !result.success) {
        throw new Error(result.error || "상품 이미지를 업로드하지 못했습니다.");
      }
      item.src = result.url;
      item.kind = "stored";
      if (mainImageSrc === previousSrc) mainImageSrc = result.url;
    }
    renderImageGallery();
  }

  function setValue(name, value) {
    const field = form.elements[name];
    if (!field) return;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value ?? "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  async function loadEditingProduct() {
    if (!editingId) return;

    try {
      const token = accessToken();
      if (token) {
        const response = await fetch(`${API_BASE}/api/admin/catalog`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const result = await response.json();
        if (response.ok && result.success) {
          editingProduct = (result.data || []).find((product) => product.id === editingId);
        }
      }
    } catch (_) {}

    if (!editingProduct && window.FridgeDB) {
      editingProduct = window.FridgeDB.getProducts().find((product) => product.id === editingId);
    }

    if (!editingProduct) {
      showToast("수정할 상품을 찾지 못했습니다.");
      setTimeout(() => window.location.replace("./admin.html"), 800);
      return;
    }

    formTitle.textContent = "상품 정보 수정";
    submitButton.textContent = "변경사항 저장";
    const categoryRadio = form.querySelector(`input[name="category"][value="${editingProduct.category}"]`);
    if (categoryRadio) categoryRadio.checked = true;
    setValue("name", editingProduct.name);
    setValue("description", editingProduct.description);
    setValue("productCategory", editingProduct.productCategory || "");
    setValue("fruitTypeId", editingProduct.fruitTypeId || "");
    setValue("price", editingProduct.price);
    setValue("originalPrice", editingProduct.originalPrice);
    setValue("showOriginalPrice", editingProduct.showOriginalPrice);
    setValue("totalStock", editingProduct.totalStock);
    setValue("stock", editingProduct.stock);
    const savedFruitPrices = (editingProduct.detailSpecs || []).filter((spec) => spec?.type === "price" && Number(spec.price) > 0);
    renderFruitPriceOptions(savedFruitPrices.length ? savedFruitPrices : [{ title: "", price: editingProduct.price }]);
    setValue("image", editingProduct.image);
    setValue("images", (editingProduct.images || []).filter((image) => image !== editingProduct.image).join("\n"));
    imageItems = (editingProduct.images?.length ? editingProduct.images : [editingProduct.image])
      .filter(Boolean)
      .map((src) => ({
        src,
        kind: String(src).startsWith("data:image/") ? "file" : "url"
      }));
    mainImageSrc = editingProduct.image || imageItems[0]?.src || "";

    // 마감시간 탐색
    let formattedDate = editingProduct.deadline || "";
    let formattedTime = editingProduct.deadlineTime || "23:59";

    const rawDeadline = editingProduct.order_deadline || editingProduct.orderDeadline;
    if (rawDeadline && (!editingProduct.deadline || !editingProduct.deadlineTime)) {
      const parsed = new Date(rawDeadline);
      if (!isNaN(parsed.getTime())) {
        const kst = new Date(parsed.getTime() + (9 * 60 * 60 * 1000));
        formattedDate = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
        formattedTime = `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
      }
    }

    if (formattedDate && formattedDate !== "상시 판매") {
      setValue("deadline", formattedDate);
    }

    setTimeout(() => {
      const timeInput = form.elements["deadlineTime"];
      if (timeInput) {
        timeInput.value = formattedTime;
        timeInput.setAttribute("value", formattedTime);
        timeInput.dispatchEvent(new Event("input", { bubbles: true }));
        timeInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, 100);

    setValue("pickupDate", editingProduct.pickupDate || editingProduct.default_pickup_date);
    setValue("showDeadlineTime", editingProduct.showDeadlineTime !== false);
    setValue("maxQuantity", editingProduct.maxQuantity || 10);
    setValue("prepaymentOnly", editingProduct.prepaymentOnly === true);
    setValue("barcodeValue", editingProduct.barcodeValue);
    setValue("marketGuide", editingProduct.marketGuide);
    setValue("detailDescription", editingProduct.detailDescription || editingProduct.description);
    setValue("isRecommended", editingProduct.isRecommended === true);
    setValue("isActive", editingProduct.isActive !== false);
    const publishNotificationInput = form.elements.sendPublishNotification;
    if (publishNotificationInput) {
      const canSendPublishNotification =
        editingProduct.category === "bundle" && editingProduct.isActive === false;
      publishNotificationInput.checked = canSendPublishNotification;
      publishNotificationInput.disabled = !canSendPublishNotification;
      const notificationField = publishNotificationInput.closest("[data-publish-notification-field]");
      if (notificationField) notificationField.hidden = !canSendPublishNotification;
    }
    updateCategoryPanels();
    renderImageGallery();
  }

  function buildProduct(isDraft) {
    const data = new FormData(form);
    const category = data.get("category");
    const stock = Number(data.get("stock")) || 0;
    const totalStock = Math.max(Number(data.get("totalStock")) || 0, stock);
    const mainImage = mainImageSrc;
    const extraImages = imageItems.map((item) => item.src).filter((src) => src !== mainImage);
    
    const deadlineDate = data.get("deadline");
    const rawDeadlineTime = data.get("deadlineTime");
    const deadlineTime = category === "bundle" ? (rawDeadlineTime || "23:59") : null;
    const configuredFruitPrices = category === "fruit" ? fruitPriceOptions() : [];
    const primaryPrice = category === "fruit" ? Number(configuredFruitPrices[0]?.price || 0) : Number(data.get("price")) || 0;

    let orderDeadlineIso = null;
    if (category === "bundle" && deadlineDate) {
      orderDeadlineIso = new Date(`${deadlineDate}T${deadlineTime}:00`).toISOString();
    }

    return {
      ...(editingProduct || {}),
      id: editingProduct?.id || `product-${Date.now()}`,
      bundleId: editingProduct?.bundleId,
      bundleItemId: editingProduct?.bundleItemId,
      name: String(data.get("name") || "").trim(),
      category,
      categoryLabel: category === "bundle" ? "공구" : category === "fruit" ? "오늘의 과일" : "매장픽",
      purchaseMode: category === "bundle" ? "reservation" : "store",
      description: String(data.get("description") || "").trim(),
      productCategory: String(data.get("productCategory") || "").trim(),
      fruitTypeId: category === "fruit" ? String(data.get("fruitTypeId") || "") : null,
      detailDescription: String(data.get("detailDescription") || "").trim(),
      price: primaryPrice,
      originalPrice: Number(data.get("originalPrice")) || 0,
      showOriginalPrice: data.get("showOriginalPrice") === "on",
      image: mainImage,
      images: [mainImage, ...extraImages].filter((item, index, list) => list.indexOf(item) === index),
      stock,
      totalStock,
      tags: [],
      deadline: category === "bundle" ? deadlineDate : "상시 판매",
      deadlineTime: deadlineTime,
      deadline_time: deadlineTime,
      showDeadlineTime: category === "bundle" && data.get("showDeadlineTime") === "on",
      order_deadline: orderDeadlineIso,
      orderDeadline: orderDeadlineIso,
      pickupDate: category === "bundle" ? data.get("pickupDate") : null,
      pickup_date: category === "bundle" ? data.get("pickupDate") : null,
      default_pickup_date: category === "bundle" ? data.get("pickupDate") : null,
      maxQuantity: category === "bundle" ? Number(data.get("maxQuantity")) || 10 : null,
      prepaymentOnly: category === "bundle" && data.get("prepaymentOnly") === "on",
      barcodeValue: category === "bundle" ? String(data.get("barcodeValue") || "").trim() : null,
      arrivalStatus: category === "bundle" ? (editingProduct?.arrivalStatus || "scheduled") : null,
      arrivedAt: category === "bundle" ? (editingProduct?.arrivedAt || null) : null,
      detailSpecs: category === "fruit" ? configuredFruitPrices : [],
      marketGuide: category === "market" ? String(data.get("marketGuide") || "").trim() : "",
      salesCount: editingProduct?.salesCount || 0,
      rating: editingProduct?.rating || 0,
      reviewsCount: editingProduct?.reviewsCount || 0,
      isRecommended: data.get("isRecommended") === "on",
      sendPublishNotification:
        category === "bundle" && data.get("sendPublishNotification") === "on",
      isClosed: editingProduct?.isClosed || false,
      isActive: isDraft ? false : data.get("isActive") === "on",
      restockRequests: editingProduct?.restockRequests || 0,
      waitlistRequests: editingProduct?.waitlistRequests || 0,
      createdAt: editingProduct?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  async function saveProduct(isDraft) {
    if (!isDraft && !form.reportValidity()) return;
    if (!isDraft) {
      const data = new FormData(form);
      const configuredFruitPrices = data.get("category") === "fruit" ? fruitPriceOptions() : [];
      const price = data.get("category") === "fruit" ? Number(configuredFruitPrices[0]?.price || 0) : Number(data.get("price")) || 0;
      const originalPrice = Number(data.get("originalPrice")) || 0;
      const stock = Number(data.get("stock")) || 0;
      const totalStock = Number(data.get("totalStock")) || 0;
      if (!imageItems.length || !mainImageSrc) {
        showToast("상품 이미지를 한 장 이상 첨부하고 대표 이미지를 선택해 주세요.");
        return;
      }
      if (originalPrice > 0 && originalPrice < price) {
        showToast("할인 전 가격은 판매가보다 높아야 합니다.");
        return;
      }
      if (data.get("category") === "fruit" && (!configuredFruitPrices.length || configuredFruitPrices.some((option) => !option.title || option.price <= 0))) {
        showToast("오늘의 과일은 규격과 가격을 모두 입력해 주세요.");
        return;
      }
      if (data.get("category") !== "fruit" && stock > totalStock) {
        showToast("현재 재고는 전체 입고 수량보다 많을 수 없습니다.");
        return;
      }
      if (data.get("category") === "bundle") {
        const deadlineDate = data.get("deadline");
        const deadlineTime = data.get("deadlineTime") || "23:59";
        const pickupDate = data.get("pickupDate");

        if (deadlineDate && pickupDate) {
          const deadline = new Date(`${deadlineDate}T${deadlineTime}`);
          const pickup = new Date(`${pickupDate}T23:59`);
          if (deadline > pickup) {
            showToast("수령 가능일은 주문 마감일 이후여야 합니다.");
            return;
          }
        }
      }
    }

    const token = accessToken();
    if (!token) {
      window.location.replace("./login.html?next=admin");
      return;
    }

    const isRemoteProduct = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(editingProduct?.id || "");
    const endpoint = isRemoteProduct
      ? `${API_BASE}/api/admin/products/${editingProduct.id}`
      : `${API_BASE}/api/admin/products`;

    submitButton.disabled = true;

    try {
      await uploadPendingImages(token);
      const product = buildProduct(isDraft);
      const response = await fetch(endpoint, {
        method: isRemoteProduct ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(product)
      });
      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (_) {
        throw new Error(response.status === 413
          ? "상품 정보 용량이 너무 큽니다. 첨부 이미지를 줄인 뒤 다시 시도해 주세요."
          : `상품 저장 서버 응답을 확인할 수 없습니다. (${response.status})`);
      }
      if (!response.ok || !result.success) throw new Error(result.error || "상품을 저장하지 못했습니다.");

      // 💡 백엔드 응답 데이터로 LocalStorage 갱신 (시간 파싱 정보 동기화)
      const savedData = result.data || product;
      if (window.FridgeDB) {
        if (editingProduct) window.FridgeDB.updateProduct(editingProduct.id, savedData);
        else window.FridgeDB.addProduct(savedData);
      }

      localStorage.removeItem("todayFridgeProductDraft");
      const notificationCount = Number(result.publishNotificationCount) || 0;
      const successMessage = isDraft
        ? "임시 저장했습니다."
        : result.warning
          ? result.warning
          : notificationCount > 0
            ? `상품을 등록하고 ${notificationCount}명에게 새 보따리 알림을 보냈습니다.`
            : editingProduct
              ? "상품 정보를 수정했습니다."
              : "상품을 등록했습니다.";
      showToast(successMessage);
      
      if (!isDraft) setTimeout(() => window.location.replace("./admin.html"), result.warning ? 2600 : 1100);

    } catch (error) {
      showToast(error.message || "상품을 저장하지 못했습니다.");
    } finally {
      submitButton.disabled = false;
    }
  }

  document.querySelectorAll('input[name="category"]').forEach((input) => {
    input.addEventListener("change", updateCategoryPanels);
  });
  document.getElementById("add-fruit-type-button")?.addEventListener("click", async () => {
    const name = prompt("추가할 과일 종류 이름을 입력해 주세요.\n예: 샤인머스캣");
    if (!name?.trim()) return;
    const token = accessToken();
    try {
      const response = await fetch(`${API_BASE}/api/admin/fruit-types`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim() })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "과일 종류를 추가하지 못했습니다.");
      await loadFruitTypes(result.data.id);
      showToast(`${result.data.name} 종류를 추가했습니다.`);
    } catch (error) {
      showToast(error.message || "과일 종류를 추가하지 못했습니다.");
    }
  });

  document.getElementById("add-fruit-price-button")?.addEventListener("click", () => addFruitPriceRow());
  fruitPriceRows?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const rows = fruitPriceRows.querySelectorAll(".fruit-price-row");
    if (rows.length <= 1) {
      rows[0]?.querySelectorAll("input").forEach((input) => { input.value = ""; });
      return;
    }
    button.closest(".fruit-price-row")?.remove();
  });
  form.elements.image.addEventListener("input", syncUrlImages);
  form.elements.images.addEventListener("input", syncUrlImages);
  fileInput.addEventListener("change", async () => {
    try {
      await addSelectedFiles(fileInput.files);
      fileInput.value = "";
    } catch (_) {
      showToast("이미지를 불러오지 못했습니다.");
    }
  });
  previewList.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-image]");
    if (!remove) return;
    const index = Number(remove.dataset.removeImage);
    const removed = imageItems[index];
    imageItems.splice(index, 1);
    if (removed?.src === mainImageSrc) mainImageSrc = imageItems[0]?.src || "";
    if (removed?.kind === "url") {
      const urlItems = imageItems.filter((item) => item.kind === "url").map((item) => item.src);
      form.elements.image.value = urlItems[0] || "";
      form.elements.images.value = urlItems.slice(1).join("\n");
    }
    renderImageGallery();
  });
  document.getElementById("save-draft-button").addEventListener("click", () => {
    localStorage.setItem("todayFridgeProductDraft", JSON.stringify(Object.fromEntries(new FormData(form))));
    showToast("작성 중인 내용을 임시저장했습니다.");
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveProduct(false);
  });

  renderFruitPriceOptions();
  updateCategoryPanels();
  verifyAdmin().then(async (allowed) => {
    if (!allowed) return;
    try {
      await loadFruitTypes();
      await loadEditingProduct();
    } catch (error) {
      showToast(error.message || "과일 종류를 불러오지 못했습니다.");
    }
  });
})();
