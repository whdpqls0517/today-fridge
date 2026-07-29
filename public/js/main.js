// 메인 화면 전용 스크립트입니다.
// 수령증 슬라이드, 바코드, 수령일 연기는 receipt.js에서만 처리합니다.
(function () {
  const reviewTrack = document.getElementById("home-review-track");
  const reviewTabs = document.getElementById("home-review-tabs");

  const VOTE_KEY = "todayFridgeVotesData";
  const HAS_VOTED_KEY = "todayFridgeHasVoted";

  const defaultVotes = [
    { id: "shine", name: "프리미엄 샤인머스캣 보따리", count: 45 },
    { id: "produce", name: "제철 채소 보따리", count: 32 },
    { id: "egg", name: "신선 계란 보따리", count: 58 }
  ];

  function getDB() {
    return window.FridgeDB || null;
  }

  function accessToken() {
    const direct = localStorage.getItem("todayFridgeAccessToken");
    if (direct) return direct;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const session = JSON.parse(localStorage.getItem(key));
        if (session?.access_token) return session.access_token;
        if (session?.currentSession?.access_token) return session.currentSession.access_token;
      } catch (_) {}
    }
    return null;
  }

  async function syncNotificationBadge() {
    const dot = document.getElementById("notification-unread-dot");
    if (!dot) return;
    const token = accessToken();
    if (token) {
      try {
        const response = await fetch(`${location.origin}/api/notifications`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store"
        });
        const result = await response.json();
        if (response.ok && result.success) {
          const hasUnread = result.data.some((item) => !item.read_at);
          dot.hidden = !hasUnread;
          dot.parentElement?.setAttribute("aria-label", hasUnread ? "읽지 않은 알림 보기" : "알림 보기");
          return;
        }
      } catch (_) {}
    }
    dot.hidden = true;
    dot.parentElement?.setAttribute("aria-label", "알림 보기");
  }

  function getVisibleReviews() {
    const db = getDB();
    if (!db) return [];

    return db.getReviews().filter((review) => review.isVisible);
  }

  function getReviewCategory(review) {
    if (["bundle", "fruit", "market"].includes(review.productCategory)) {
      return review.productCategory;
    }
    const productId = review.productId || "";
    const productName = review.productName || "";

    if (productId.includes("fruit") || productName.includes("과일") || productName.includes("딸기")) {
      return "fruit";
    }

    if (productName.includes("보따리")) {
      return "bundle";
    }

    return "market";
  }

  function getStars(rating) {
    const count = Math.max(0, Math.min(5, Number(rating) || 0));
    return "★".repeat(count) + "☆".repeat(5 - count);
  }

  function renderHomeReviews(category = "all") {
    if (!reviewTrack) return;

    const reviews = getVisibleReviews();
    const filteredReviews = reviews.filter((review) => {
      if (category === "all") return true;
      return getReviewCategory(review) === category;
    });

    reviewTrack.innerHTML = "";

    if (filteredReviews.length === 0) {
      const empty = document.createElement("div");
      empty.className = "review-empty";
      empty.textContent = "아직 보여줄 리뷰가 없어요.";
      reviewTrack.appendChild(empty);
      return;
    }

    filteredReviews.forEach((review) => {
      const card = document.createElement("a");
      card.className = `review-card ${review.photoClass ? "with-photo" : ""}`;
      card.href = `./product-detail.html?id=${encodeURIComponent(review.productId)}`;

      const replyHTML = review.reply
        ? `<div class="owner-reply"><strong>사장님 답글</strong>${review.reply}</div>`
        : "";

      card.innerHTML = `
        <div class="review-head">
          <strong>${getStars(review.rating)} ${review.userName}</strong>
          <span>${review.date}</span>
        </div>
        <div class="review-body">
          <p>${review.comment}</p>
          ${review.photoClass ? `<div class="photo-review ${review.photoClass}"></div>` : ""}
        </div>
        ${replyHTML}
        <span class="product-label">${review.productName}</span>
      `;

      reviewTrack.appendChild(card);
    });
  }

  function setActiveReviewTab(activeButton) {
    reviewTabs?.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button === activeButton);
    });
  }

  function getVotes() {
    const saved = localStorage.getItem(VOTE_KEY);
    if (!saved) return [...defaultVotes];

    try {
      return JSON.parse(saved);
    } catch (error) {
      return [...defaultVotes];
    }
  }

  function localDateISO(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function arrivalTimeLabel(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return "";
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = hour < 12 ? "오전" : "오후";
    const displayHour = hour % 12 || 12;
    return `${period} ${displayHour}시${minute ? ` ${minute}분` : ""} 입고 예정`;
  }

  function renderArrivalStatus() {
    const container = document.getElementById("arrival-status-list");
    if (!container) return;
    const today = localDateISO();
    const products = (getDB()?.getProducts() || []).filter((product) =>
      product.category === "bundle"
      && product.isActive !== false
      && String(product.pickupDate || "").slice(0, 10) === today
    );

    if (!products.length) {
      container.innerHTML = `<div class="arrival-status-empty">오늘 수령 예정인 보따리가 없습니다.<br>새로운 일정은 보따리 목록에서 확인해 주세요.</div>`;
      return;
    }

    container.innerHTML = products.map((product) => {
      const ready = product.arrivalStatus === "arrived";
      const expected = String(product.arrivalExpectedText || "").trim()
        || "입고 예정";
      return `
        <div class="arrival-status-row">
          <div class="arrival-status-product">
            <img src="${product.image}" alt="" />
            <strong>${product.name}</strong>
          </div>
          <span class="arrival-status-value ${ready ? "is-ready" : ""}">${ready ? "수령 가능" : expected}</span>
        </div>`;
    }).join("");
  }

  function saveVotes(votes) {
    localStorage.setItem(VOTE_KEY, JSON.stringify(votes));
  }

  function renderVoteOptions() {
    const container = document.getElementById("vote-options-container");
    if (!container) return;

    const votes = getVotes();
    const hasVoted = localStorage.getItem(HAS_VOTED_KEY) === "true";
    const totalVotes = votes.reduce((total, vote) => total + vote.count, 0);

    container.innerHTML = "";

    votes.forEach((vote) => {
      const percentage = totalVotes > 0 ? Math.round((vote.count / totalVotes) * 100) : 0;
      const card = document.createElement("div");
      card.className = "vote-option-card";

      if (hasVoted) {
        card.innerHTML = `
          <div class="vote-gauge" style="width:${percentage}%"></div>
          <div class="vote-content">
            <span>${vote.name}</span>
            <strong>${vote.count}표 (${percentage}%)</strong>
          </div>
        `;
      } else {
        card.innerHTML = `
          <div class="vote-content">
            <span>${vote.name}</span>
            <button class="vote-btn" type="button" data-id="${vote.id}">투표</button>
          </div>
        `;
      }

      container.appendChild(card);
    });

    if (!hasVoted) {
      container.querySelectorAll(".vote-btn").forEach((button) => {
        button.addEventListener("click", () => {
          const votesList = getVotes();
          const target = votesList.find((vote) => vote.id === button.dataset.id);
          if (!target) return;

          target.count += 1;
          saveVotes(votesList);
          localStorage.setItem(HAS_VOTED_KEY, "true");
          alert("투표가 완료됐어요. 내일 사입 결정에 반영할게요.");
          renderVoteOptions();
        });
      });
    }
  }

  function renderAllReviewsList() {
    const container = document.getElementById("all-reviews-list-container");
    if (!container) return;

    container.innerHTML = "";

    getVisibleReviews().forEach((review) => {
      const card = document.createElement("article");
      card.className = "all-review-card";

      const replyHTML = review.reply
        ? `<div class="owner-reply"><strong>사장님 답글</strong>${review.reply}</div>`
        : "";

      card.innerHTML = `
        <div class="all-review-head">
          <strong>${getStars(review.rating)} ${review.userName}</strong>
          <span>${review.date}</span>
        </div>
        <p>${review.comment}</p>
        <span>${review.productName}</span>
        ${replyHTML}
      `;

      container.appendChild(card);
    });
  }

  window.showAppModal = function (id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");

    if (id === "modal-arrival-status") {
      renderArrivalStatus();
    }

  };

  window.closeAppModal = function (id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  };

  function bindMainButtons() {
    document.getElementById("btn-open-chat")?.addEventListener("click", () => window.showAppModal("modal-chat"));
    document.getElementById("btn-arrival-status")?.addEventListener("click", () => {
      renderArrivalStatus();
      window.showAppModal("modal-arrival-status");
    });
    document.getElementById("btn-guide")?.addEventListener("click", () => {
      window.location.href = "./guide.html";
    });

    document.getElementById("btn-notification")?.addEventListener("click", () => {
      const user = getDB()?.getUserAccount();
      let message = "오늘의 냉장고 알림\\n\\n- 제주 감귤 보따리가 예약되어 있어요. 오늘 오후 7시 전까지 수령해 주세요.";

      if (user?.noShowStack > 0) {
        message += `\\n- 현재 노쇼 ${user.noShowStack}회가 기록되어 있어요.`;
      }

      alert(message);
    });
  }

  function bindReviewTabs() {
    reviewTabs?.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveReviewTab(button);
        renderHomeReviews(button.dataset.reviewCat || "all");
      });
    });
  }

  window.addEventListener("storage", () => {
    renderHomeReviews();
    syncNotificationBadge();
  });
  window.addEventListener("pageshow", syncNotificationBadge);

  bindMainButtons();
  function openChatFromHash() {
    if (location.hash === "#chat") window.showAppModal("modal-chat");
  }
  window.addEventListener("hashchange", openChatFromHash);
  openChatFromHash();
  bindReviewTabs();
  renderHomeReviews();
  syncNotificationBadge();
})();
