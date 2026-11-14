import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "../components/ui/Header";
import TagChip from "../components/ui/TagChip";
import AppButton from "../components/ui/AppButton";
import SurfaceCard from "../components/ui/SurfaceCard";
import PendingPickupsList from "../components/routes/PendingPickupsList";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { useNotifications } from "../context/NotificationContext";
import { usePickups } from "../context/PickupContext";
import { useAuth } from "../context/AuthContext";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { SWMO_LANDFILL } from "../utils/navigationRoute";
import {
  evaluateMultiCriteriaReassignment,
  SWMO_LANDFILL_DISPOSAL_SITE,
} from "../utils/dynamicReassignment";
import {
  SCHEDULE_DAY_CODES,
  doesScheduleMatchDay,
  extractNormalizedScheduleDays,
  extractRouteScheduleDays,
  formatCollectionAreaDisplay,
} from "../utils/areaDisplay";
import {
  insertNotificationWithFallback,
  insertOverflowEventWithFallback,
  isMissingRpcError,
  normalizeNonEmptyId,
  selectCandidateVehiclesWithFallback,
  updateDeliveriesStatusWithFallback,
  updateDriverStatusWithFallback,
  updateVehicleWithFallback,
} from "../utils/schemaFallback";

function routeNorm(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function getGreeting(t) {
  const hour = new Date().getHours();
  if (hour < 12) return t ? t("greeting_morning", "Good Morning") : "Good Morning";
  if (hour < 18) return t ? t("greeting_afternoon", "Good Afternoon") : "Good Afternoon";
  return t ? t("greeting_evening", "Good Evening") : "Good Evening";
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

function routeStateLabel(state, t) {
  if (state === "pending") return t ? t("status_pending", "Pending") : "Pending";
  if (state === "accepted") return t ? t("status_accepted", "Accepted") : "Accepted";
  if (state === "in_progress") return t ? t("status_in_progress", "In Progress") : "In Progress";
  if (state === "completed") return t ? t("status_completed", "Completed") : "Completed";
  return t ? t("status_no_route", "No Route") : "No Route";
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

function getPrimaryAction(routeState, colors, isRouteFullyCollected, t) {
  if (routeState === "pending") return { title: t ? t("action_accept_route", "Accept Route") : "Accept Route", icon: "checkmark-circle-outline", color: colors.success };
  if (routeState === "accepted") return { title: t ? t("action_start_route", "Start Route") : "Start Navigation", icon: "navigate", color: colors.info };
  if (routeState === "in_progress" && isRouteFullyCollected) return { title: t ? t("action_go_to_landfill", "Proceed to SWMO Landfill to Unload") : "Complete Route", icon: "flag-outline", color: colors.success };
  if (routeState === "in_progress") return { title: t ? t("action_continue_nav", "Continue Navigation") : "Continue Navigation", icon: "navigate", color: colors.warning };
  if (routeState === "completed") return { title: t ? t("view_route_summary", "View Route Summary") : "View Route Summary", icon: "document-text-outline", color: colors.actionMuted };
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
  const { t } = useLanguage();
  const { enabled: notificationsEnabled, unreadCount } = useNotifications();
  const navigation = useNavigation();
  const { driver, profile } = useAuth();
  const {
    pendingPickups,
    assignedPickups,
    assignedScheduleStops,
    isUnloadingAtLandfill,
    startLandfillUnload,
    completeLandfillUnload,
    completePickup,
    driverRoutes,
    acceptRoute,
    startRoute,
    completeRoute,
    isLoading: pickupsLoading,
    reloadPickups,
  } = usePickups();
  const [busy, setBusy] = useState(false);
  const [showScheduleGuide, setShowScheduleGuide] = useState(false);
  const [scheduleGuideDayFilter, setScheduleGuideDayFilter] = useState("ALL");
  const [justCompletedAll, setJustCompletedAll] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [incomingOverflowEvent, setIncomingOverflowEvent] = useState(null);
  const [isFullDispatched, setIsFullDispatched] = useState(false);
  const [disposalSite, setDisposalSite] = useState(null);
  const [driverLoadPercent, setDriverLoadPercent] = useState(25);

  const currentRoute = useMemo(() => pickCurrentRoute(driverRoutes), [driverRoutes]);
  const resolvedVehicleId = currentRoute?.vehicle_id ?? driver?.assigned_vehicle_id ?? null;

  useEffect(() => {
    const routeDays = extractRouteScheduleDays(currentRoute);
    if (routeDays.length === 1) {
      setScheduleGuideDayFilter(routeDays[0]);
    } else {
      setScheduleGuideDayFilter("ALL");
    }
  }, [currentRoute]);

  const filteredScheduleStops = useMemo(
    () =>
      (assignedScheduleStops ?? []).filter(
        (stop) => stop?.is_active !== false && doesScheduleMatchDay(stop?.days_of_week, scheduleGuideDayFilter),
      ),
    [assignedScheduleStops, scheduleGuideDayFilter],
  );

  const getCapacityColor = useCallback(
    (pct) => {
      if (pct >= 100) return colors.danger || "#DC2626";
      if (pct >= 75) return colors.warning || "#D97706";
      if (pct >= 50) return colors.info || "#2563EB";
      return colors.success || "#059669";
    },
    [colors],
  );

  const handleUpdateCapacity = useCallback(
    async (percent) => {
      setDriverLoadPercent(percent);
      if (percent >= 100) {
        setConfirmModalVisible(true);
        return;
      }
      if (resolvedVehicleId) {
        try {
          const { error } = await updateVehicleWithFallback(supabase, resolvedVehicleId, { load_percent: percent });
          if (error) console.warn("Capacity update note:", error.message);
        } catch (err) {
          console.warn("Capacity update note:", err?.message);
        }
      }
    },
    [resolvedVehicleId],
  );

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
  const isHeadingToLandfill = Boolean(isUnloadingAtLandfill || (isRouteFullyCollected && canCompleteCollections));
  const primaryAction = isFullDispatched || isHeadingToLandfill ? null : getPrimaryAction(routeState, colors, isRouteFullyCollected, t);
  const wasUnloadingRef = useRef(false);

  useEffect(() => {
    if (wasUnloadingRef.current && !isUnloadingAtLandfill) {
      setDriverLoadPercent(0);
      setIsFullDispatched(false);
      setDisposalSite(null);
    }
    wasUnloadingRef.current = Boolean(isUnloadingAtLandfill);
  }, [isUnloadingAtLandfill]);

  const handleCompletePickup = useCallback(
    (deliveryId, binId) => {
      if (!canCompleteCollections) {
        Alert.alert(
          t("alert_accept_first_title", "Accept Assignment First"),
          t("alert_accept_first_msg", "You need to accept this assignment before completing collection stops."),
        );
        return;
      }
      Alert.alert(
        t("alert_complete_pickup_title", "Complete Pickup"),
        t("alert_complete_pickup_msg", "Mark this stop as completed?"),
        [
          { text: t("cancel", "Cancel"), style: "cancel" },
          {
            text: t("complete_btn", "Complete"),
            onPress: () => {
              const before = routePendingPickups.length;
              completePickup(deliveryId, binId);
              if (before === 1) setJustCompletedAll(true);
            },
          },
        ],
      );
    },
    [canCompleteCollections, routePendingPickups.length, completePickup, t],
  );

  useEffect(() => {
    if (!justCompletedAll || routePendingPickups.length > 0) return;
    setJustCompletedAll(false);
    Alert.alert(
      t("alert_all_stops_done_title", "All Stops Done"),
      t("alert_all_stops_done_msg", "All collection points for this route are marked completed."),
    );
  }, [justCompletedAll, routePendingPickups.length, t]);

  const handlePrimaryAction = async () => {
    if (!currentRoute || !primaryAction || busy) return;
    if (routeState === "in_progress" && isRouteFullyCollected) {
      Alert.alert(
        t("alert_complete_route_title", "Complete Route"),
        t("alert_complete_route_msg", "Mark this route as finished for dispatch?"),
        [
          { text: t("cancel", "Cancel"), style: "cancel" },
          {
            text: t("complete_btn", "Complete"),
            onPress: async () => {
              setBusy(true);
              try {
                await completeRoute(currentRoute.id);
              } catch (e) {
                Alert.alert(
                  t("alert_route_update_err_title", "Could Not Update Route"),
                  e?.message ?? t("err_check_conn", "Check your connection and try again."),
                );
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
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
      Alert.alert(
        t("alert_route_update_err_title", "Could Not Update Route"),
        e?.message ?? t("err_check_conn", "Check your connection and try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  // Realtime subscription & initial check for overflow events directed to this driver
  useEffect(() => {
    if (!driver?.id) return;

    let isMounted = true;

    // Check for any active incoming overflow events assigned to this driver
    const checkIncoming = async () => {
      try {
        const { data, error } = await supabase
          .from("overflow_events")
          .select("*")
          .eq("target_driver_id", String(driver.id))
          .eq("status", "dispatched")
          .order("created_at", { ascending: false })
          .limit(1);

        if (!error && data && data.length > 0 && isMounted) {
          setIncomingOverflowEvent(data[0]);
        }
      } catch (err) {
        console.warn("Error checking incoming overflow:", err?.message);
      }
    };

    checkIncoming();

    // Listen to changes on overflow_events table
    const channel = supabase
      .channel(`driver_overflow_${driver.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "overflow_events",
        },
        (payload) => {
          if (!isMounted) return;
          const newRec = payload.new;
          if (newRec && String(newRec.target_driver_id) === String(driver.id)) {
            if (newRec.status === "dispatched") {
              setIncomingOverflowEvent(newRec);
            } else if (newRec.status === "accepted" || newRec.status === "declined" || newRec.status === "completed") {
              setIncomingOverflowEvent((current) => (current?.id === newRec.id ? null : current));
            }
          }
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [driver?.id]);

  // Handler: Driver confirms TRUCK FULL -> Request Relief Truck (Screen A action)
  const handleSignalOverflowConfirmed = async () => {
    if (busy || isFullDispatched) return;
    if (!driver?.id || !currentRoute?.id) {
      Alert.alert(
        t("alert_route_req_title", "Route Required"),
        t("alert_route_req_msg", "An active route is required to signal overflow."),
      );
      return;
    }
    const vehicleId = normalizeNonEmptyId(resolvedVehicleId ?? driver?.assigned_vehicle_id);
    if (!vehicleId) {
      Alert.alert(
        t("alert_vehicle_req_title", "Vehicle Assignment Required"),
        t("alert_vehicle_req_msg", "You must have an assigned vehicle to signal an overflow event. Please contact dispatch."),
      );
      return;
    }

    setBusy(true);
    setConfirmModalVisible(false);
    try {
      // 1. Gather remaining uncollected bins
      const uncollectedPickups = routePendingPickups;
      if (!uncollectedPickups || uncollectedPickups.length === 0) {
        Alert.alert(
          t("alert_no_stops_title", "No Remaining Stops"),
          t("alert_no_stops_msg", "There are no uncollected stops remaining on your route."),
        );
        return;
      }

      const overflowBins = uncollectedPickups.map((p, idx) => ({
        bin_id: p.binId,
        stop_order: p.stopOrder ?? idx + 1,
        lat: p.lat,
        lng: p.lng,
        location: p.street || p.address || "Collection Stop",
      }));

      const uncollectedStops = uncollectedPickups.map((p, idx) => ({
        id: String(p.binId ?? idx + 1),
        binId: p.binId,
        coordinate: { lat: Number(p.lat), lng: Number(p.lng) },
        stopOrder: p.stopOrder ?? idx + 1,
        location: p.street || p.address || "Collection Stop",
      }));

      // 2. Query active drivers, live GPS, and open overflow locks for Dynamic Reassignment Engine
      const MAX_OFFLINE_SECONDS = 90;
      const nowMs = Date.now();
      const [driverRes, locRes, openEventsRes] = await Promise.all([
        supabase
          .from("drivers")
          .select("id, name, status, assigned_vehicle_id, last_seen_at")
          .neq("id", driver.id)
          .in("status", ["available", "on_route"]),
        supabase
          .from("vehicle_locations_latest")
          .select("vehicle_id, driver_id, latitude, longitude, updated_at"),
        supabase
          .from("overflow_events")
          .select("source_vehicle_id, target_vehicle_id, target_driver_id, status")
          .in("status", ["pending", "dispatched", "accepted"]),
      ]);

      if (driverRes.error) throw driverRes.error;
      const activeDrivers = driverRes.data || [];
      const latestLocations = locRes.data || [];
      const openOverflowEvents = openEventsRes?.error ? [] : openEventsRes?.data || [];

      const busySourceVehicleIds = new Set();
      const busyTargetVehicleIds = new Set();
      const busyTargetDriverIds = new Set();
      openOverflowEvents.forEach((ev) => {
        const sNorm = String(ev.status || "").toLowerCase();
        if (sNorm === "pending" && ev.source_vehicle_id != null) {
          busySourceVehicleIds.add(String(ev.source_vehicle_id));
        }
        if (sNorm === "dispatched" || sNorm === "accepted") {
          if (ev.source_vehicle_id != null) busySourceVehicleIds.add(String(ev.source_vehicle_id));
          if (ev.target_vehicle_id != null) busyTargetVehicleIds.add(String(ev.target_vehicle_id));
          if (ev.target_driver_id != null) busyTargetDriverIds.add(String(ev.target_driver_id));
        }
      });

      const candidateInputs = [];
      if (activeDrivers.length > 0) {
        const candidateVehicleIds = [
          ...new Set(
            activeDrivers
              .map((d) => normalizeNonEmptyId(d.assigned_vehicle_id))
              .filter((vId) => vId && String(vId) !== String(vehicleId)),
          ),
        ];

        let candidateVehicles = [];
        if (candidateVehicleIds.length > 0) {
          const { data: vehData } = await selectCandidateVehiclesWithFallback(supabase, candidateVehicleIds);
          candidateVehicles = vehData || [];
        }

        const candidateRouteIds = [
          ...new Set(candidateVehicles.map((v) => normalizeNonEmptyId(v.route_id)).filter(Boolean)),
        ];
        const unroutedDriverIds = [
          ...new Set(
            candidateVehicles
              .filter((v) => !normalizeNonEmptyId(v.route_id))
              .map((v) => activeDrivers.find((d) => String(d.assigned_vehicle_id) === String(v.id))?.id)
              .filter(Boolean),
          ),
        ];

        const [routeDelRes, driverDelRes] = await Promise.all([
          candidateRouteIds.length > 0
            ? supabase
                .from("deliveries")
                .select("route_id, driver_id, bin_id, status, bins(latitude, longitude)")
                .in("route_id", candidateRouteIds)
            : Promise.resolve({ data: [] }),
          unroutedDriverIds.length > 0
            ? supabase
                .from("deliveries")
                .select("route_id, driver_id, bin_id, status, bins(latitude, longitude)")
                .in("driver_id", unroutedDriverIds)
                .not("status", "in", "(completed,cancelled)")
            : Promise.resolve({ data: [] }),
        ]);

        const candidateDeliveries = [
          ...(Array.isArray(routeDelRes?.data) ? routeDelRes.data : []),
          ...(Array.isArray(driverDelRes?.data) ? driverDelRes.data : []),
        ];

        candidateVehicles.forEach((veh) => {
          const candDriver =
            activeDrivers.find((d) => String(d.assigned_vehicle_id) === String(veh.id)) ?? null;
          const candLoc = latestLocations.find(
            (l) =>
              (l.vehicle_id != null && String(l.vehicle_id) === String(veh.id)) ||
              (candDriver?.id != null && l.driver_id != null && String(l.driver_id) === String(candDriver.id)),
          );

          const rawLat = candLoc?.latitude ?? veh?.latitude;
          const rawLng = candLoc?.longitude ?? veh?.longitude;
          const latNum = rawLat != null && rawLat !== "" ? Number(rawLat) : NaN;
          const lngNum = rawLng != null && rawLng !== "" ? Number(rawLng) : NaN;
          const hasValidCoords =
            Number.isFinite(latNum) &&
            Number.isFinite(lngNum) &&
            latNum >= -90 &&
            latNum <= 90 &&
            lngNum >= -180 &&
            lngNum <= 180 &&
            !(Math.abs(latNum) < 1e-6 && Math.abs(lngNum) < 1e-6);
          const currentLocation = hasValidCoords ? { lat: latNum, lng: lngNum } : null;

          const gpsTimestamp = candLoc?.updated_at ?? veh?.last_seen_at ?? candDriver?.last_seen_at ?? null;
          const gpsMs = gpsTimestamp ? new Date(gpsTimestamp).getTime() : NaN;
          const gpsAgeSeconds = Number.isFinite(gpsMs) ? Math.max(0, (nowMs - gpsMs) / 1000) : Infinity;
          const driverIsOfflineStatus =
            candDriver != null && String(candDriver.status || "").toLowerCase() === "offline";
          const isGpsFresh =
            currentLocation != null &&
            Number.isFinite(gpsAgeSeconds) &&
            gpsAgeSeconds <= MAX_OFFLINE_SECONDS &&
            !driverIsOfflineStatus;

          const routeDels = veh?.route_id
            ? candidateDeliveries.filter((d) => String(d.route_id) === String(veh.route_id))
            : [];
          const hasOpenDriverDeliveries =
            candDriver?.id != null &&
            candidateDeliveries.some(
              (d) =>
                String(d.driver_id) === String(candDriver.id) &&
                !["completed", "cancelled"].includes(String(d.status || "").toLowerCase()),
            );

          let currentLoadPercent = null;
          let loadSource = "unverified";
          const reportedLoad =
            veh?.load_percent != null && veh.load_percent !== "" ? Number(veh.load_percent) : NaN;
          if (Number.isFinite(reportedLoad) && reportedLoad >= 0) {
            currentLoadPercent = Math.max(0, Math.min(100, reportedLoad));
            loadSource = "driver_reported";
          } else if (veh?.route_id && routeDels.length > 0) {
            const completed = routeDels.filter(
              (d) => String(d.status || "").toLowerCase() === "completed",
            ).length;
            currentLoadPercent = Math.round((completed / routeDels.length) * 100);
            loadSource = "route_progress_estimated";
          } else if (!veh?.route_id && !hasOpenDriverDeliveries) {
            currentLoadPercent = 0;
            loadSource = "route_progress_estimated";
          }

          const activeStops = routeDels
            .filter((d) => !["completed", "cancelled"].includes(String(d.status || "").toLowerCase()))
            .map((d) => ({
              lat: Number(d.bins?.latitude ?? NaN),
              lng: Number(d.bins?.longitude ?? NaN),
            }))
            .filter(
              (c) =>
                Number.isFinite(c.lat) &&
                Number.isFinite(c.lng) &&
                !(Math.abs(c.lat) < 1e-6 && Math.abs(c.lng) < 1e-6),
            );

          candidateInputs.push({
            id: String(veh.id),
            label: veh.label || `Truck #${veh.id}`,
            driverId: candDriver?.id != null ? String(candDriver.id) : null,
            driverName: candDriver?.name || "Assigned Driver",
            driverStatus: candDriver?.status ?? null,
            isActive: veh.is_active !== false,
            currentLocation,
            currentLoadPercent,
            loadSource,
            status: veh.status || "available",
            activeStops,
            capacityLiters:
              veh.capacity_liters != null && Number.isFinite(Number(veh.capacity_liters))
                ? Number(veh.capacity_liters)
                : null,
            capacityKg:
              veh.capacity_kg != null && Number.isFinite(Number(veh.capacity_kg))
                ? Number(veh.capacity_kg)
                : null,
            gpsTimestamp,
            gpsAgeSeconds,
            isGpsFresh,
            maxOfflineSeconds: MAX_OFFLINE_SECONDS,
            hasActiveOverflowAssignment:
              busySourceVehicleIds.has(String(veh.id)) ||
              busyTargetVehicleIds.has(String(veh.id)) ||
              (candDriver?.id != null && busyTargetDriverIds.has(String(candDriver.id))),
          });
        });
      }

      const reassignmentResult = evaluateMultiCriteriaReassignment(
        candidateInputs,
        uncollectedStops,
        SWMO_LANDFILL_DISPOSAL_SITE,
      );

      // 3. Mark deliveries as OVERFLOW_UNCOLLECTED (tolerate DBs without enum value)
      const deliveryIds = uncollectedPickups.map((p) => p.deliveryId).filter(Boolean);
      if (deliveryIds.length > 0) {
        const { error: delivErr } = await updateDeliveriesStatusWithFallback(
          supabase,
          deliveryIds,
          "overflow_uncollected",
        );
        if (delivErr) throw delivErr;
      }

      // 4. Update current truck & driver status to full (with schema/enum fallbacks)
      const { error: vehErr } = await updateVehicleWithFallback(supabase, vehicleId, {
        status: "full",
        load_percent: 100,
      });
      if (vehErr) throw vehErr;

      const { error: drvErr } = await updateDriverStatusWithFallback(supabase, driver.id, "full", "on_route");
      if (drvErr) throw drvErr;

      // 5. Insert overflow_events record(s) from Dynamic Reassignment Engine (single or multi-truck split)
      const nowIso = new Date().toISOString();
      const mapStopToBinEntry = (stop, idx, meta = null) => {
        const base = {
          bin_id: stop.binId,
          stop_order: stop.stopOrder ?? idx + 1,
          lat: stop.coordinate.lat,
          lng: stop.coordinate.lng,
          location: stop.location || "Collection Stop",
        };
        return meta && idx === 0 ? { ...base, _meta: meta } : base;
      };

      const createdPayloads = [];
      for (const assignment of reassignmentResult.assignments) {
        const normalizedTargetVehicleId = normalizeNonEmptyId(assignment.vehicleId);
        const normalizedTargetDriverId = normalizeNonEmptyId(assignment.driverId);
        const assignmentMeta = {
          reported_capacity_percent: 100,
          algorithm: "dynamic_capacity_reassignment_v2",
          is_multi_truck: reassignmentResult.isMultiTruck,
          assignment_group_count: reassignmentResult.assignments.length,
          assigned_stops_count: assignment.stopsCount,
          total_overflow_stops: uncollectedStops.length,
          starting_load_percent: assignment.startingLoadPercent,
          added_load_percent: assignment.addedLoadPercent,
          projected_load_percent: assignment.projectedLoadPercent,
          added_volume_liters: assignment.addedVolumeLiters,
          added_weight_kg: assignment.addedWeightKg,
          limiting_factor: assignment.limitingFactor,
          composite_score: assignment.compositeScore,
          additional_distance_km: assignment.additionalDistanceKm,
          distance_to_dumpsite_km: assignment.distanceToDumpsiteKm,
          capacity_validated: reassignmentResult.capacityValidated,
          capacity_validation_note: reassignmentResult.capacityValidationNote,
        };
        const assignedBins = assignment.assignedStops.map((s, idx) =>
          mapStopToBinEntry(s, idx, assignmentMeta),
        );
        const eventPayload = {
          source_vehicle_id: vehicleId,
          source_driver_id: String(driver.id),
          source_route_id: String(currentRoute.id),
          target_vehicle_id: normalizedTargetVehicleId,
          target_driver_id: normalizedTargetDriverId,
          status: normalizedTargetDriverId ? "dispatched" : "pending",
          overflow_bins: assignedBins,
          bins_count: assignedBins.length,
          distance_km: assignment.additionalDistanceKm,
          reassignment_metadata: assignmentMeta,
          created_at: nowIso,
        };
        const { error: eventError } = await insertOverflowEventWithFallback(supabase, eventPayload);
        if (eventError) {
          throw new Error(eventError.message || "Failed inserting overflow event.");
        }
        createdPayloads.push(assignment);
      }

      const pendingStops =
        reassignmentResult.assignments.length === 0
          ? uncollectedStops
          : reassignmentResult.unassignedStops;
      if (pendingStops.length > 0) {
        const pendingMeta = {
          reported_capacity_percent: 100,
          algorithm: "dynamic_capacity_reassignment_v2",
          is_multi_truck: reassignmentResult.isMultiTruck,
          unassigned_reason:
            reassignmentResult.assignments.length === 0
              ? "No eligible assisting truck met GPS, driver, and capacity constraints"
              : "Remaining stops exceed combined capacity of available fleet",
          capacity_validated: reassignmentResult.capacityValidated,
          capacity_validation_note: reassignmentResult.capacityValidationNote,
        };
        const pendingBins = pendingStops.map((s, idx) => mapStopToBinEntry(s, idx, pendingMeta));
        const { error: eventError } = await insertOverflowEventWithFallback(supabase, {
          source_vehicle_id: vehicleId,
          source_driver_id: String(driver.id),
          source_route_id: String(currentRoute.id),
          target_vehicle_id: null,
          target_driver_id: null,
          status: "pending",
          overflow_bins: pendingBins,
          bins_count: pendingBins.length,
          distance_km: null,
          reassignment_metadata: pendingMeta,
          created_at: nowIso,
        });
        if (eventError) {
          throw new Error(eventError.message || "Failed inserting overflow event.");
        }
      }

      // 6. Notify dispatcher
      const dispatchedCount = createdPayloads.reduce((sum, a) => sum + a.stopsCount, 0);
      const notifyMsg =
        createdPayloads.length > 1
          ? `${driverName} signaled 100% FULL. Dynamic engine split ${dispatchedCount}/${overflowBins.length} stops across ${createdPayloads.length} trucks (${createdPayloads.map((a) => `${a.label}: ${a.stopsCount}`).join(", ")}).`
          : createdPayloads.length === 1
            ? `${driverName} signaled 100% FULL. Dynamic engine dispatched ${createdPayloads[0].stopsCount}/${overflowBins.length} stops to ${createdPayloads[0].label}.`
            : `${driverName} signaled 100% FULL. ${overflowBins.length} uncollected bins awaiting dispatcher relief assignment.`;

      const { error: notifErr } = await insertNotificationWithFallback(supabase, {
        role: "dispatcher",
        title: "Truck Capacity Full",
        message: notifyMsg,
        type: "warning",
        category: "truck",
        source_table: "overflow_events",
        read: false,
        created_at: nowIso,
      });
      if (notifErr) console.warn("Overflow notification note:", notifErr.message);

      // 7. Transition to Disposal Site View ONLY after all DB updates succeed
      setIsFullDispatched(true);
      setDisposalSite({
        name: SWMO_LANDFILL.name,
        address: SWMO_LANDFILL.address,
        lat: SWMO_LANDFILL.lat,
        lng: SWMO_LANDFILL.lng,
      });

      await reloadPickups();
    } catch (e) {
      Alert.alert(
        t("alert_overflow_err_title", "Error Signaling Overflow"),
        e?.message ?? t("err_check_conn", "Check your connection and try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStartLandfillUnload = useCallback(async () => {
    if (busy || !driver?.id) return;
    setBusy(true);
    try {
      await startLandfillUnload();
      setDisposalSite({
        name: SWMO_LANDFILL.name,
        address: SWMO_LANDFILL.address,
        lat: SWMO_LANDFILL.lat,
        lng: SWMO_LANDFILL.lng,
      });
      navigation.navigate("Map", { startRoute: true, navigateToLandfill: true });
    } catch (e) {
      Alert.alert(
        t("alert_landfill_trip_err_title", "Could Not Start Landfill Trip"),
        e?.message ?? t("err_try_again", "Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, driver?.id, navigation, startLandfillUnload, t]);

  const handleMarkUnloadedAndContinue = useCallback(async () => {
    if (busy || !driver?.id) return;
    setBusy(true);
    try {
      if (remainingPickups === 0 && currentRoute?.id && canCompleteCollections) {
        await completeRoute(currentRoute.id);
      } else {
        await completeLandfillUnload();
      }
      setDriverLoadPercent(0);
      setIsFullDispatched(false);
      setDisposalSite(null);
      Alert.alert(
        t("alert_unloading_done_title", "Unloading Complete"),
        remainingPickups > 0
          ? t(
              "alert_unloading_resume_msg",
              "Load reset to 0%. You can now continue your remaining {count} assigned stop(s).",
              { count: remainingPickups },
            )
          : t("alert_unloading_complete_msg", "Truck unloaded at SWMO Sanitary Landfill and route marked completed."),
      );
    } catch (e) {
      Alert.alert(
        t("alert_resume_err_title", "Could Not Resume Route"),
        e?.message ?? t("err_try_again", "Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, canCompleteCollections, completeLandfillUnload, completeRoute, currentRoute?.id, driver?.id, remainingPickups, t]);

  // Handler: Target driver accepts incoming overflow request (Screen B)
  const handleAcceptOverflow = async () => {
    if (busy || !incomingOverflowEvent) return;
    if (!driver?.id) {
      Alert.alert(
        t("alert_accept_overflow_err", "Failed Accepting Overflow"),
        t("err_try_again", "Driver profile unavailable. Please try again."),
      );
      return;
    }
    setBusy(true);
    try {
      const eventId = incomingOverflowEvent.id;
      const targetDriverId = String(driver.id);
      const targetVehicleId = normalizeNonEmptyId(resolvedVehicleId);
      const openRouteStatuses = new Set(["active", "pending", "planned"]);
      const targetRouteId =
        currentRoute?.id && openRouteStatuses.has(routeNorm(currentRoute.status))
          ? String(currentRoute.id)
          : null;

      // 1. Concurrency check: verify event is still active and not yet accepted
      const { data: latestEvent, error: fetchErr } = await supabase
        .from("overflow_events")
        .select("*")
        .eq("id", eventId)
        .single();

      if (fetchErr || !latestEvent) {
        throw new Error("Unable to retrieve overflow event details. Please try again.");
      }

      if (latestEvent.status === "accepted") {
        setIncomingOverflowEvent(null);
        Alert.alert(
          t("alert_already_accepted_title", "Already Accepted"),
          t("alert_already_accepted_msg", "This overflow request has already been accepted."),
        );
        return;
      }

      if (latestEvent.status === "declined" || latestEvent.status === "completed") {
        setIncomingOverflowEvent(null);
        Alert.alert(
          t("alert_req_expired_title", "Request Expired"),
          t("alert_req_expired_msg", "This overflow request is {status}.", { status: latestEvent.status }),
        );
        return;
      }

      // 2. Try transactional RPC first
      let rpcSucceeded = false;
      let shouldFallbackToClient = false;
      const { data: rpcResult, error: rpcError } = await supabase.rpc("accept_overflow_event", {
        p_event_id: eventId,
        p_target_driver_id: targetDriverId,
        p_target_vehicle_id: targetVehicleId,
        p_target_route_id: targetRouteId,
      });

      if (!rpcError && rpcResult?.success) {
        rpcSucceeded = true;
      } else if (!rpcError && rpcResult && rpcResult.success === false) {
        const errMsg = String(rpcResult.error || "Unable to accept overflow request.");
        if (errMsg.toLowerCase().includes("already been accepted")) {
          setIncomingOverflowEvent(null);
          await reloadPickups();
          Alert.alert(
            t("alert_already_accepted_title", "Already Accepted"),
            t("alert_already_accepted_msg", "This overflow request has already been accepted."),
          );
          return;
        }
        throw new Error(errMsg);
      } else if (rpcError) {
        if (isMissingRpcError(rpcError)) {
          shouldFallbackToClient = true;
          console.warn("RPC accept_overflow_event fallback:", rpcError.message);
        } else {
          throw new Error(rpcError.message || "Unable to accept overflow request.");
        }
      } else {
        shouldFallbackToClient = true;
      }

      // 3. Fallback: coordinated client-side transaction only if RPC is not yet deployed
      if (!rpcSucceeded && shouldFallbackToClient) {
        const now = new Date().toISOString();
        let effectiveRouteId = targetRouteId;

        if (!effectiveRouteId) {
          const { data: activeRoutes } = await supabase
            .from("routes")
            .select("id")
            .eq("driver_id", driver.id)
            .in("status", ["active", "pending", "planned"])
            .order("created_at", { ascending: false })
            .limit(1);

          if (activeRoutes && activeRoutes.length > 0) {
            effectiveRouteId = String(activeRoutes[0].id);
          } else {
            const { data: newRoute, error: newRouteErr } = await supabase
              .from("routes")
              .insert({
                name: "Overflow Assistance Route",
                status: "active",
                driver_id: driver.id,
                vehicle_id: driver.assigned_vehicle_id ?? null,
                generated_at: now,
                assignment_updated_at: now,
                started_at: now,
              })
              .select("id")
              .single();
            if (newRouteErr) throw newRouteErr;
            effectiveRouteId = String(newRoute.id);
          }
        }

        const overflowBins = latestEvent.overflow_bins || [];
        const binIds = overflowBins.map((b) => b.bin_id).filter(Boolean);

        if (binIds.length > 0) {
          let delivUpdate = supabase
            .from("deliveries")
            .update({
              driver_id: driver.id,
              route_id: effectiveRouteId,
              status: "assigned",
              updated_at: now,
            })
            .in("bin_id", binIds);
          if (latestEvent.source_route_id) {
            delivUpdate = delivUpdate.eq("route_id", latestEvent.source_route_id);
          } else {
            delivUpdate = delivUpdate.in("status", ["overflow_uncollected", "pending", "assigned"]);
          }
          const { data: updatedRows, error: delivErr } = await delivUpdate.select("bin_id");
          if (delivErr) {
            if (String(delivErr.code ?? "") === "23505") {
              const { error: upsertErr } = await supabase.from("deliveries").upsert(
                binIds.map((binId) => ({
                  route_id: effectiveRouteId,
                  bin_id: binId,
                  driver_id: driver.id,
                  status: "assigned",
                  updated_at: now,
                })),
                { onConflict: "route_id,bin_id" },
              );
              if (upsertErr) throw upsertErr;
            } else {
              throw delivErr;
            }
          } else {
            const updatedSet = new Set((updatedRows ?? []).map((r) => String(r.bin_id)));
            const missingBinIds = binIds.filter((bid) => !updatedSet.has(String(bid)));
            if (missingBinIds.length > 0) {
              const { error: upsertMissingErr } = await supabase.from("deliveries").upsert(
                missingBinIds.map((binId) => ({
                  route_id: effectiveRouteId,
                  bin_id: binId,
                  driver_id: driver.id,
                  status: "assigned",
                  updated_at: now,
                })),
                { onConflict: "route_id,bin_id" },
              );
              if (upsertMissingErr) throw upsertMissingErr;
            }
          }

          const { data: existingStops } = await supabase
            .from("route_stops")
            .select("bin_id, stop_order")
            .eq("route_id", effectiveRouteId);

          const existingBinSet = new Set((existingStops ?? []).map((s) => String(s.bin_id)));
          const maxOrder = (existingStops ?? []).reduce((max, s) => Math.max(max, Number(s.stop_order) || 0), 0);
          const newRouteStops = overflowBins
            .filter((b) => b?.bin_id != null && !existingBinSet.has(String(b.bin_id)))
            .map((b, idx) => ({
              route_id: effectiveRouteId,
              bin_id: b.bin_id,
              stop_order: maxOrder + idx + 1,
            }));

          if (newRouteStops.length > 0) {
            const { error: rsErr } = await supabase.from("route_stops").insert(newRouteStops);
            if (rsErr) console.warn("route_stops insert note:", rsErr.message);
          }

          if (latestEvent.source_route_id) {
            await supabase
              .from("route_stops")
              .delete()
              .eq("route_id", latestEvent.source_route_id)
              .in("bin_id", binIds);
          }
        }

        const { error: updateEventErr } = await supabase
          .from("overflow_events")
          .update({
            status: "accepted",
            accepted_at: now,
            target_driver_id: targetDriverId,
            target_vehicle_id: targetVehicleId,
          })
          .eq("id", eventId);
        if (updateEventErr) throw updateEventErr;
      }

      // 4. Notify dispatcher
      const nowTime = new Date().toISOString();
      const { error: notifErr } = await insertNotificationWithFallback(supabase, {
        role: "dispatcher",
        title: "Overflow Accepted",
        message: `${driverName} ACCEPTED overflow assistance of ${incomingOverflowEvent.bins_count} stops.`,
        type: "success",
        category: "truck",
        source_table: "overflow_events",
        read: false,
        created_at: nowTime,
      });
      if (notifErr) console.warn("Overflow accept notification note:", notifErr.message);

      setIncomingOverflowEvent(null);
      await reloadPickups();
      Alert.alert(
        t("alert_overflow_assigned_title", "Overflow Assigned"),
        t(
          "alert_overflow_assigned_msg",
          "{count} additional overflow pickup points added to your collection queue.",
          { count: incomingOverflowEvent.bins_count },
        ),
        [
          {
            text: t("btn_view_route", "View Route"),
            onPress: () => navigation.navigate("Map", { startRoute: true }),
          },
          { text: t("ok", "OK") },
        ],
      );
    } catch (e) {
      Alert.alert(
        t("alert_accept_overflow_err", "Failed Accepting Overflow"),
        e?.message ?? t("err_try_again", "Please try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  // Handler: Target driver declines incoming overflow request (Screen B)
  const handleDeclineOverflow = async () => {
    if (!incomingOverflowEvent) return;
    setBusy(true);
    try {
      await supabase
        .from("overflow_events")
        .update({ status: "declined" })
        .eq("id", incomingOverflowEvent.id);

      await insertNotificationWithFallback(supabase, {
        role: "dispatcher",
        title: "Overflow Declined",
        message: `${driverName} declined overflow assistance of ${incomingOverflowEvent.bins_count} stops. Dispatcher re-routing required.`,
        type: "warning",
        category: "truck",
        source_table: "overflow_events",
        read: false,
        created_at: new Date().toISOString(),
      });

      setIncomingOverflowEvent(null);
    } catch (e) {
      Alert.alert(
        t("alert_decline_overflow_err", "Failed Declining Overflow"),
        e?.message ?? t("err_try_again", "Please try again."),
      );
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
            accessibilityLabel: "Notifications",
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
            accessibilityLabel: "Driver profile",
          },
        ]}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.greetingText, { color: colors.textSecondary }]}>
          {getGreeting(t)}, {driverName}
        </Text>

        <CurrentAssignmentCard
          route={currentRoute}
          routeState={routeState}
          routeStateLabel={isHeadingToLandfill ? t("status_unloading", "Unloading at Landfill") : routeStateLabel(routeState, t)}
          areas={buildAreaLabel(currentRoute, collectionList)}
          scheduleStops={assignedScheduleStops}
          colors={colors}
          t={t}
        />

        <RouteProgressCard
          totalPickups={totalPickups}
          completedPickups={completedPickups}
          remainingPickups={remainingPickups}
          completionPercent={completionPercent}
          colors={colors}
          t={t}
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

        {/* Driver Capacity Indicator & Selector */}
        {!isFullDispatched && !isHeadingToLandfill && canCompleteCollections ? (
          <SurfaceCard style={styles.capacityCard}>
            <View style={styles.capacityHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.capacityTitle, { color: colors.textPrimary }]}>
                  {t("truck_load_title", "Truck Load Level (Driver-Reported)")}
                </Text>
                <Text style={[styles.capacitySubtitle, { color: colors.textSecondary }]}>
                  {t("truck_load_subtitle", "Tap current estimated load to update dispatch")}
                </Text>
              </View>
              <View style={[styles.capacityBadge, { backgroundColor: getCapacityColor(driverLoadPercent) + "22" }]}>
                <Text style={[styles.capacityBadgeText, { color: getCapacityColor(driverLoadPercent) }]}>
                  {driverLoadPercent}%
                </Text>
              </View>
            </View>
            <View style={styles.capacityButtonsRow}>
              {[
                { pct: 25, label: "25%", sub: t("load_low", "Low") },
                { pct: 50, label: "50%", sub: t("load_half", "Half") },
                { pct: 75, label: "75%", sub: t("load_near", "Near") },
                { pct: 100, label: "100%", sub: t("load_full", "Full") },
              ].map((item) => {
                const isSelected = driverLoadPercent === item.pct;
                const itemColor = getCapacityColor(item.pct);
                return (
                  <TouchableOpacity
                    key={item.pct}
                    onPress={() => handleUpdateCapacity(item.pct)}
                    style={[
                      styles.capacityBtn,
                      {
                        backgroundColor: isSelected ? itemColor : colors.surface,
                        borderColor: isSelected ? itemColor : colors.borderSubtle,
                      },
                    ]}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`Set truck load to ${item.label}, ${item.sub}`}
                  >
                    <Text
                      style={[
                        styles.capacityBtnText,
                        { color: isSelected ? "#FFFFFF" : colors.textPrimary },
                      ]}
                    >
                      {item.label}
                    </Text>
                    <Text
                      style={[
                        styles.capacityBtnSub,
                        { color: isSelected ? "#FFFFFFE0" : colors.textSecondary },
                      ]}
                    >
                      {item.sub}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </SurfaceCard>
        ) : null}

        {/* Unified Truck Full / Landfill Unload Action */}
        {!isFullDispatched && !isHeadingToLandfill && canCompleteCollections ? (
          <AppButton
            title={t("btn_truck_full_options", "Truck Full (100%) — Unload or Request Relief")}
            icon="alert-circle"
            onPress={() => setConfirmModalVisible(true)}
            disabled={busy || pickupsLoading}
            loading={busy}
            style={[styles.overflowFullButton, { backgroundColor: colors.danger }]}
            textStyle={styles.overflowFullButtonText}
          />
        ) : null}

        {/* Screen A: Redirect/Status Card for Driver Screen when Unloading or Full */}
        {isFullDispatched || isHeadingToLandfill ? (
          <SurfaceCard style={[styles.disposalCard, { borderColor: isFullDispatched ? colors.danger : colors.primary }]}>
            <View style={styles.disposalHeader}>
              <View style={[styles.disposalIconWrap, { backgroundColor: (isFullDispatched ? colors.danger : colors.primary) + "22" }]}>
                <Ionicons name="trash" size={24} color={isFullDispatched ? colors.danger : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.disposalTitle, { color: isFullDispatched ? colors.danger : colors.primary }]}>
                  {isFullDispatched
                    ? t("truck_cap_100_title", "Truck Capacity 100% Full")
                    : remainingPickups > 0
                      ? t("disposal_unloading_title", "Unloading at SWMO Landfill")
                      : t("disposal_final_trip_title", "Final Trip to SWMO Landfill")}
                </Text>
                <Text style={[styles.disposalSubtitle, { color: colors.textSecondary }]}>
                  {isFullDispatched
                    ? t("truck_cap_100_sub", "Remaining uncollected bins transferred to nearest active truck")
                    : remainingPickups > 0
                      ? t("disposal_unloading_sub", "Head to SWMO Sanitary Landfill, then mark unloaded to continue remaining stops")
                      : t("disposal_final_trip_sub", "All stops collected. Head to SWMO Sanitary Landfill, then mark unloaded to complete this route")}
                </Text>
              </View>
            </View>

            <View style={[styles.disposalDetails, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
              <Text style={[styles.disposalDestLabel, { color: colors.textSecondary }]}>
                {t("official_disposal_dest", "Official Disposal Destination")}
              </Text>
              <Text style={[styles.disposalDestName, { color: colors.textPrimary }]}>
                {disposalSite?.name ?? SWMO_LANDFILL.name}
              </Text>
              <Text style={[styles.disposalDestAddress, { color: colors.textSecondary }]}>
                {disposalSite?.address ?? SWMO_LANDFILL.address}
              </Text>
            </View>

            <AppButton
              title={t("navigate_to_landfill", "Navigate to SWMO Landfill")}
              icon="navigate"
              onPress={() => navigation.navigate("Map", { startRoute: true, navigateToLandfill: true })}
              style={[styles.disposalNavBtn, { backgroundColor: colors.primary }]}
              textStyle={styles.disposalNavBtnText}
            />
            <AppButton
              title={
                remainingPickups > 0
                  ? t("mark_unloaded_resume", "Mark Unloaded & Resume Stops")
                  : t("mark_unloaded_complete", "Mark Unloaded & Complete Route")
              }
              icon="checkmark-circle-outline"
              variant="outline"
              onPress={handleMarkUnloadedAndContinue}
              disabled={busy}
              style={{ marginTop: 10 }}
            />
          </SurfaceCard>
        ) : null}

        <AppButton
          title={t("btn_report_issue", "Report an Issue")}
          icon="alert-circle-outline"
          variant="outlineMuted"
          onPress={() => navigation.navigate("Reports", { reportIssue: true })}
          style={styles.reportButton}
        />

        {assignedScheduleStops && assignedScheduleStops.length > 0 ? (
          <SurfaceCard style={styles.assignmentCard}>
            <TouchableOpacity
              onPress={() => setShowScheduleGuide((prev) => !prev)}
              activeOpacity={0.8}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
            >
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.eyebrow, { color: colors.primary }]}>
                  {t("swmo_official_schedule", "SWMO Official Schedule")}
                </Text>
                <Text style={[styles.sectionTitle, { color: colors.textPrimary, fontSize: 16 }]}>
                  {formatCollectionAreaDisplay(
                    assignedScheduleStops[0]?.area_code,
                    assignedScheduleStops[0]?.area_name,
                    assignedScheduleStops,
                  )}
                </Text>
                {assignedScheduleStops[0]?.shift_label ? (
                  <Text style={[styles.sectionHint, { color: colors.textSecondary, marginTop: 2 }]}>
                    {t("shift_stops_meta", "Shift: {shift} • {count} timed stops", {
                      shift: assignedScheduleStops[0].shift_label,
                      count: filteredScheduleStops.length,
                    })}
                  </Text>
                ) : null}
              </View>
              <Ionicons
                name={showScheduleGuide ? "chevron-up" : "chevron-down"}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
            {showScheduleGuide ? (
              <View style={[styles.assignmentMeta, { borderColor: colors.borderSubtle }]}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: 8 }}
                  contentContainerStyle={{ gap: 6, paddingVertical: 2 }}
                >
                  {["ALL", ...SCHEDULE_DAY_CODES].map((dayCode) => {
                    const isSelected = scheduleGuideDayFilter === dayCode;
                    return (
                      <TouchableOpacity
                        key={dayCode}
                        onPress={() => setScheduleGuideDayFilter(dayCode)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 999,
                          backgroundColor: isSelected ? colors.primary : colors.surfaceMuted || "#F3F4F6",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "700",
                            color: isSelected ? "#FFFFFF" : colors.textSecondary,
                          }}
                        >
                          {dayCode === "ALL" ? t("all_days", "All Days") : dayCode}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {assignedScheduleStops[0]?.waste_category ? (
                  <InfoRow label={t("waste_category", "Waste Category")} value={assignedScheduleStops[0].waste_category} colors={colors} />
                ) : null}
                {filteredScheduleStops.slice(0, 25).map((stop) => {
                  const normalizedDays = extractNormalizedScheduleDays(stop.days_of_week);
                  return (
                    <View key={stop.id ?? `${stop.area_code}-${stop.stop_order}`} style={{ paddingVertical: 4 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.textPrimary }}>
                        #{stop.stop_order} • {stop.scheduled_time || t("per_shift", "Per shift")} — {stop.location_name}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                        {stop.barangay ? `Brgy. ${stop.barangay}` : "Naga City"}
                        {normalizedDays.length
                          ? ` • ${normalizedDays.length === 7 ? t("daily_label", "Daily") : normalizedDays.join(", ")}`
                          : ""}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </SurfaceCard>
        ) : null}

        <View style={styles.sectionHeaderBlock}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t("collection_list_title", "Collection list")}</Text>
          <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>{t("collection_list_hint", "Open each bin/location and tap Complete after collection.")}</Text>
        </View>
        <View style={styles.sectionToContentGap} />
        {pickupsLoading ? (
          <SurfaceCard elevated={false} style={styles.loadingCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>{t("syncing_route", "Syncing route from dispatch...")}</Text>
          </SurfaceCard>
        ) : (
          <PendingPickupsList
            pendingPickups={collectionList}
            colors={colors}
            onCompletePickup={handleCompletePickup}
            canComplete={canCompleteCollections && !isUnloadingAtLandfill}
          />
        )}

        <View style={styles.spacing} />
      </ScrollView>

      {/* Screen A: Unified 100% Capacity Decision Modal (Unload & Resume vs Request Relief Truck) */}
      <Modal
        visible={confirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalIconWrap, { backgroundColor: colors.danger + "22" }]}>
              <Ionicons name="alert-circle" size={40} color={colors.danger} />
            </View>

            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
              {t("modal_100_title", "Truck at 100% Capacity")}
            </Text>

            <Text style={[styles.modalDescription, { color: colors.textSecondary }]}>
              {t("modal_100_desc", "Choose how to handle your remaining collection stops:")}
            </Text>

            <View style={{ width: "100%", gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={[
                  styles.modalChoiceCard,
                  {
                    backgroundColor: colors.primary + "12",
                    borderColor: colors.primary,
                    borderWidth: 1.5,
                    borderRadius: 14,
                    padding: 14,
                  },
                ]}
                onPress={async () => {
                  setConfirmModalVisible(false);
                  await handleStartLandfillUnload();
                }}
                disabled={busy}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Ionicons name="navigate-circle" size={20} color={colors.primary} />
                  <Text style={{ fontSize: 15, fontWeight: "800", color: colors.primary, flex: 1 }}>
                    {t("modal_opt_unload_title", "Unload & Resume Route")}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, lineHeight: 17, color: colors.textSecondary }}>
                  {t(
                    "modal_opt_unload_sub",
                    "Best when only a few stops remain — drive to SWMO Landfill, reset load to 0%, and continue",
                  )}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalChoiceCard,
                  {
                    backgroundColor: colors.danger + "12",
                    borderColor: colors.danger,
                    borderWidth: 1.5,
                    borderRadius: 14,
                    padding: 14,
                  },
                ]}
                onPress={handleSignalOverflowConfirmed}
                disabled={busy}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Ionicons name="swap-horizontal" size={20} color={colors.danger} />
                  <Text style={{ fontSize: 15, fontWeight: "800", color: colors.danger, flex: 1 }}>
                    {t("modal_opt_relief_title", "Request Relief Truck")}
                  </Text>
                  {busy ? <ActivityIndicator size="small" color={colors.danger} /> : null}
                </View>
                <Text style={{ fontSize: 12, lineHeight: 17, color: colors.textSecondary }}>
                  {t(
                    "modal_opt_relief_sub",
                    "Best when deep mid-route in heavy traffic — transfer remaining stops to nearest truck",
                  )}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalCancelButton, { borderColor: colors.borderSubtle, width: "100%", flex: 0 }]}
                onPress={() => setConfirmModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.modalCancelButtonText, { color: colors.textPrimary }]}>
                  {t("cancel", "Cancel")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Screen B: Dynamic Overflow Alert Modal (Target Pickup Truck) */}
      <Modal
        visible={Boolean(incomingOverflowEvent)}
        transparent
        animationType="slide"
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalIconWrap, { backgroundColor: colors.warning + "22" }]}>
              <Ionicons name="sync-circle" size={44} color={colors.warning} />
            </View>

            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
              {t("overflow_req_title", "Nearby Overflow Assistance Request")}
            </Text>

            {incomingOverflowEvent ? (
              <View style={[styles.overflowAlertBox, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
                <View style={styles.overflowInfoItem}>
                  <Text style={[styles.overflowInfoLabel, { color: colors.textSecondary }]}>
                    {t("overflow_interrupted_route", "Interrupted Route")}
                  </Text>
                  <Text style={[styles.overflowInfoValue, { color: colors.textPrimary }]}>
                    {currentRoute?.name ?? "Assigned Route"}
                  </Text>
                </View>

                <View style={styles.overflowInfoItem}>
                  <Text style={[styles.overflowInfoLabel, { color: colors.textSecondary }]}>
                    {t("overflow_remaining_bins", "Remaining Uncollected Bins")}
                  </Text>
                  <Text style={[styles.overflowInfoHighlight, { color: colors.danger }]}>
                    {t("overflow_bins_count", "{count} Bins", { count: incomingOverflowEvent.bins_count })}
                  </Text>
                </View>

                {incomingOverflowEvent.distance_km != null ? (
                  <View style={styles.overflowInfoItem}>
                    <Text style={[styles.overflowInfoLabel, { color: colors.textSecondary }]}>
                      {t("overflow_est_dist", "Estimated Distance")}
                    </Text>
                    <Text style={[styles.overflowInfoValue, { color: colors.textPrimary }]}>
                      {t("overflow_km_away", "~{km} km away", { km: incomingOverflowEvent.distance_km })}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <Text style={[styles.modalDescription, { color: colors.textSecondary }]}>
              {t(
                "overflow_req_desc",
                "A nearby truck has reached full capacity. Are you able to assist and collect these remaining bins?",
              )}
            </Text>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalCancelButton, { borderColor: colors.borderSubtle }]}
                onPress={handleDeclineOverflow}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Text style={[styles.modalCancelButtonText, { color: colors.textSecondary }]}>
                  {t("decline_btn", "Decline")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalConfirmButton, { backgroundColor: colors.primary }]}
                onPress={handleAcceptOverflow}
                disabled={busy}
                activeOpacity={0.8}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmButtonText}>{t("overflow_accept_btn", "Accept Overflow")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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

function CurrentAssignmentCard({ route, routeState, routeStateLabel, areas, scheduleStops = [], colors, t }) {
  const statusColor = routeStateColor(routeState, colors);
  const routeAreaCode = route?.inferredAreaCode || route?.area_code || null;
  const matchingStops = routeAreaCode
    ? scheduleStops.filter((s) => s.area_code === routeAreaCode)
    : [];
  const areaDisplay = routeAreaCode
    ? formatCollectionAreaDisplay(routeAreaCode, matchingStops[0]?.area_name, matchingStops)
    : null;
  return (
    <SurfaceCard style={styles.assignmentCard}>
      <View style={styles.assignmentHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{t ? t("current_assignment", "Current Assignment") : "Current Assignment"}</Text>
          <Text style={[styles.routeNameLine, { color: colors.textPrimary }]} numberOfLines={2}>
            {route?.name ?? (t ? t("no_route_assigned", "No route assigned") : "No route assigned")}
          </Text>
        </View>
        <TagChip label={routeStateLabel} color={statusColor} backgroundColor={statusColor + "22"} />
      </View>

      <View style={[styles.assignmentMeta, { borderColor: colors.borderSubtle }]}>
        <InfoRow label={t ? t("schedule", "Schedule") : "Schedule"} value={route?.shift_label || formatDateTime(route?.generated_at ?? route?.assignment_updated_at ?? route?.created_at)} colors={colors} />
        {areaDisplay ? (
          <InfoRow label={t ? t("swmo_area", "SWMO Area") : "SWMO Area"} value={areaDisplay} colors={colors} />
        ) : null}
        <InfoRow label={t ? t("barangays_areas", "Barangays / Areas") : "Barangays / Areas"} value={areas} colors={colors} />
        {route?.waste_category ? (
          <InfoRow label={t ? t("waste_category", "Waste Category") : "Waste Category"} value={route.waste_category} colors={colors} />
        ) : null}
      </View>
    </SurfaceCard>
  );
}

function RouteProgressCard({ totalPickups, completedPickups, remainingPickups, completionPercent, colors, t }) {
  return (
    <SurfaceCard style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t ? t("route_progress", "Route Progress") : "Route Progress"}</Text>
        <Text style={[styles.progressPercent, { color: colors.primary }]}>{completionPercent}%</Text>
      </View>
      <View style={[styles.progressBar, { backgroundColor: colors.textSecondary + "1F" }]}>
        <View style={[styles.progressFill, { width: `${completionPercent}%`, backgroundColor: colors.primary }]} />
      </View>
      <View style={styles.statsRow}>
        <RouteStat label={t ? t("stat_assigned", "Assigned") : "Assigned"} value={String(totalPickups)} />
        <RouteStat label={t ? t("stat_done", "Done") : "Done"} value={String(completedPickups)} />
        <RouteStat label={t ? t("stat_remaining", "Remaining") : "Remaining"} value={String(remainingPickups)} />
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
  overflowFullButton: {
    minHeight: 56,
    borderRadius: 16,
    marginBottom: 14,
  },
  overflowFullButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  disposalCard: {
    padding: 18,
    marginBottom: 18,
    borderWidth: 1.5,
  },
  disposalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  disposalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  disposalTitle: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  disposalSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    marginTop: 2,
  },
  disposalDetails: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  disposalDestLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  disposalDestName: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  disposalDestAddress: {
    fontSize: 12,
  },
  disposalNavBtn: {
    minHeight: 48,
    borderRadius: 12,
  },
  disposalNavBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  modalIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 10,
    lineHeight: 24,
  },
  modalDescription: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
  },
  modalButtonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  modalCancelButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
  modalConfirmButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  modalConfirmButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  overflowAlertBox: {
    width: "100%",
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
    gap: 10,
  },
  overflowInfoItem: {
    gap: 2,
  },
  overflowInfoLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  overflowInfoValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  overflowInfoHighlight: {
    fontSize: 16,
    fontWeight: "800",
  },
  capacityCard: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  capacityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  capacityTitle: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  capacitySubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  capacityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  capacityBadgeText: {
    fontSize: 13,
    fontWeight: "800",
  },
  capacityButtonsRow: {
    flexDirection: "row",
    gap: 8,
  },
  capacityBtn: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  capacityBtnText: {
    fontSize: 14,
    fontWeight: "800",
  },
  capacityBtnSub: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
});
