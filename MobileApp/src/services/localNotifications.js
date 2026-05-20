import { AppState, Platform } from "react-native";
import Constants from "expo-constants";

const ANDROID_CHANNEL_ID = "ecoloop-routing";

/** In Expo Go, `expo-notifications` triggers native init errors on Android (SDK 53+). Skip loading the module. */
function isExpoGo() {
  return Constants.appOwnership === "expo";
}

let notificationsImportPromise = null;

async function getNotifications() {
  if (isExpoGo()) return null;
  if (!notificationsImportPromise) {
    notificationsImportPromise = import("expo-notifications");
  }
  return notificationsImportPromise;
}

let handlerConfigured = false;

/** Foreground/in-app presentation policy for scheduled notifications (dev / production builds only). */
export function configureNotificationHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  if (isExpoGo()) return;
  void getNotifications().then((Notifications) => {
    if (!Notifications) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
      }),
    });
  });
}

export async function ensureAndroidRoutingChannel() {
  if (Platform.OS !== "android" || isExpoGo()) return;
  const Notifications = await getNotifications();
  if (!Notifications) return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Route assignments",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: "#38A65C",
  });
}

export async function requestExpoNotificationPermissions() {
  if (isExpoGo()) {
    return true;
  }
  const Notifications = await getNotifications();
  if (!Notifications) return false;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  const next = await Notifications.requestPermissionsAsync();
  return Boolean(next.granted || next.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
}

const seenLocalIds = new Set();
const SEEN_CAP = 120;

function rememberSeen(id) {
  if (!id) return;
  if (seenLocalIds.size > SEEN_CAP) seenLocalIds.clear();
  seenLocalIds.add(id);
}

export function wasAlreadyScheduledLocally(id) {
  return Boolean(id && seenLocalIds.has(id));
}

export function markScheduledLocally(id) {
  rememberSeen(id);
}

/**
 * When the app is not in the foreground, show an OS notification for a new row.
 * No-op in Expo Go (use a development build for local + push notifications).
 */
export async function presentLocalNotificationWhenAway({ id, title, body, data }) {
  if (isExpoGo() || !id || wasAlreadyScheduledLocally(id)) return;
  const state = AppState.currentState;
  if (state === "active") return;

  const ok = await requestExpoNotificationPermissions();
  if (!ok) return;

  const Notifications = await getNotifications();
  if (!Notifications) return;

  markScheduledLocally(id);
  await ensureAndroidRoutingChannel();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: title || "EcoLoop",
      body: body || "",
      data: data ?? {},
      ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

export async function setIosBadgeCount(count) {
  if (Platform.OS !== "ios" || isExpoGo()) return;
  try {
    const Notifications = await getNotifications();
    if (!Notifications) return;
    const n = Math.max(0, Math.min(99, Math.floor(Number(count) || 0)));
    await Notifications.setBadgeCountAsync(n);
  } catch {
    /* ignore */
  }
}

/** True when OS-level notifications from this module are unavailable (Expo Go). */
export function areOsNotificationsUnavailableInExpoGo() {
  return isExpoGo();
}
