(function () {
  const API_BASE = window.location.protocol.startsWith("http") ? window.location.origin : "http://localhost:3000";
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
  let editingProduct = null;
  let imageItems = [];
  let mainImageSrc = "";

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
        window.location.replace("./main.html");
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

  function updateCategoryPanels() {
    const category = selectedCategory();
    document.querySelectorAll("[data-category-panel]").forEach((panel) => {
      const active = panel.dataset.categoryPanel === category;
      panel.hidden = !active;
      panel.querySelectorAll("[data-required-for]").forEach((input) => {
        input.required = active && input.dataset.requiredFor === category;
      });
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
    showToast(files.length > selected.length
      ? `최대 ${MAX_IMAGES}장까지만 추가됩니다.`
      : "이미지를 준비하고 있어요.");
    const compressed = await Promise.all(selected.map(compressImage));
    imageItems.push(...compressed.map((src) => ({ src, kind: "file" })));
    if (!mainImageSrc) mainImageSrc = imageItems[0]?.src || "";
    renderImageGallery();
  }

  function buildDetailSpecs(data, category) {
    if (category !== "fruit") return [];
    return [
      { title: "평균 당도", body: data.get("fruitBrix") || "" },
      { title: "산지 원산지", body: data.get("fruitOrigin") || "" },
      { title: "패키지 중량", body: data.get("fruitWeight") || "" },
      { title: "권장 보관", body: data.get("fruitStorage") || "" }
    ].filter((item) => item.body);
  }

  function specValue(product, keyword) {
    return product?.detailSpecs?.find((item) => item.title.includes(keyword))?.body || "";
  }

  function setValue(name, value) {
    const field = form.elements[name];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? "";
  }

  async function loadEditingProduct() {
    if (!editingId) return;
    editingProduct = window.FridgeDB.getProducts().find((product) => product.id === editingId);
    if (!editingProduct) {
      try {
        const response = await fetch(`${API_BASE}/api/admin/catalog`, {
          headers: { Authorization: `Bearer ${accessToken()}` }
        });
        const result = await response.json();
        if (response.ok && result.success) {
          editingProduct = (result.data || []).find((product) => product.id === editingId);
        }
      } catch (_) {}
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
    setValue("price", editingProduct.price);
    setValue("originalPrice", editingProduct.originalPrice);
    setValue("showOriginalPrice", editingProduct.showOriginalPrice);
    setValue("totalStock", editingProduct.totalStock);
    setValue("stock", editingProduct.stock);
    setValue("tags", (editingProduct.tags || []).join(", "));
    setValue("image", editingProduct.image);
    setValue("images", (editingProduct.images || []).filter((image) => image !== editingProduct.image).join("\n"));
    imageItems = (editingProduct.images?.length ? editingProduct.images : [editingProduct.image])
      .filter(Boolean)
      .map((src) => ({ src, kind: "url" }));
    mainImageSrc = editingProduct.image || imageItems[0]?.src || "";
    setValue("deadline", editingProduct.deadline === "상시 판매" ? "" : editingProduct.deadline);
    setValue("deadlineTime", editingProduct.deadlineTime || "23:59");
    setValue("pickupDate", editingProduct.pickupDate);
    setValue("maxQuantity", editingProduct.maxQuantity || 10);
    setValue("prepaymentOnly", editingProduct.prepaymentOnly === true);
    setValue("barcodeValue", editingProduct.barcodeValue);
    setValue("fruitOrigin", specValue(editingProduct, "산지"));
    setValue("fruitBrix", specValue(editingProduct, "당도"));
    setValue("fruitWeight", specValue(editingProduct, "중량"));
    setValue("fruitStorage", specValue(editingProduct, "보관"));
    setValue("marketGuide", editingProduct.marketGuide);
    setValue("detailDescription", editingProduct.detailDescription || editingProduct.description);
    setValue("isRecommended", editingProduct.isRecommended === true);
    setValue("isActive", editingProduct.isActive !== false);
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
    return {
      ...(editingProduct || {}),
      id: editingProduct?.id || `product-${Date.now()}`,
      name: String(data.get("name") || "").trim(),
      category,
      categoryLabel: category === "bundle" ? "공구" : category === "fruit" ? "오늘의 과일" : "매장픽",
      purchaseMode: category === "bundle" ? "reservation" : "store",
      description: String(data.get("description") || "").trim(),
      productCategory: String(data.get("productCategory") || "").trim(),
      detailDescription: String(data.get("detailDescription") || "").trim(),
      price: Number(data.get("price")) || 0,
      originalPrice: Number(data.get("originalPrice")) || 0,
      showOriginalPrice: data.get("showOriginalPrice") === "on",
      image: mainImage,
      images: [mainImage, ...extraImages].filter((item, index, list) => list.indexOf(item) === index),
      stock,
      totalStock,
      tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      deadline: category === "bundle" ? data.get("deadline") : "상시 판매",
      deadlineTime: category === "bundle" ? data.get("deadlineTime") : null,
      pickupDate: category === "bundle" ? data.get("pickupDate") : null,
      maxQuantity: category === "bundle" ? Number(data.get("maxQuantity")) || 10 : null,
      prepaymentOnly: category === "bundle" && data.get("prepaymentOnly") === "on",
      barcodeValue: category === "bundle" ? String(data.get("barcodeValue") || "").trim() : null,
      arrivalStatus: category === "bundle" ? (editingProduct?.arrivalStatus || "scheduled") : null,
      arrivedAt: category === "bundle" ? (editingProduct?.arrivedAt || null) : null,
      detailSpecs: buildDetailSpecs(data, category),
      marketGuide: category === "market" ? String(data.get("marketGuide") || "").trim() : "",
      salesCount: editingProduct?.salesCount || 0,
      rating: editingProduct?.rating || 0,
      reviewsCount: editingProduct?.reviewsCount || 0,
      isRecommended: data.get("isRecommended") === "on",
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
      const price = Number(data.get("price")) || 0;
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
      if (stock > totalStock) {
        showToast("현재 재고는 전체 입고 수량보다 많을 수 없습니다.");
        return;
      }
      if (data.get("category") === "bundle") {
        const deadline = new Date(`${data.get("deadline")}T${data.get("deadlineTime") || "23:59"}`);
        const pickup = new Date(`${data.get("pickupDate")}T23:59`);
        if (deadline > pickup) {
          showToast("수령 가능일은 주문 마감일 이후여야 합니다.");
          return;
        }
      }
    }
    const product = buildProduct(isDraft);
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
      const response = await fetch(endpoint, {
        method: isRemoteProduct ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(product)
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "상품을 저장하지 못했습니다.");
      localStorage.removeItem("todayFridgeProductDraft");
      showToast(isDraft ? "임시 저장했습니다." : editingProduct ? "상품 정보를 수정했습니다." : "상품을 등록했습니다.");
      if (!isDraft) setTimeout(() => window.location.replace("./admin.html"), 650);
    } catch (error) {
      showToast(error.message || "상품을 저장하지 못했습니다.");
    } finally {
      submitButton.disabled = false;
    }
    return;
    if (editingProduct) window.FridgeDB.updateProduct(editingProduct.id, product);
    else window.FridgeDB.addProduct(product);
    localStorage.removeItem("todayFridgeProductDraft");
    showToast(isDraft ? "임시저장했습니다." : editingProduct ? "상품 정보를 수정했습니다." : "상품을 등록했습니다.");
    if (!isDraft) setTimeout(() => window.location.replace("./admin.html"), 650);
  }

  document.querySelectorAll('input[name="category"]').forEach((input) => {
    input.addEventListener("change", updateCategoryPanels);
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

  updateCategoryPanels();
  verifyAdmin().then((allowed) => {
    if (allowed) loadEditingProduct();
  });
})();
