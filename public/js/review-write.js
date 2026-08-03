(function () {
  const orderId = new URLSearchParams(location.search).get("orderId");
  const openReviewMode = ["fruit", "general"].includes(new URLSearchParams(location.search).get("type"));
  const initialFruitTypeId = new URLSearchParams(location.search).get("fruitTypeId") || "";
  const form = document.getElementById("review-write-form");
  const card = document.getElementById("review-order-card");
  const content = document.getElementById("review-content");
  const message = document.getElementById("review-write-message");
  const photoInput = document.getElementById("review-photos");
  const photoPreview = document.getElementById("review-photo-preview");
  let rating = 5;
  let selectedPhotos = [];
  let order = null;
  let product = null;
  let fruitTypes = [];
  const fruitPicker = document.getElementById("fruit-type-picker");
  const fruitSelect = document.getElementById("review-fruit-type");

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  function token() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        const accessToken = value?.access_token || value?.currentSession?.access_token;
        if (accessToken) return accessToken;
      } catch (_) {}
    }
    return null;
  }

  function fileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  async function uploadPhoto(file, auth) {
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name}은 5MB를 초과합니다.`);
    const dataUrl = await fileDataUrl(file);
    const response = await fetch(`${location.origin}/api/uploads/review-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth}`
      },
      body: JSON.stringify({ dataUrl })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "사진을 업로드하지 못했습니다.");
    return result.url;
  }

  async function loadTarget() {
    const auth = token();
    form.hidden = true;
    if (!auth) {
      const next = openReviewMode ? "review-write.html?type=general" : `review-write.html?orderId=${orderId || ""}`;
      location.replace(`./login.html?next=${encodeURIComponent(next)}`);
      return;
    }
    if (openReviewMode) {
      message.textContent = "후기 작성 대상을 불러오고 있어요.";
      try {
        const [fruitResponse, catalogResponse] = await Promise.all([
          fetch(`${location.origin}/api/fruit-types`, { cache: "no-store" }),
          fetch(`${location.origin}/api/catalog?category=market`, { cache: "no-store" })
        ]);
        const [fruitResult, catalogResult] = await Promise.all([fruitResponse.json(), catalogResponse.json()]);
        if (!fruitResponse.ok || !fruitResult.success) throw new Error(fruitResult.error || "과일 종류를 불러오지 못했습니다.");
        if (!catalogResponse.ok || !catalogResult.success) throw new Error(catalogResult.error || "매장 상품을 불러오지 못했습니다.");
        fruitTypes = fruitResult.data || [];
        const marketProducts = (catalogResult.data || []).filter((item) => item.category === "market" && item.isActive !== false);
        fruitSelect.innerHTML = `<option value="">상품을 선택해 주세요</option>
          <optgroup label="오늘의 과일">${fruitTypes.map((item) => `<option value="fruit:${item.id}">${escapeHTML(item.name)}</option>`).join("")}</optgroup>
          <optgroup label="매장 상품">${marketProducts.map((item) => `<option value="market:${item.id}">${escapeHTML(item.name)}</option>`).join("")}</optgroup>`;
        fruitSelect.value = initialFruitTypeId ? `fruit:${initialFruitTypeId}` : "";
        fruitPicker.hidden = false;
        card.innerHTML = `<div><strong>후기 작성</strong><span>오늘의 과일 또는 매장에서 구매한 상품을 선택해 주세요. 보따리 후기는 주문내역에서 작성할 수 있습니다.</span></div>`;
        message.textContent = "";
        form.hidden = false;
      } catch (error) {
        message.textContent = error.message || "과일 종류를 불러오지 못했습니다.";
      }
      return;
    }
    message.textContent = "주문 정보를 확인하고 있어요.";
    try {
      const response = await fetch(`${location.origin}/api/orders`, {
        headers: { Authorization: `Bearer ${auth}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "주문 정보를 불러오지 못했습니다.");
      const remoteOrder = (result.data || []).find((item) => String(item.id) === String(orderId));
      if (!remoteOrder || remoteOrder.status !== "completed") {
        throw new Error("후기를 작성할 수 있는 수령 완료 주문이 아닙니다.");
      }
      const remoteProduct = remoteOrder.bundle_items?.products || {};
      order = {
        id: remoteOrder.id,
        orderNumber: remoteOrder.order_number,
        productId: remoteProduct.id,
        productName: remoteProduct.name || "주문 상품",
        status: remoteOrder.status
      };
      product = {
        id: remoteProduct.id,
        image: remoteProduct.images?.[0] || ""
      };
      card.innerHTML = `${product.image ? `<img src="${product.image}" alt="">` : ""}<div><strong>${order.productName}</strong><span>수령 완료 주문 · ${order.orderNumber || order.id}</span></div>`;
      message.textContent = "";
      form.hidden = false;
    } catch (error) {
      message.textContent = error.message || "주문 정보를 불러오지 못했습니다.";
    }
  }

  function renderRating() {
    document.querySelectorAll("[data-rating]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.rating) <= rating);
    });
  }

  document.getElementById("rating-picker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-rating]");
    if (!button) return;
    rating = Number(button.dataset.rating);
    renderRating();
  });

  content.addEventListener("input", () => {
    document.getElementById("review-length").textContent = content.value.length;
  });

  photoInput?.addEventListener("change", () => {
    selectedPhotos.forEach((item) => URL.revokeObjectURL(item.preview));
    selectedPhotos = Array.from(photoInput.files || []).slice(0, 10).map((file) => ({
      file,
      preview: URL.createObjectURL(file)
    }));
    photoPreview.innerHTML = selectedPhotos.map((item) =>
      `<img src="${item.preview}" alt="첨부 사진 미리보기">`
    ).join("");
    if ((photoInput.files?.length || 0) > 10) message.textContent = "사진은 최대 10장까지 등록됩니다.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = content.value.trim();
    const auth = token();
    if (!text || !auth) {
      message.textContent = auth ? "후기 내용을 입력해 주세요." : "로그인 후 후기를 작성해 주세요.";
      return;
    }
    if (openReviewMode && !fruitSelect.value) {
      message.textContent = "후기를 남길 상품을 선택해 주세요.";
      fruitSelect.focus();
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    message.textContent = selectedPhotos.length ? "사진과 후기를 등록하고 있어요." : "후기를 등록하고 있어요.";
    try {
      const photoUrls = [];
      for (const item of selectedPhotos) {
        photoUrls.push(await uploadPhoto(item.file, auth));
      }
      const response = await fetch(`${location.origin}/api/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth}`
        },
        body: JSON.stringify(openReviewMode
          ? (fruitSelect.value.startsWith("fruit:")
            ? { fruitTypeId: fruitSelect.value.slice(6), rating, content: text, photoUrls }
            : { productId: fruitSelect.value.slice(7), rating, content: text, photoUrls })
          : { orderId: order.id, rating, content: text, photoUrls })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "후기를 등록하지 못했습니다.");
      location.replace("./reviews.html");
    } catch (error) {
      message.textContent = error.message || "후기를 등록하지 못했습니다.";
      submit.disabled = false;
    }
  });

  renderRating();
  loadTarget();
})();
