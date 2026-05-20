import React, { useMemo, useState } from "react";
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
import TagChip from "../components/ui/TagChip";
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
  const { colors, tokens } = useTheme();
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
  const dynamicStyles = useMemo(() => getDynamicStyles(colors, tokens), [colors, tokens]);

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
                {enabled ? `${unreadCount} unread` : "Notifications off"}
              </Text>
              <Text style={[styles.summarySubtitle, { color: colors.textSecondary }]}>
                {enabled
                  ? `${items.length} total notifications - ${readCount} read`
                  : "Turn notifications on to receive route alerts and updates."}
              </Text>
            </View>
          </View>

          {enabled && unreadCount > 0 ? (
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
              title="Turn notifications on"
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

        {!enabled ? (
          <EmptyState
            icon="notifications-off-outline"
            title="Notifications are disabled"
            message="Enable notifications to see route updates and alerts here."
          />
        ) : !loading && items.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="No notifications yet"
            message="Route assignments, updates, and alerts will appear here."
          />
        ) : (
          <View style={styles.list}>
            {items.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                colors={colors}
                dynamicStyles={dynamicStyles}
                onPress={() => handleMarkRead(notification)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function NotificationItem({ notification, colors, dynamicStyles, onPress }) {
  const meta = getTypeMeta(notification.type, colors);

  return (
    <TouchableOpacity activeOpacity={0.84} onPress={onPress}>
      <SurfaceCard
        elevated={!notification.read}
        style={[
          styles.notificationCard,
          {
            borderColor: notification.read ? colors.borderSubtle : meta.color + "55",
          },
        ]}
      >
        <View style={styles.notificationRow}>
          <View style={[styles.notificationIcon, { backgroundColor: meta.color + "18" }]}>
            <Ionicons name={meta.icon} size={22} color={meta.color} />
          </View>

          <View style={styles.notificationBody}>
            <View style={styles.notificationTitleRow}>
              <Text style={[dynamicStyles.notificationTitle, { color: colors.textPrimary }]} numberOfLines={2}>
                {notification.title ?? "Notification"}
              </Text>
              {!notification.read ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
            </View>

            <Text style={[styles.notificationMessage, { color: colors.textSecondary }]} numberOfLines={3}>
              {notification.message ?? ""}
            </Text>

            <View style={styles.notificationMetaRow}>
              <TagChip label={formatCategory(notification.category)} color={meta.color} />
              <TagChip
                label={notification.read ? "Read" : "New"}
                color={notification.read ? colors.pillBlue : colors.success}
              />
              <View style={styles.timeRow}>
                <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                <Text style={[styles.timeText, { color: colors.textSecondary }]}>{relativeTime(notification.created_at)}</Text>
              </View>
            </View>
          </View>
        </View>
      </SurfaceCard>
    </TouchableOpacity>
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

function getDynamicStyles(colors, tokens) {
  return StyleSheet.create({
    notificationTitle: {
      color: colors.textPrimary,
      flex: 1,
      fontSize: tokens.font.title,
      fontWeight: "800",
      letterSpacing: -0.2,
      lineHeight: 21,
    },
  });
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
    gap: 12,
  },
  notificationCard: {
    borderWidth: 1,
  },
  notificationRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  notificationIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  notificationBody: {
    flex: 1,
    minWidth: 0,
  },
  notificationTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 6,
  },
  notificationMessage: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
    fontWeight: "500",
  },
  notificationMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timeText: {
    fontSize: 12,
    fontWeight: "600",
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
