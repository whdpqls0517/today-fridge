(function () {
  document.querySelector("[data-guide-back]")?.addEventListener("click", () => {
    if (document.referrer && new URL(document.referrer).origin === location.origin) {
      history.back();
      return;
    }
    location.href = "./index.html";
  });
})();
