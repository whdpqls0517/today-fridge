(function () {
  let activeFilter = "all";

  function startOfDay(value) {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function parseDate(value) {
    const match = String(value || "").match(/(20\d{2})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function pickupDate(product) {
    const date = parseDate(product.pickupDate || product.expectedPickupDate || product.deadline);
    if (!date) return new Date(8640000000000000);
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    return date;
  }

  function isTodayPickup(product, today) {
    return pickupDate(product).getTime() === today.getTime();
  }

  function isClosedBundle(product, today) {
    return Boolean(
      product.isClosed
      || product.status === "closed"
      || product.status === "finished"
      || window.ProductRules.hasDeadlinePassed(product)
    );
  }

  function renderBundleList() {
    const track = document.getElementById("category-list-track");
    const todayTrack = document.getElementById("bundle-today-track");
    const todaySection = document.getElementById("bundle-today-section");
    if (!track || !todayTrack || !todaySection) return;

    const today = startOfDay(new Date());
    const sortMode = document.getElementById("bundle-sort")?.value || "latest";
    const allBundles = window.FridgeDB.getProducts().filter((product) => product.category === "bundle");
    const todayProducts = allBundles.filter((product) => isTodayPickup(product, today));
    const products = allBundles
      .filter((product) => !isTodayPickup(product, today))
      .filter((product) => {
        if (activeFilter === "ongoing") return !isClosedBundle(product, today);
        if (activeFilter === "closed") return isClosedBundle(product, today);
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "pickup") {
          const aPickup = pickupDate(a);
          const bPickup = pickupDate(b);
          const aUpcoming = aPickup >= today;
          const bUpcoming = bPickup >= today;
          if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
          return aUpcoming ? aPickup - bPickup : bPickup - aPickup;
        }
        const aLatest = parseDate(a.createdAt || a.deadline)?.getTime() || 0;
        const bLatest = parseDate(b.createdAt || b.deadline)?.getTime() || 0;
        return bLatest - aLatest;
      });

    todayTrack.innerHTML = "";
    todaySection.hidden = todayProducts.length === 0;
    todayProducts.forEach((product) => todayTrack.append(window.ProductUI.createProductCard(product)));

    track.innerHTML = "";
    if (!products.length) {
      track.innerHTML = `<div class="product-list-empty"><strong>해당하는 보따리가 없어요</strong><p>다른 필터를 선택해 주세요.</p></div>`;
      return;
    }
    products.forEach((product) => track.append(window.ProductUI.createProductCard(product)));
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-bundle-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.bundleFilter;
        document.querySelectorAll("[data-bundle-filter]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
        renderBundleList();
      });
    });
    document.getElementById("bundle-sort")?.addEventListener("change", renderBundleList);
    renderBundleList();
  });
})();
