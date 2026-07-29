(function () {
  document.querySelectorAll(".receipt-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".receipt-tabs button").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
    });
  });
})();
