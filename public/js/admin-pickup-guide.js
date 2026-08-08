(function () {
  const form = document.getElementById('pickup-guide-form');
  if (!form) return;

  const dateInput = document.getElementById('pickup-guide-date');
  const titleInput = document.getElementById('pickup-guide-title');
  const contentInput = document.getElementById('pickup-guide-content');
  const fileInput = document.getElementById('pickup-guide-image-input');
  const imageList = document.getElementById('pickup-guide-image-list');
  const imageCount = document.getElementById('pickup-guide-image-count');
  const status = document.getElementById('pickup-guide-status');
  const deleteButton = document.getElementById('pickup-guide-delete');
  let images = [];
  let savedGuide = null;
  let loadedDate = '';
  let isDirty = false;
  let isLoading = false;

  function token() {
    return window.FridgeAuth?.getAccessToken?.() || localStorage.getItem('todayFridgeAccessToken') || '';
  }

  function today() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  function setStatus(message, tone = '') {
    status.textContent = message || '';
    status.dataset.tone = tone;
  }

  function renderImages() {
    imageCount.textContent = `${images.length} / 10`;
    imageList.innerHTML = images.map((item, index) => `
      <figure class="pickup-guide-image-item">
        <img src="${item.preview || item.url}" alt="수령 안내 사진 ${index + 1}" />
        <button type="button" data-remove-guide-image="${index}" aria-label="사진 삭제">×</button>
      </figure>`).join('');
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function loadGuide(force = false) {
    if (!dateInput.value) return;
    if (isLoading) return;
    if (!force && (isDirty || loadedDate === dateInput.value)) return;
    isLoading = true;
    fileInput.disabled = true;
    setStatus('저장된 안내를 불러오고 있어요.');
    try {
      const response = await fetch(`/api/admin/pickup-guides/${dateInput.value}`, {
        headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '수령 안내를 불러오지 못했습니다.');
      savedGuide = result.data;
      titleInput.value = savedGuide?.title || '보따리 7시 이후 수령 안내';
      contentInput.value = savedGuide?.content || '';
      images = (savedGuide?.image_urls || []).map((url) => ({ url }));
      loadedDate = dateInput.value;
      isDirty = false;
      deleteButton.hidden = !savedGuide;
      renderImages();
      setStatus(savedGuide ? '저장된 안내를 불러왔습니다.' : '이 날짜에 저장된 안내가 없습니다. 새로 작성해 주세요.');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      isLoading = false;
      fileInput.disabled = false;
    }
  }

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    if (images.length + files.length > 10) {
      setStatus('사진은 최대 10장까지 등록할 수 있습니다.', 'error');
      fileInput.value = '';
      return;
    }
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        setStatus(`${file.name}은 5MB를 초과합니다.`, 'error');
        continue;
      }
      images.push({ dataUrl: await readAsDataUrl(file), preview: URL.createObjectURL(file) });
    }
    isDirty = true;
    fileInput.value = '';
    renderImages();
  });

  imageList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-guide-image]');
    if (!button) return;
    const [removed] = images.splice(Number(button.dataset.removeGuideImage), 1);
    if (removed?.preview) URL.revokeObjectURL(removed.preview);
    isDirty = true;
    renderImages();
  });

  async function uploadPendingImages() {
    const uploaded = [];
    for (const image of images) {
      if (image.url) { uploaded.push(image.url); continue; }
      const response = await fetch('/api/admin/uploads/pickup-guide-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ dataUrl: image.dataUrl })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '사진을 업로드하지 못했습니다.');
      uploaded.push(result.url);
    }
    return uploaded;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    setStatus('사진과 안내를 저장하고 있어요.');
    try {
      const imageUrls = await uploadPendingImages();
      const response = await fetch(`/api/admin/pickup-guides/${dateInput.value}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ title: titleInput.value, content: contentInput.value, imageUrls })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '수령 안내를 저장하지 못했습니다.');
      savedGuide = result.data;
      images = imageUrls.map((url) => ({ url }));
      loadedDate = dateInput.value;
      isDirty = false;
      deleteButton.hidden = false;
      renderImages();
      setStatus(result.warning ? `저장됨 · ${result.warning}` : '수령 안내를 저장했습니다.', result.warning ? '' : 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!savedGuide || !confirm(`${dateInput.value} 수령 안내를 삭제할까요? 사진도 더 이상 사용되지 않으면 저장소에서 함께 삭제됩니다.`)) return;
    deleteButton.disabled = true;
    try {
      const response = await fetch(`/api/admin/pickup-guides/${dateInput.value}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token()}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '수령 안내를 삭제하지 못했습니다.');
      savedGuide = null;
      images = [];
      loadedDate = dateInput.value;
      isDirty = false;
      titleInput.value = '보따리 7시 이후 수령 안내';
      contentInput.value = '';
      deleteButton.hidden = true;
      renderImages();
      setStatus('수령 안내와 사용하지 않는 사진을 삭제했습니다.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      deleteButton.disabled = false;
    }
  });

  titleInput.addEventListener('input', () => { isDirty = true; });
  contentInput.addEventListener('input', () => { isDirty = true; });
  dateInput.addEventListener('change', () => {
    loadedDate = '';
    isDirty = false;
    loadGuide(true);
  });
  dateInput.value = today();
  window.loadPickupGuideAdmin = loadGuide;
  renderImages();
})();
