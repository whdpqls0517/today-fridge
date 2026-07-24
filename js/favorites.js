// Favorite product script.
// Stores favorite product ids in localStorage for the prototype.
// Later, this file can be changed to save favorites in Supabase.
(function () {
  const STORAGE_KEY = "todayFridgeFavorites";

  function loadFavorites() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function saveFavorites(ids) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  function getProductInfo(card) {
    return {
      id: card?.dataset.productId || "",
      name: card?.dataset.productName || card?.querySelector("strong")?.textContent?.trim() || ""
    };
  }

  function setButtonState(button, isFavorite) {
    button.classList.toggle("is-favorite", isFavorite);
    button.textContent = isFavorite ? "\u2665" : "\u2661";
    button.setAttribute("aria-label", isFavorite ? "\ucc1c \ud574\uc81c\ud558\uae30" : "\ucc1c\ud558\uae30");
    button.setAttribute("aria-pressed", String(isFavorite));
  }

  function syncFavoriteButtons() {
    const favorites = loadFavorites();

    document.querySelectorAll("[data-favorite-button]").forEach((button) => {
      const card = button.closest("[data-product-id]");
      const { id } = getProductInfo(card);
      if (!id) return;

      setButtonState(button, favorites.includes(id));
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-favorite-button]");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const card = button.closest("[data-product-id]");
    const { id } = getProductInfo(card);
    if (!id) return;

    const favorites = loadFavorites();
    const isFavorite = favorites.includes(id);
    const nextFavorites = isFavorite
      ? favorites.filter((item) => item !== id)
      : [id, ...favorites];

    saveFavorites(nextFavorites);
    setButtonState(button, !isFavorite);
    window.dispatchEvent(new CustomEvent("favoriteschange"));
  }, true);

  syncFavoriteButtons();
})();
