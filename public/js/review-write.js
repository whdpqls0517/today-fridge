(function () {
  const orderId = new URLSearchParams(location.search).get("orderId");
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

  async function loadOrder() {
    const auth = token();
    form.hidden = true;
    if (!auth) {
      location.replace(`./login.html?next=${encodeURIComponent(`review-write.html?orderId=${orderId || ""}`)}`);
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
        body: JSON.stringify({ orderId: order.id, rating, content: text, photoUrls })
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
  loadOrder();
})();
