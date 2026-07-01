import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Header from "../components/ui/Header";
import SurfaceCard from "../components/ui/SurfaceCard";
import AppButton from "../components/ui/AppButton";
import { useTheme } from "../context/ThemeContext";
import { useNotifications } from "../context/NotificationContext";

function relativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCategory(value) {
  return String(value ?? "system")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getTypeMeta(type, colors) {
  switch (type) {
    case "success":
      return { icon: "checkmark-circle-outline", color: colors.success };
    case "error":
      return { icon: "alert-circle-outline", color: colors.danger };
    case "warning":
      return { icon: "warning-outline", color: colors.warning };
    case "info":
    default:
      return { icon: "information-circle-outline", color: colors.info };
  }
}

export default function NotificationsScreen({ navigation }) {
  const { colors } = useTheme();
  const {
    enabled,
    toggle,
    items,
    unreadCount,
    loading,
    error,
    reload,
    markRead,
    markAllRead,
  } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);

  const readCount = Math.max(0, items.length - unreadCount);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } catch {
      /* context exposes the latest error */
    } finally {
      setRefreshing(false);
    }
  };

  const handleMarkRead = async (notification) => {
    if (!notification || notification.read) return;
    try {
      await markRead(notification.id);
    } catch (err) {
      Alert.alert("Could not update notification", err?.message ?? "Please try again.");
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllRead();
    } catch (err) {
      Alert.alert("Could not update notifications", err?.message ?? "Please try again.");
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={["top"]}>
      <Header
        title="Notifications"
        subtitle="Route alerts & updates"
        rightIcons={[{ name: "close-outline", onPress: () => navigation?.goBack?.() }]}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <SurfaceCard style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View style={[styles.summaryIcon, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="notifications-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.summaryText}>
              <Text style={[styles.summaryTitle, { color: colors.textPrimary }]}>
                {enabled ? `${unreadCount} unread` : `${unreadCount} unread - silent`}
              </Text>
              <Text style={[styles.summarySubtitle, { color: colors.textSecondary }]}>
                {enabled
                  ? `${items.length} total notifications - ${readCount} read`
                  : `${items.length} total notifications - alerts and badges are off.`}
              </Text>
            </View>
          </View>

          {unreadCount > 0 ? (
            <AppButton
              title="Mark all read"
              icon="checkmark-done-outline"
              variant="outline"
              onPress={handleMarkAllRead}
              style={styles.summaryButton}
            />
          ) : null}

          {!enabled ? (
            <AppButton
              title="Turn alerts on"
              icon="notifications-outline"
              onPress={toggle}
              style={styles.summaryButton}
            />
          ) : null}
        </SurfaceCard>

        {error ? (
          <SurfaceCard elevated={false} style={[styles.stateCard, { borderColor: colors.danger + "55" }]}>
            <Ionicons name="alert-circle-outline" size={26} color={colors.danger} />
            <Text style={[styles.stateTitle, { color: colors.textPrimary }]}>Unable to load notifications</Text>
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>{error}</Text>
          </SurfaceCard>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Recent notifications</Text>
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>

        {!loading && items.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="No notifications yet"
            message="Route assignments, updates, and alerts will appear here."
          />
        ) : (
          <SurfaceCard style={styles.list}>
            {items.map((notification, index) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                colors={colors}
                onPress={() => handleMarkRead(notification)}
                showDivider={index < items.length - 1}
              />
            ))}
          </SurfaceCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function NotificationItem({ notification, colors, onPress, showDivider }) {
  const meta = getTypeMeta(notification.type, colors);

  return (
    <>
      <TouchableOpacity activeOpacity={0.84} onPress={onPress} style={styles.notificationItem}>
        <View style={styles.notificationRow}>
          <View style={[styles.notificationIcon, { backgroundColor: meta.color + "18" }]}>
            <Ionicons name={meta.icon} size={20} color={meta.color} />
          </View>

          <View style={styles.notificationBody}>
            <View style={styles.notificationTitleRow}>
              <Text style={[styles.notificationTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {notification.title ?? "Notification"}
              </Text>
              {!notification.read ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
            </View>

            <Text style={[styles.notificationMessage, { color: colors.textSecondary }]} numberOfLines={2}>
              {notification.message ?? ""}
            </Text>

            <View style={styles.notificationMetaRow}>
              <Text style={[styles.categoryText, { color: meta.color }]} numberOfLines={1}>
                {formatCategory(notification.category)}
              </Text>
              <Text style={[styles.metaDot, { color: colors.textSecondary }]}>•</Text>
              <Text style={[styles.timeText, { color: colors.textSecondary }]}>{relativeTime(notification.created_at)}</Text>
              {!notification.read ? (
                <>
                  <Text style={[styles.metaDot, { color: colors.textSecondary }]}>•</Text>
                  <Text style={[styles.newText, { color: colors.success }]}>New</Text>
                </>
              ) : null}
            </View>
          </View>
        </View>
      </TouchableOpacity>
      {showDivider ? <View style={[styles.itemDivider, { backgroundColor: colors.borderSubtle }]} /> : null}
    </>
  );
}

function EmptyState({ icon, title, message }) {
  const { colors } = useTheme();

  return (
    <SurfaceCard elevated={false} style={styles.stateCard}>
      <Ionicons name={icon} size={30} color={colors.textSecondary} />
      <Text style={[styles.stateTitle, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.stateText, { color: colors.textSecondary }]}>{message}</Text>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
  },
  summaryCard: {
    gap: 16,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryText: {
    flex: 1,
    minWidth: 0,
  },
  summaryTitle: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  summarySubtitle: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
    fontWeight: "500",
  },
  summaryButton: {
    marginTop: 2,
  },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 10,
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  list: {
    paddingVertical: 0,
  },
  notificationItem: {
    paddingVertical: 12,
  },
  notificationRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  notificationBody: {
    flex: 1,
    minWidth: 0,
  },
  notificationTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notificationTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  notificationMessage: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
    fontWeight: "500",
  },
  notificationMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  categoryText: {
    maxWidth: "44%",
    fontSize: 11,
    fontWeight: "800",
  },
  timeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  metaDot: {
    fontSize: 11,
    fontWeight: "700",
  },
  newText: {
    fontSize: 11,
    fontWeight: "800",
  },
  itemDivider: {
    height: StyleSheet.hairlineWidth,
  },
  stateCard: {
    marginTop: 12,
    alignItems: "center",
    gap: 8,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  stateText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    fontWeight: "500",
  },
});
