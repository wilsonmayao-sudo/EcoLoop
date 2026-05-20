import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActionSheetIOS,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Header from "../components/ui/Header";
import TagChip from "../components/ui/TagChip";
import AppButton from "../components/ui/AppButton";
import SurfaceCard from "../components/ui/SurfaceCard";
import PendingPickupsList from "../components/routes/PendingPickupsList";
import { useTheme } from "../context/ThemeContext";
import { useNotifications } from "../context/NotificationContext";
import { usePickups } from "../context/PickupContext";
import { useNavigation } from "@react-navigation/native";
import { useCompletedRoutes } from "../context/CompletedRoutesContext";

function routeNorm(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function DriverRouteControls() {
  const { colors, tokens } = useTheme();
  const { driverRoutes, acceptRoute, startRoute, completeRoute, isLoading } = usePickups();
  const [busy, setBusy] = useState(null);

  const pendingRoutes = useMemo(
    () => driverRoutes.filter((r) => ["pending", "planned"].includes(routeNorm(r.status))),
    [driverRoutes],
  );
  const activeRoutes = useMemo(() => driverRoutes.filter((r) => routeNorm(r.status) === "active"), [driverRoutes]);

  const run = async (actionKey, fn) => {
    setBusy(actionKey);
    try {
      await fn();
    } catch (e) {
      Alert.alert("Could not update route", e?.message ?? "Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || (pendingRoutes.length === 0 && activeRoutes.length === 0)) {
    return null;
  }

  return (
    <SurfaceCard style={styles.routeCard}>
      <View style={styles.routeCardHeader}>
        <Ionicons name="git-network-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1, marginLeft: tokens.space.md }}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Your routes</Text>
          <Text style={[styles.sectionHint, { color: colors.textSecondary, marginTop: tokens.space.xs }]}>
            Pending → Accept → Start when driving → Complete when finished.
          </Text>
        </View>
      </View>
      {pendingRoutes.map((r) => (
        <View key={r.id} style={{ marginTop: tokens.space.lg, gap: tokens.space.sm }}>
          <Text style={[styles.routeBlockTitle, { color: colors.textPrimary }]}>{r.name}</Text>
          <TagChip label="Pending dispatch" color={colors.warning} />
          <AppButton
            title="Accept route"
            icon="checkmark-circle-outline"
            onPress={() => run(`accept-${r.id}`, () => acceptRoute(r.id))}
            disabled={Boolean(busy)}
            loading={busy === `accept-${r.id}`}
          />
        </View>
      ))}
      {activeRoutes.map((r) => (
        <View key={r.id} style={{ marginTop: tokens.space.lg, gap: tokens.space.sm }}>
          <Text style={[styles.routeBlockTitle, { color: colors.textPrimary }]}>{r.name}</Text>
          <TagChip label={r.started_at ? "Active · en route" : "Active"} color={colors.success} />
          {!r.started_at && (
            <AppButton
              title="Start route"
              icon="play-outline"
              variant="primary"
              onPress={() => run(`start-${r.id}`, () => startRoute(r.id))}
              disabled={Boolean(busy)}
              loading={busy === `start-${r.id}`}
            />
          )}
          <AppButton
            title="Complete route"
            icon="flag-outline"
            variant="muted"
            onPress={() => {
              Alert.alert("Complete route", "Mark this route as finished for dispatch?", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Complete",
                  onPress: () => void run(`complete-${r.id}`, () => completeRoute(r.id)),
                },
              ]);
            }}
            disabled={Boolean(busy)}
            loading={busy === `complete-${r.id}`}
          />
        </View>
      ))}
    </SurfaceCard>
  );
}

export default function HomeScreen() {
  const { colors, tokens } = useTheme();
  const { enabled: notificationsEnabled, unreadCount } = useNotifications();
  const navigation = useNavigation();
  const { pendingPickups, completePickup, getTotalPickups, getRemainingPickups, getCompletedPickups, isLoading: pickupsLoading } = usePickups();
  const [justCompletedAll, setJustCompletedAll] = useState(false);
  const routeSessionStartRef = useRef(null);
  const routeNameRef = useRef("Assigned Route");

  useEffect(() => {
    if (pendingPickups.length > 0) {
      if (pendingPickups[0]?.routeName) routeNameRef.current = pendingPickups[0].routeName;
      if (!routeSessionStartRef.current) routeSessionStartRef.current = new Date();
    } else if (!justCompletedAll) {
      routeSessionStartRef.current = null;
    }
  }, [pendingPickups, justCompletedAll]);

  const handleCompletePickup = useCallback(
    (binId) => {
      Alert.alert("Complete pickup", "Mark this stop as completed?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: () => {
            const before = pendingPickups.length;
            completePickup(binId);
            if (before === 1) setJustCompletedAll(true);
          },
        },
      ]);
    },
    [pendingPickups.length, completePickup],
  );

  useEffect(() => {
    if (!justCompletedAll || pendingPickups.length > 0) return;
    setJustCompletedAll(false);
    routeSessionStartRef.current = null;
    Alert.alert("All stops done", "Tap Complete route in Your routes when you have finished the run.");
  }, [justCompletedAll, pendingPickups.length]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={["top"]}>
      <Header
        title="EcoLoop"
        rightIcons={[
          {
            name: notificationsEnabled ? "notifications" : "notifications-outline",
            onPress: () => navigation.getParent()?.navigate("Notifications"),
            active: notificationsEnabled,
            badge:
              notificationsEnabled && unreadCount > 0
                ? unreadCount > 9
                  ? "9+"
                  : String(unreadCount)
                : undefined,
          },
          {
            name: "person-outline",
            onPress: () => navigation.navigate("Profile"),
          },
        ]}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <AssignedRouteOverview onMenuPress={() => handleRouteMenu(navigation)} />
        <View style={styles.spacing} />
        <DriverRouteControls />
        <View style={styles.spacing} />
        <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: tokens.space.xs }]}>Pending stops</Text>
        <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>After you accept an active route, stops appear here.</Text>
        <View style={{ height: tokens.space.md }} />
        {pickupsLoading ? (
          <SurfaceCard elevated={false} style={styles.loadingCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Syncing route from dispatch…</Text>
          </SurfaceCard>
        ) : (
          <PendingPickupsList pendingPickups={pendingPickups} colors={colors} onCompletePickup={handleCompletePickup} />
        )}
        <View style={styles.spacing} />
        <QuickActions />
        <View style={styles.spacing} />
        <RecentActivity />
      </ScrollView>
    </SafeAreaView>
  );
}

function AssignedRouteOverview({ onMenuPress }) {
  const { colors, tokens } = useTheme();
  const { pendingPickups, getTotalPickups, getRemainingPickups, getCompletedPickups, isLoading } = usePickups();

  const totalPickups = getTotalPickups();
  const remainingPickups = getRemainingPickups();
  const completedPickups = getCompletedPickups();

  const routeNames = useMemo(() => {
    const names = [...new Set((pendingPickups ?? []).map((p) => p.routeName).filter(Boolean))];
    return names;
  }, [pendingPickups]);

  const primaryRouteName = routeNames[0] ?? (totalPickups > 0 ? "Assigned route" : "No route assigned");
  const hasActive = totalPickups > 0;
  const progress = totalPickups > 0 ? completedPickups / totalPickups : 0;

  return (
    <SurfaceCard style={styles.heroCard}>
      <View style={styles.cardHeader}>
        <View style={[styles.heroIconWrap, { backgroundColor: colors.primary + "18" }]}>
          <Ionicons name="map" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>Today</Text>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Assigned routes</Text>
          <Text style={[styles.routeNameLine, { color: colors.textPrimary }]} numberOfLines={2}>
            {primaryRouteName}
            {routeNames.length > 1 ? ` · +${routeNames.length - 1} more` : ""}
          </Text>
          <View style={[styles.syncPill, { backgroundColor: colors.surface }]}>
            <Ionicons name={isLoading ? "sync" : "cloud-done-outline"} size={14} color={colors.textSecondary} />
            <Text style={[styles.syncLine, { color: colors.textSecondary }]}>
              {isLoading ? "Refreshing…" : "Synced with dispatch"}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={onMenuPress}
          hitSlop={tokens.hitSlop}
          style={[styles.iconBtn, { backgroundColor: colors.surface }]}
          accessibilityLabel="Route actions"
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {hasActive ? (
        <>
          <View style={[styles.progressBar, { backgroundColor: colors.textSecondary + "28" }]}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.primary }]} />
          </View>
          <Text style={[styles.progressCaption, { color: colors.textSecondary }]}>
            {completedPickups} of {totalPickups} stops completed · {remainingPickups} remaining
          </Text>
        </>
      ) : (
        <Text style={[styles.emptyRouteHint, { color: colors.textSecondary }]}>
          No active route with open stops. Accept a pending route above, or wait for dispatch to assign work.
        </Text>
      )}

      <View style={{ height: tokens.space.lg }} />
      <View style={styles.statsRow}>
        <RouteStat label="Assigned" value={String(totalPickups)} />
        <RouteStat label="Done" value={String(completedPickups)} />
        <RouteStat label="Pending" value={String(remainingPickups)} />
      </View>
    </SurfaceCard>
  );
}

const RouteStat = React.memo(({ label, value }) => {
  const { colors, tokens } = useTheme();

  return (
    <View
      style={[
        styles.statContainer,
        { backgroundColor: colors.surface, borderColor: colors.borderSubtle, borderRadius: tokens.radius.md },
      ]}
    >
      <Text style={[styles.statValue, { color: colors.textPrimary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
});

function QuickActions() {
  const { colors, tokens } = useTheme();
  const navigation = useNavigation();

  return (
    <View>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: tokens.space.sm }]}>Quick actions</Text>
      <SurfaceCard style={styles.quickActionsCard}>
        <AppButton
          title="Open navigation map"
          icon="navigate"
          iconPosition="left"
          onPress={() => navigation.navigate("Map", { startRoute: true })}
        />
        <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
        <AppButton
          title="View map only"
          icon="map-outline"
          variant="outline"
          onPress={() => navigation.navigate("Map", { showRoute: true })}
        />
      </SurfaceCard>
    </View>
  );
}

function RecentActivity() {
  const { colors, tokens } = useTheme();
  const { completedRoutes } = useCompletedRoutes();
  const { items: notifications, loading } = useNotifications();

  const latestRoute = (completedRoutes ?? [])[0];
  const latestNotification = (notifications ?? [])[0];

  return (
    <View>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: tokens.space.sm }]}>Recent activity</Text>
      <SurfaceCard>
        {latestRoute ? (
          <>
            <ActivityTile
              icon="checkmark-circle"
              title={`Route completed: ${latestRoute.name}`}
              subtitle={latestRoute.dateCompleted}
              trailing={<TagChip label={`${latestRoute.binsCollected} stops`} color={colors.pillBlue} />}
            />
            <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
          </>
        ) : null}

        {loading ? (
          <ActivityTile icon="notifications-outline" title="Loading notifications…" subtitle=" " trailing={null} />
        ) : latestNotification ? (
          <ActivityTile
            icon={latestNotification.type === "warning" ? "alert-circle-outline" : "notifications-outline"}
            title={latestNotification.title ?? "Notification"}
            subtitle={latestNotification.message ?? ""}
            trailing={
              <TagChip label={latestNotification.read ? "Read" : "New"} color={latestNotification.read ? colors.pillBlue : colors.success} />
            }
          />
        ) : (
          <ActivityTile
            icon="notifications-outline"
            title="No notifications yet"
            subtitle="Route updates will appear here."
            trailing={null}
          />
        )}
      </SurfaceCard>
    </View>
  );
}

const ActivityTile = React.memo(({ icon, title, subtitle, trailing }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.activityTile}>
      <View style={[styles.activityIcon, { backgroundColor: colors.surface }]}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.activityContent}>
        <Text style={[styles.activityTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.activitySubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      {trailing}
    </View>
  );
});

function handleRouteMenu(navigation) {
  const actions = [
    { label: "Open navigation map", onPress: () => navigation.navigate("Map", { startRoute: true }) },
    { label: "Report an issue", onPress: () => navigation.navigate("Reports", { reportIssue: true }) },
    { label: "Contact dispatch / support", onPress: () => Alert.alert("Contact support", "Reach out to your dispatch office or system administrator for help.") },
    { label: "Route history", onPress: () => navigation.navigate("Reports", { viewHistory: true }) },
    { label: "Cancel", cancel: true },
  ];

  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: actions.map((a) => a.label),
        cancelButtonIndex: actions.findIndex((a) => a.cancel),
      },
      (buttonIndex) => {
        const action = actions[buttonIndex];
        if (action && action.onPress) action.onPress();
      },
    );
  } else {
    const available = actions.filter((a) => !a.cancel);
    Alert.alert(
      "Route actions",
      "Select an option",
      available.map((a) => ({ text: a.label, onPress: a.onPress })),
      { cancelable: true },
    );
  }
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
  spacing: {
    height: 18,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  sectionHint: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  loadingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  heroCard: {},
  routeCard: {},
  quickActionsCard: {
    gap: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    opacity: 0.95,
  },
  routeNameLine: {
    fontSize: 18,
    fontWeight: "800",
    marginTop: 4,
    letterSpacing: -0.3,
  },
  syncPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 8,
  },
  syncLine: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  routeCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  routeBlockTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  emptyRouteHint: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    fontWeight: "500",
  },
  progressBar: {
    height: 8,
    borderRadius: 6,
    overflow: "hidden",
    marginTop: 12,
  },
  progressFill: {
    height: 8,
    borderRadius: 6,
  },
  progressCaption: {
    fontSize: 12,
    marginTop: 8,
    fontWeight: "600",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statContainer: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    textAlign: "center",
    fontWeight: "600",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  activityTile: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  activityIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  activityContent: {
    flex: 1,
    minWidth: 0,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  activitySubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
});
