(function () {
  const favoriteIds = new Set();
  let loaded = false;

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

  function getProductInfo(card) {
    return {
      id: card?.dataset.productId || "",
      name: card?.dataset.productName || card?.querySelector("strong")?.textContent?.trim() || ""
    };
  }

  function setButtonState(button, favorite) {
    button.classList.toggle("is-favorite", favorite);
    button.textContent = favorite ? "\u2665" : "\u2661";
    button.setAttribute("aria-label", favorite ? "찜 해제하기" : "찜하기");
    button.setAttribute("aria-pressed", String(favorite));
  }

  function syncFavoriteButtons() {
    document.querySelectorAll("[data-favorite-button]").forEach((button) => {
      const { id } = getProductInfo(button.closest("[data-product-id]"));
      if (id) setButtonState(button, favoriteIds.has(id));
    });
  }

  async function load() {
    const token = accessToken();
    favoriteIds.clear();
    if (!token) {
      loaded = true;
      syncFavoriteButtons();
      window.dispatchEvent(new CustomEvent("favoriteschange"));
      return [];
    }
    try {
      const response = await fetch(`${location.origin}/api/favorites`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "찜 목록을 불러오지 못했습니다.");
      (result.data || []).forEach((id) => favoriteIds.add(id));
      loaded = true;
      syncFavoriteButtons();
      window.dispatchEvent(new CustomEvent("favoriteschange"));
      return [...favoriteIds];
    } catch (error) {
      loaded = true;
      console.error("찜 목록 불러오기 실패:", error);
      syncFavoriteButtons();
      return [];
    }
  }

  async function toggle(productId) {
    const token = accessToken();
    if (!token) {
      location.href = `./login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      return null;
    }
    const wasFavorite = favoriteIds.has(productId);
    const response = await fetch(`${location.origin}/api/favorites/${encodeURIComponent(productId)}`, {
      method: wasFavorite ? "DELETE" : "PUT",
      headers: { Authorization: `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "찜 상태를 변경하지 못했습니다.");
    if (wasFavorite) favoriteIds.delete(productId);
    else favoriteIds.add(productId);
    syncFavoriteButtons();
    window.dispatchEvent(new CustomEvent("favoriteschange"));
    return !wasFavorite;
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-favorite-button]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const { id } = getProductInfo(button.closest("[data-product-id]"));
    if (!id || button.disabled) return;
    button.disabled = true;
    try {
      await toggle(id);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }, true);

  window.Favorites = {
    load,
    toggle,
    has: (id) => favoriteIds.has(id),
    ids: () => [...favoriteIds],
    isLoaded: () => loaded
  };

  load();
})();
