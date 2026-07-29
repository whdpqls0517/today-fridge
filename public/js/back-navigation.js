(function () {
  function goBack(fallbackHref) {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.href = fallbackHref || "./index.html";
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-back-button]");
    if (!button) return;

    event.preventDefault();
    goBack(button.getAttribute("href"));
  });
})();
