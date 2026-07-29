(() => {
  const backButton = document.querySelector(".policy-back");
  backButton?.addEventListener("click", () => {
    if (document.referrer && new URL(document.referrer).origin === window.location.origin) {
      history.back();
      return;
    }
    window.location.href = "./login.html";
  });
})();
