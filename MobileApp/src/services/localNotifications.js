import { AppState, Platform } from "react-native";
import { isRunningInExpoGo } from "expo";
import Constants, { ExecutionEnvironment } from "expo-constants";

const ANDROID_CHANNEL_ID = "ecoloop-routing";

/** In Expo Go, `expo-notifications` triggers native init errors on Android (SDK 53+). Skip loading the module. */
export function isExpoGo() {
  try {
    if (typeof isRunningInExpoGo === "function" && isRunningInExpoGo()) {
      return true;
    }
  } catch {
    /* fallback to Constants */
  }
  return (
    Constants.appOwnership === "expo" ||
    Constants.executionEnvironment === "storeClient" ||
    Constants.executionEnvironment === ExecutionEnvironment?.StoreClient ||
    Boolean(Constants.expoVersion)
  );
}

let notificationsImportPromise = null;

async function getNotifications() {
  if (isExpoGo()) return null;
  if (!notificationsImportPromise) {
    notificationsImportPromise = import("expo-notifications").catch((error) => {
      console.warn("Failed to import expo-notifications:", error?.message || error);
      return null;
    });
  }
  return notificationsImportPromise;
}

let handlerConfigured = false;

/** Foreground/in-app presentation policy for scheduled notifications (dev / production builds only). */
export function configureNotificationHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  if (isExpoGo()) return;
  void getNotifications()
    .then((Notifications) => {
      if (!Notifications || typeof Notifications.setNotificationHandler !== "function") return;
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: false,
          shouldSetBadge: true,
        }),
      });
    })
    .catch((error) => {
      console.warn("Unable to configure notification handler:", error?.message || error);
    });
}

export async function ensureAndroidRoutingChannel() {
  if (Platform.OS !== "android" || isExpoGo()) return;
  try {
    const Notifications = await getNotifications();
    if (!Notifications || typeof Notifications.setNotificationChannelAsync !== "function") return;
    const importance = Notifications.AndroidImportance?.DEFAULT ?? 5;
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Route assignments",
      importance,
      lightColor: "#38A65C",
    });
  } catch (error) {
    console.warn("Unable to configure Android notification channel:", error?.message || error);
  }
}

export async function requestExpoNotificationPermissions() {
  if (isExpoGo()) {
    return true;
  }
  try {
    const Notifications = await getNotifications();
    if (!Notifications || typeof Notifications.getPermissionsAsync !== "function") return false;
    const existing = await Notifications.getPermissionsAsync();
    if (existing?.granted || existing?.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL) {
      return true;
    }
    const next = await Notifications.requestPermissionsAsync();
    return Boolean(next?.granted || next?.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL);
  } catch (error) {
    console.warn("Unable to request notification permissions:", error?.message || error);
    return false;
  }
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

  try {
    const ok = await requestExpoNotificationPermissions();
    if (!ok) return;

    const Notifications = await getNotifications();
    if (!Notifications || typeof Notifications.scheduleNotificationAsync !== "function") return;

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
  } catch (error) {
    console.warn("Unable to present local notification:", error?.message || error);
  }
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
