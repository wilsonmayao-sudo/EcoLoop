import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "../components/ui/Header";
import TagChip from "../components/ui/TagChip";
import AppButton from "../components/ui/AppButton";
import SurfaceCard from "../components/ui/SurfaceCard";
import PendingPickupsList from "../components/routes/PendingPickupsList";
import { useTheme } from "../context/ThemeContext";
import { useNotifications } from "../context/NotificationContext";
import { usePickups } from "../context/PickupContext";
import { useAuth } from "../context/AuthContext";
import { useNavigation } from "@react-navigation/native";

function routeNorm(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

function getRouteState(route) {
  const status = routeNorm(route?.status);
  if (!route) return "none";
  if (status === "completed") return "completed";
  if (status === "pending" || status === "planned") return "pending";
  if (status === "active" && route.started_at) return "in_progress";
  if (status === "active") return "accepted";
  return "none";
}

function routeStateLabel(state) {
  if (state === "pending") return "Pending";
  if (state === "accepted") return "Accepted";
  if (state === "in_progress") return "In Progress";
  if (state === "completed") return "Completed";
  return "No Route";
}

function routeStateColor(state, colors) {
  if (state === "pending") return colors.warning;
  if (state === "accepted") return colors.info;
  if (state === "in_progress") return colors.warning;
  if (state === "completed") return colors.success;
  return colors.textSecondary;
}

function formatDateTime(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getPrimaryAction(routeState, colors, isRouteFullyCollected) {
  if (routeState === "pending") return { title: "Accept Route", icon: "checkmark-circle-outline", color: colors.success };
  if (routeState === "accepted") return { title: "Start Navigation", icon: "navigate", color: colors.info };
  if (routeState === "in_progress" && isRouteFullyCollected) return { title: "Complete Route", icon: "flag-outline", color: colors.success };
  if (routeState === "in_progress") return { title: "Continue Navigation", icon: "navigate", color: colors.warning };
  if (routeState === "completed") return { title: "View Route Summary", icon: "document-text-outline", color: colors.actionMuted };
  return null;
}

function pickCurrentRoute(routes) {
  const list = routes ?? [];
  return (
    list.find((route) => routeNorm(route.status) === "active" && route.started_at) ??
    list.find((route) => routeNorm(route.status) === "active") ??
    list.find((route) => ["pending", "planned"].includes(routeNorm(route.status))) ??
    list.find((route) => routeNorm(route.status) === "completed") ??
    null
  );
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const { enabled: notificationsEnabled, unreadCount } = useNotifications();
  const navigation = useNavigation();
  const { driver, profile } = useAuth();
  const {
    pendingPickups,
    assignedPickups,
    completePickup,
    driverRoutes,
    acceptRoute,
    startRoute,
    completeRoute,
    isLoading: pickupsLoading,
  } = usePickups();
  const [busy, setBusy] = useState(false);
  const [justCompletedAll, setJustCompletedAll] = useState(false);

  const currentRoute = useMemo(() => pickCurrentRoute(driverRoutes), [driverRoutes]);
  const routeState = getRouteState(currentRoute);
  const driverName = profile?.full_name ?? driver?.name ?? "Driver";

  const routeAssignedPickups = useMemo(
    () => (assignedPickups ?? []).filter((pickup) => String(pickup.routeId) === String(currentRoute?.id)),
    [assignedPickups, currentRoute?.id],
  );
  const routePendingPickups = useMemo(
    () => (pendingPickups ?? []).filter((pickup) => String(pickup.routeId) === String(currentRoute?.id)),
    [pendingPickups, currentRoute?.id],
  );
  const collectionList = routeAssignedPickups.length ? routeAssignedPickups : routePendingPickups;
  const totalPickups = collectionList.length;
  const completedPickups = collectionList.filter((pickup) => pickup.deliveryStatus === "completed").length;
  const remainingPickups = Math.max(0, totalPickups - completedPickups);
  const completionPercent = totalPickups > 0 ? Math.round((completedPickups / totalPickups) * 100) : 0;
  const isRouteFullyCollected = totalPickups > 0 && remainingPickups === 0;
  const canCompleteCollections = routeState === "accepted" || routeState === "in_progress";
  const primaryAction = getPrimaryAction(routeState, colors, isRouteFullyCollected);

  const handleCompletePickup = useCallback(
    (deliveryId, binId) => {
      if (!canCompleteCollections) {
        Alert.alert("Accept assignment first", "You need to accept this assignment before completing collection stops.");
        return;
      }
      Alert.alert("Complete pickup", "Mark this stop as completed?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: () => {
            const before = routePendingPickups.length;
            completePickup(deliveryId, binId);
            if (before === 1) setJustCompletedAll(true);
          },
        },
      ]);
    },
    [canCompleteCollections, routePendingPickups.length, completePickup],
  );

  useEffect(() => {
    if (!justCompletedAll || routePendingPickups.length > 0) return;
    setJustCompletedAll(false);
    Alert.alert("All stops done", "All collection points for this route are marked completed.");
  }, [justCompletedAll, routePendingPickups.length]);

  const handlePrimaryAction = async () => {
    if (!currentRoute || !primaryAction || busy) return;
    if (routeState === "in_progress" && isRouteFullyCollected) {
      Alert.alert("Complete route", "Mark this route as finished for dispatch?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: async () => {
            setBusy(true);
            try {
              await completeRoute(currentRoute.id);
            } catch (e) {
              Alert.alert("Could not update route", e?.message ?? "Check your connection and try again.");
            } finally {
              setBusy(false);
            }
          },
        },
      ]);
      return;
    }
    setBusy(true);
    try {
      if (routeState === "pending") {
        await acceptRoute(currentRoute.id);
      } else if (routeState === "accepted") {
        await startRoute(currentRoute.id);
        navigation.navigate("Map", { startRoute: true });
      } else if (routeState === "in_progress") {
        navigation.navigate("Map", { startRoute: true });
      } else if (routeState === "completed") {
        navigation.navigate("Reports", { viewHistory: true });
      }
    } catch (e) {
      Alert.alert("Could not update route", e?.message ?? "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

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
        <Text style={[styles.greetingText, { color: colors.textSecondary }]}>
          {getGreeting()}, {driverName}
        </Text>

        <CurrentAssignmentCard
          route={currentRoute}
          routeState={routeState}
          routeStateLabel={routeStateLabel(routeState)}
          areas={buildAreaLabel(currentRoute, collectionList)}
          colors={colors}
        />

        <RouteProgressCard
          totalPickups={totalPickups}
          completedPickups={completedPickups}
          remainingPickups={remainingPickups}
          completionPercent={completionPercent}
          colors={colors}
        />

        {primaryAction ? (
          <AppButton
            title={primaryAction.title}
            icon={primaryAction.icon}
            onPress={handlePrimaryAction}
            disabled={busy || pickupsLoading}
            loading={busy}
            style={[styles.primaryAction, { backgroundColor: primaryAction.color }]}
            textStyle={styles.primaryActionText}
          />
        ) : null}

        <AppButton
          title="Report an Issue"
          icon="alert-circle-outline"
          variant="outlineMuted"
          onPress={() => navigation.navigate("Reports", { reportIssue: true })}
          style={styles.reportButton}
        />

        <View style={styles.sectionHeaderBlock}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Collection list</Text>
          <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>Open each bin/location and tap Complete after collection.</Text>
        </View>
        <View style={styles.sectionToContentGap} />
        {pickupsLoading ? (
          <SurfaceCard elevated={false} style={styles.loadingCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Syncing route from dispatch...</Text>
          </SurfaceCard>
        ) : (
          <PendingPickupsList
            pendingPickups={collectionList}
            colors={colors}
            onCompletePickup={handleCompletePickup}
            canComplete={canCompleteCollections}
          />
        )}

        <View style={styles.spacing} />
      </ScrollView>
    </SafeAreaView>
  );
}

function buildAreaLabel(route, pickups) {
  const routeAreas = route?.areas?.filter(Boolean) ?? [];
  const pickupAreas = [...new Set((pickups ?? []).map((pickup) => pickup.address || pickup.street).filter(Boolean))];
  const areas = routeAreas.length ? routeAreas : pickupAreas;
  if (areas.length === 0) return "Not set";
  return areas.slice(0, 3).join(", ") + (areas.length > 3 ? ` +${areas.length - 3} more` : "");
}

function CurrentAssignmentCard({ route, routeState, routeStateLabel, areas, colors }) {
  const statusColor = routeStateColor(routeState, colors);
  return (
    <SurfaceCard style={styles.assignmentCard}>
      <View style={styles.assignmentHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>Current Assignment</Text>
          <Text style={[styles.routeNameLine, { color: colors.textPrimary }]} numberOfLines={2}>
            {route?.name ?? "No route assigned"}
          </Text>
        </View>
        <TagChip label={routeStateLabel} color={statusColor} backgroundColor={statusColor + "22"} />
      </View>

      <View style={[styles.assignmentMeta, { borderColor: colors.borderSubtle }]}>
        <InfoRow label="Schedule" value={formatDateTime(route?.generated_at ?? route?.assignment_updated_at ?? route?.created_at)} colors={colors} />
        <InfoRow label="Areas" value={areas} colors={colors} />
      </View>
    </SurfaceCard>
  );
}

function RouteProgressCard({ totalPickups, completedPickups, remainingPickups, completionPercent, colors }) {
  return (
    <SurfaceCard style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Route Progress</Text>
        <Text style={[styles.progressPercent, { color: colors.primary }]}>{completionPercent}%</Text>
      </View>
      <View style={[styles.progressBar, { backgroundColor: colors.textSecondary + "1F" }]}>
        <View style={[styles.progressFill, { width: `${completionPercent}%`, backgroundColor: colors.primary }]} />
      </View>
      <View style={styles.statsRow}>
        <RouteStat label="Assigned" value={String(totalPickups)} />
        <RouteStat label="Done" value={String(completedPickups)} />
        <RouteStat label="Remaining" value={String(remainingPickups)} />
      </View>
    </SurfaceCard>
  );
}

function InfoRow({ label, value, colors }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.textPrimary }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
  },
  greetingText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  spacing: {
    height: 20,
  },
  sectionHeaderBlock: {
    gap: 4,
  },
  sectionToContentGap: {
    height: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  sectionHint: {
    fontSize: 13,
    lineHeight: 20,
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
  assignmentCard: {
    paddingTop: 18,
    marginBottom: 16,
  },
  progressCard: {
    paddingTop: 18,
    marginBottom: 16,
  },
  assignmentHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  routeNameLine: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
    lineHeight: 25,
  },
  assignmentMeta: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  infoRow: {
    gap: 4,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  infoValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  progressPercent: {
    fontSize: 18,
    fontWeight: "800",
  },
  progressBar: {
    height: 9,
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 16,
  },
  progressFill: {
    height: 9,
    borderRadius: 999,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  statContainer: {
    flex: 1,
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  statValue: {
    fontSize: 19,
    fontWeight: "800",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    textAlign: "center",
    fontWeight: "600",
  },
  primaryAction: {
    minHeight: 56,
    borderRadius: 16,
    marginBottom: 10,
  },
  primaryActionText: {
    color: "#FFFFFF",
    fontSize: 16,
  },
  reportButton: {
    minHeight: 48,
    marginBottom: 18,
  },
});
