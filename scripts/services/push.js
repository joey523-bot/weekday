import { APP_META, INSTALLATION_KEY } from "../config.js";

const PUSH_PUBLIC_KEY_ENDPOINT = "/api/push/public-key";
const PUSH_REGISTER_ENDPOINT = "/api/push/register";
const PUSH_UNREGISTER_ENDPOINT = "/api/push/unregister";
const PUSH_REMINDERS_ENDPOINT = "/api/push/reminders";

export function supportsPushNotifications() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isStandaloneExperience() {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(window.navigator.standalone);
}

export function getInstallationId() {
  const current = localStorage.getItem(INSTALLATION_KEY);
  if (current) {
    return current;
  }

  const created = crypto.randomUUID();
  localStorage.setItem(INSTALLATION_KEY, created);
  return created;
}

export async function getCurrentPushSubscription() {
  if (!supportsPushNotifications()) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enableSalaryPushNotifications({ day, leadDays, hour, dailyCountdownEnabled = false }) {
  if (!supportsPushNotifications()) {
    throw new Error("当前环境不支持推送通知");
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "通知权限已被拒绝" : "需要先允许通知权限");
  }

  const publicKey = await fetchPublicKey();
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey)
    }));

  await postJson(PUSH_REGISTER_ENDPOINT, {
    installationId: getInstallationId(),
    subscription: subscription.toJSON(),
    salaryDay: day,
    leadDays,
    reminderHour: hour,
    dailyCountdownEnabled,
    permission,
    appName: APP_META.productName
  });

  return {
    permission,
    endpoint: subscription.endpoint
  };
}

export async function syncSalaryPushRule({ day, leadDays, hour, dailyCountdownEnabled = false }) {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) {
    return null;
  }

  await postJson(PUSH_REGISTER_ENDPOINT, {
    installationId: getInstallationId(),
    subscription: subscription.toJSON(),
    salaryDay: day,
    leadDays,
    reminderHour: hour,
    dailyCountdownEnabled,
    permission: Notification.permission,
    appName: APP_META.productName
  });

  return {
    endpoint: subscription.endpoint
  };
}

export async function syncReminderPushRules({ reminders }) {
  await postJson(PUSH_REMINDERS_ENDPOINT, {
    installationId: getInstallationId(),
    reminders: reminders.map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      date: reminder.date,
      category: reminder.category,
      leadDays: reminder.leadDays,
      hour: reminder.hour,
      notificationEnabled: reminder.notificationEnabled,
      completed: reminder.completed,
      repeat: reminder.repeat || null
    }))
  });
}

export async function disableSalaryPushNotifications() {
  const subscription = await getCurrentPushSubscription();
  let remoteError = null;
  try {
    await postJson(PUSH_UNREGISTER_ENDPOINT, {
      installationId: getInstallationId(),
      endpoint: subscription?.endpoint || ""
    });
  } catch (error) {
    remoteError = error;
  }
  if (subscription) await subscription.unsubscribe();
  if (remoteError) throw remoteError;
}

export async function sendLocalTestNotification() {
  if (!supportsPushNotifications()) {
    throw new Error("当前环境不支持推送通知");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "通知权限已被拒绝" : "需要先允许通知权限");
  }

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification("星期提醒已准备好", {
    body: "以后发薪日和重要事项，会在这里轻轻提醒你。",
    icon: "./assets/icons/app-icon-star-192.png",
    badge: "./assets/icons/app-icon-star-192.png",
    tag: "salary-test",
    data: {
      url: "/"
    }
  });

  return {
    permission
  };
}

async function fetchPublicKey() {
  const response = await fetch(PUSH_PUBLIC_KEY_ENDPOINT, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("推送服务还没有配置完成");
  }

  const payload = await response.json();
  if (!payload.publicKey) {
    throw new Error("缺少推送公钥");
  }

  return payload.publicKey;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "请求失败");
  }

  return response.json().catch(() => ({}));
}

function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }

  return output;
}
