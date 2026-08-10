(function () {
  const API_BASE = window.location.origin;
  const authGate = document.getElementById("bulk-auth");
  const page = document.getElementById("bulk-page");
  const form = document.getElementById("bulk-fruit-form");
  const list = document.getElementById("fruit-entry-list");
  const addButton = document.getElementById("add-fruit-entry");
  const submitButton = document.getElementById("bulk-submit");
  const countText = document.getElementById("bulk-count");
  const activeInput = document.getElementById("bulk-active");
  const toast = document.getElementById("bulk-toast");
  const MAX_IMAGES = 30;
  const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
  let fruitTypes = [];
  let sequence = 0;

  function readJSON(value) { try { return JSON.parse(value); } catch (_) { return null; } }
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

  function showToast(message, duration = 2400) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character]));
  }

  function fruitTypeOptions() {
    return `<option value="">과일 종류를 선택해 주세요</option>${fruitTypes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
  }

  function updateCount() {
    const count = list.querySelectorAll(".fruit-entry").length;
    countText.textContent = `${count}개 상품`;
    list.querySelectorAll(".fruit-entry").forEach((entry, index) => {
      entry.querySelector("h2").textContent = `과일 ${index + 1}`;
      entry.querySelector(".entry-remove").hidden = count === 1;
    });
  }

  function addEntry() {
    sequence += 1;
    const entry = document.createElement("section");
    entry.className = "fruit-entry";
    entry.dataset.entryId = String(sequence);
    entry.innerHTML = `
      <div class="entry-head"><h2>과일</h2><button class="entry-remove" type="button">이 항목 삭제</button></div>
      <div class="entry-grid">
        <label class="wide image-field"><span>상품 이미지 * <small>첫 사진이 대표 이미지로 등록됩니다.</small></span><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required /><span class="entry-preview"></span></label>
        <label class="wide"><span>상품명 *</span><input name="name" maxlength="60" required placeholder="예: 천도복숭아" /></label>
        <label><span>과일 후기 연결 *</span><select name="fruitTypeId" required>${fruitTypeOptions()}</select></label>
        <label><span>판매가</span><input name="price" type="number" min="0" placeholder="예: 8500" /></label>
        <label class="wide"><span>가격 구성 <small>선택 입력</small></span><textarea name="priceOptions" rows="2" placeholder="1팩 · 5과 | 8,500원&#10;1팩 · 4과 | 10,900원"></textarea><small class="price-help">판매가 하나만 입력하거나, 규격별 가격이 여러 개면 한 줄에 하나씩 ‘규격 | 가격’으로 입력하세요.</small></label>
        <label class="wide"><span>한줄 소개 *</span><textarea name="description" rows="2" maxlength="120" required placeholder="상품 특징을 최대 두 줄로 적어 주세요."></textarea></label>
        <label class="wide"><span>상세 설명 *</span><textarea name="detailDescription" rows="4" required placeholder="산지, 구성, 보관 방법 등을 적어 주세요."></textarea></label>
        <label><span>추천 노출</span><select name="isRecommended"><option value="false">일반 상품</option><option value="true">추천 상품</option></select></label>
      </div>`;
    entry.querySelector(".entry-remove").addEventListener("click", () => { entry.remove(); updateCount(); });
    entry.querySelector('[name="images"]').addEventListener("change", (event) => renderPreviews(entry, event.target.files));
    list.appendChild(entry);
    updateCount();
  }

  function renderPreviews(entry, files) {
    const preview = entry.querySelector(".entry-preview");
    preview.innerHTML = "";
    Array.from(files || []).slice(0, MAX_IMAGES).forEach((file) => {
      const image = document.createElement("img");
      image.alt = "선택한 과일 사진";
      image.src = URL.createObjectURL(file);
      image.onload = () => URL.revokeObjectURL(image.src);
      preview.appendChild(image);
    });
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/webp", .9));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadFiles(files, token, productIndex) {
    const selected = Array.from(files || []).slice(0, MAX_IMAGES);
    if (!selected.length) throw new Error(`${productIndex}번째 과일의 이미지를 선택해 주세요.`);
    if (selected.some((file) => file.size > MAX_SOURCE_BYTES)) throw new Error("이미지 한 장의 용량은 15MB 이하여야 합니다.");
    if (selected.some((file) => !/^image\/(jpeg|png|webp)$/i.test(file.type))) throw new Error("JPG, PNG, WEBP 이미지만 등록할 수 있습니다.");
    const urls = [];
    for (let index = 0; index < selected.length; index += 1) {
      showToast(`${productIndex}번째 과일 이미지 ${index + 1}/${selected.length} 업로드 중`, 10000);
      const dataUrl = await compressImage(selected[index]);
      const response = await fetch(`${API_BASE}/api/admin/uploads/product-image`, {
        method: "POST",
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${token}` },
        body: JSON.stringify({ dataUrl })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "이미지 업로드에 실패했습니다.");
      urls.push(result.url);
    }
    return urls;
  }

  function parsePriceOptions(value, productIndex) {
    return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [title, rawPrice] = line.split("|").map((part) => part.trim());
      const price = Number(String(rawPrice || "").replace(/[^0-9]/g, ""));
      if (!title || price <= 0) throw new Error(`${productIndex}번째 과일의 가격 구성은 ‘규격 | 가격’ 형식으로 입력해 주세요.`);
      return { type: "price", title, price };
    });
  }

  async function verifyAdmin() {
    const token = accessToken();
    if (!token) return window.location.replace("./login.html?next=admin");
    const response = await fetch(`${API_BASE}/api/auth/me`, { headers:{ Authorization:`Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok || result.profile?.role !== "admin") return window.location.replace("./index.html");
    const typesResponse = await fetch(`${API_BASE}/api/fruit-types`, { cache:"no-store" });
    const typesResult = await typesResponse.json();
    if (!typesResponse.ok || !typesResult.success) throw new Error(typesResult.error || "과일 종류를 불러오지 못했습니다.");
    fruitTypes = typesResult.data || [];
    authGate.hidden = true;
    page.hidden = false;
    addEntry();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const token = accessToken();
    if (!token) return window.location.replace("./login.html?next=admin");
    const entries = Array.from(list.querySelectorAll(".fruit-entry"));
    submitButton.disabled = true;
    let completed = 0;
    try {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const value = (name) => entry.querySelector(`[name="${name}"]`)?.value || "";
        const number = index + 1;
        const priceOptions = parsePriceOptions(value("priceOptions"), number);
        const enteredPrice = Number(value("price")) || 0;
        const price = enteredPrice || Number(priceOptions[0]?.price || 0);
        if (price <= 0) throw new Error(`${number}번째 과일의 판매가 또는 가격 구성을 입력해 주세요.`);
        const images = await uploadFiles(entry.querySelector('[name="images"]').files, token, number);
        showToast(`${number}/${entries.length} 상품 저장 중`, 10000);
        const payload = {
          name:String(value("name")).trim(), category:"fruit", categoryLabel:"오늘의 과일",
          productCategory:"fruit", fruitTypeId:value("fruitTypeId"), description:String(value("description")).trim(),
          detailDescription:String(value("detailDescription")).trim(), price, originalPrice:0, showOriginalPrice:false,
          images, image:images[0], detailSpecs:priceOptions, stock:0, totalStock:1, isRecommended:value("isRecommended") === "true",
          isActive:activeInput.checked, tags:[]
        };
        const response = await fetch(`${API_BASE}/api/admin/products`, {
          method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` }, body:JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || `${number}번째 상품 저장에 실패했습니다.`);
        completed += 1;
      }
      showToast(`${completed}개 과일을 모두 등록했습니다.`, 3000);
      setTimeout(() => window.location.replace("./admin.html"), 1200);
    } catch (error) {
      showToast(completed ? `${completed}개 저장 후 중단됨: ${error.message}` : error.message, 5000);
    } finally {
      submitButton.disabled = false;
    }
  });

  addButton.addEventListener("click", addEntry);
  verifyAdmin().catch((error) => { authGate.innerHTML = `<strong>화면을 열지 못했습니다.</strong><p>${escapeHtml(error.message)}</p>`; });
})();
