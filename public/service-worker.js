self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch (_) {
    data = { title: "오늘의 냉장고", body: event.data?.text() || "새로운 알림이 도착했습니다." };
  }
  event.waitUntil(self.registration.showNotification(data.title || "오늘의 냉장고", {
    body: data.body || "새로운 알림이 도착했습니다.",
    icon: "/assets/brand/push-icon-192.png",
    data: {
      link: data.link || "./notifications.html",
      notificationId: data.notificationId || null
    },
    tag: data.notificationId || undefined,
    renotify: false
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.link || "./notifications.html", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url === target);
    if (existing) return existing.focus();
    return clients.openWindow(target);
  }));
});
