const APP_VERSION = "20260810.1";
const CACHE_NAME = `yoyuan-ledger-${APP_VERSION}`;
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/main.css",
  "./styles/tokens.css",
  "./styles/base.css",
  "./styles/layout.css",
  "./styles/components.css",
  "./styles/serene.css",
  "./styles/ios-reminder.css",
  "./styles/xiaoman.css",
  "./styles/themes.css",
  "./scripts/app.js",
  "./scripts/config.js",
  "./scripts/state.js",
  "./scripts/services/calendar.js",
  "./scripts/services/account.js",
  "./scripts/services/push.js",
  "./scripts/services/theme.js",
  "./scripts/services/weather.js",
  "./scripts/utils/date.js",
  "./scripts/utils/format.js",
  "./scripts/views/render.js",
  "./scripts/views/shell.js",
  "./assets/icons/app-icon-star-192.png",
  "./assets/icons/app-icon-star-512.png",
  "./assets/icons/apple-touch-icon-star.png",
  "./assets/themes/twinkle-theme.jpg",
  "./assets/themes/jay-theme.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }
  if (requestUrl.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(networkFirst(event.request));
});

self.addEventListener("push", (event) => {
  const payload = event.data ? safeParse(event.data.text()) : {};
  const title = payload.title || "星期";
  const body = payload.body || "一条新的提醒已经到达。";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "./assets/icons/app-icon-star-192.png",
      badge: "./assets/icons/app-icon-star-192.png",
      tag: payload.tag || "salary-reminder",
      data: {
        url: payload.url || "/"
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((windowClients) => {
      const target = windowClients.find((client) => "focus" in client);
      if (target) {
        return target.focus();
      }

      if (clients.openWindow) {
        return clients.openWindow(event.notification.data?.url || "/");
      }

      return undefined;
    })
  );
});

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response?.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    if (request.mode === "navigate") {
      return caches.match("./index.html");
    }

    throw error;
  }
}
