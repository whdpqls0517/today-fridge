(function () {
  function createLayer() {
    let layer = document.getElementById("receipt-frame-layer");
    if (layer) return layer;

    layer = document.createElement("div");
    layer.id = "receipt-frame-layer";
    layer.className = "receipt-frame-layer";
    layer.hidden = true;
    layer.innerHTML = `<iframe title="수령 확인증" src="about:blank"></iframe>`;
    document.body.append(layer);
    return layer;
  }

  function openReceipt(event) {
    const link = event.target.closest('a[href*="main.html#receipt"]');
    if (!link || document.querySelector(".receipt-layer")) return;
    event.preventDefault();
    sessionStorage.setItem("todayFridgeReceiptReturnUrl", window.location.href);

    const layer = createLayer();
    const frame = layer.querySelector("iframe");
    layer.hidden = false;
    document.body.style.overflow = "hidden";

    frame.onload = function () {
      try {
        const doc = frame.contentDocument;
        const style = doc.createElement("style");
        style.textContent = `
          html, body { background: transparent !important; }
          body > .phone-shell, body > .bottom-nav { visibility: hidden !important; }
          .receipt-layer { background: rgba(14, 23, 19, .48) !important; }
        `;
        doc.head.append(style);

        const close = () => {
          layer.hidden = true;
          frame.src = "about:blank";
          document.body.style.overflow = "";
        };
        doc.querySelectorAll(".receipt-close, .layer-backdrop").forEach((button) => {
          button.addEventListener("click", (closeEvent) => {
            closeEvent.preventDefault();
            close();
          }, { once: true });
        });
      } catch (_) {
        // 같은 로컬 서버에서 열리므로 일반적으로 이 경로에 진입하지 않습니다.
      }
    };

    frame.src = "./main.html#receipt";
  }

  window.openReceiptOverlay = function () {
    openReceipt({
      target: {
        closest(selector) {
          return selector.includes("main.html#receipt") ? document.createElement("a") : null;
        }
      },
      preventDefault() {}
    });
  };

  document.addEventListener("click", openReceipt);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const layer = document.getElementById("receipt-frame-layer");
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    layer.querySelector("iframe").src = "about:blank";
    document.body.style.overflow = "";
  });
})();
