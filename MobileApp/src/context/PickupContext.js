import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { supabase } from "../lib/supabase";
import { enqueueMutation, flushOfflineQueue, subscribeConnectivity } from "../services/offlineSync";
import {
  eventBelongsToDriverAsSource,
  eventBelongsToDriverAsTarget,
  extractOverflowBinIds,
  formatOverflowSyncState,
  getEventTargetRouteId,
  isOpenRouteStatus,
  isOverflowRouteRecord,
  normalizeNonEmptyId,
  normalizeRouteStatus,
  resolveLinkedOverflowEvent,
  sortPickupsForActiveRoute,
} from "../utils/overflowSync";
import { insertNotificationWithFallback, updateVehicleWithFallback } from "../utils/schemaFallback";
import { useAuth } from "./AuthContext";

const PickupContext = createContext();
const PICKUPS_CACHE_KEY = "pickups_cache_v2";
const LANDFILL_UNLOAD_STATE_KEY = "landfill_unload_state_v1";
const OVERFLOW_EVENT_COLUMNS =
  "id, source_vehicle_id, source_driver_id, source_route_id, target_vehicle_id, target_driver_id, target_route_id, status, overflow_bins, bins_count, distance_km, reassignment_metadata, created_at, dispatched_at, accepted_at, completed_at";

async function queryOverflowEventsWithFallback(buildQuery) {
  let res = await buildQuery(OVERFLOW_EVENT_COLUMNS);
  if (
    res?.error &&
    ["PGRST204", "42703"].includes(String(res.error.code ?? ""))
  ) {
    res = await buildQuery("*");
  }
  return res;
}

const isValidCoordinate = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

export const usePickups = () => {
  const context = useContext(PickupContext);
  if (!context) {
    throw new Error("usePickups must be used within a PickupProvider");
  }
  return context;
};

const mapDeliveryToPickup = (delivery, stopOrder) => {
  const bin = delivery.bins ?? {};
  const deliveryStatus = normalizeRouteStatus(delivery.status);
  const binStatus = normalizeRouteStatus(bin.status);
  if (deliveryStatus !== "completed" && (bin.is_active === false || binStatus === "disabled" || binStatus === "inactive")) {
    return null;
  }
  const latitude = Number(bin.latitude);
  const longitude = Number(bin.longitude);
  if (!isValidCoordinate(latitude, longitude)) return null;

  return {
    deliveryId: delivery.id,
    binId: String(bin.id),
    id: bin.code ?? `Bin ${bin.id}`,
    street: bin.location ?? "Unknown Street",
    barangay: bin.barangay ?? null,
    areaCode: bin.area_code ?? delivery.routes?.area_code ?? null,
    scheduleDays: bin.schedule_days ?? null,
    scheduleTimeWindow: bin.schedule_time_window ?? null,
    wasteCategory: bin.waste_category ?? delivery.routes?.waste_category ?? null,
    collectionStatus: bin.collection_status ?? "pending",
    eta: delivery.eta ?? bin.schedule_time_window ?? "Pending",
    coords: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    lat: latitude,
    lng: longitude,
    status: `${bin.code ?? `Bin ${bin.id}`} - ${bin.location ?? "Unspecified"}`,
    due: delivery.due_label ?? bin.schedule_time_window ?? "Scheduled",
    tagColor: "pillBlue",
    hasDelay: delivery.has_delay ?? false,
    address: bin.barangay ? `${bin.location ?? "Naga City"} (Brgy. ${bin.barangay})` : bin.location ?? "Naga City",
    isValidated: (bin.coordinate_status ?? "verified") !== "needs_verification",
    accessibilityStatus: "accessible",
    routeName: delivery.routes?.name ?? "Assigned Route",
    routeId: delivery.route_id,
    deliveryStatus: normalizeRouteStatus(delivery.status),
    completedAt: delivery.completed_at ?? null,
    stopOrder: typeof stopOrder === "number" ? stopOrder : 9999,
  };
};

async function updateDriverRouteStatus(driverId, status, timestamp) {
  const { error } = await supabase.from("drivers").update({ status, last_seen_at: timestamp }).eq("id", driverId);
  if (error) throw error;
}

export const PickupProvider = ({ children }) => {
  const { driver } = useAuth();
  const [pendingPickups, setPendingPickups] = useState([]);
  const [assignedPickups, setAssignedPickups] = useState([]);
  const [driverRoutes, setDriverRoutes] = useState([]);
  const [overflowEvents, setOverflowEvents] = useState([]);
  const [dismissedOverflowEventIds, setDismissedOverflowEventIds] = useState([]);
  const [resolvedVehicleId, setResolvedVehicleId] = useState(null);
  const [assignedScheduleStops, setAssignedScheduleStops] = useState([]);
  const [isUnloadingAtLandfill, setIsUnloadingAtLandfill] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [totalAssignedCount, setTotalAssignedCount] = useState(0);

  const routeIdsRef = useRef(new Set());
  const pendingPickupsRef = useRef([]);
  const assignedPickupsRef = useRef([]);
  const totalAssignedCountRef = useRef(0);
  const driverRoutesRef = useRef([]);
  const overflowEventsRef = useRef([]);
  const resolvedVehicleIdRef = useRef(null);
  const preferredActiveRouteIdRef = useRef(null);
  const loadRequestSeqRef = useRef(0);
  const acceptingEventIdsRef = useRef(new Set());

  useEffect(() => {
    pendingPickupsRef.current = pendingPickups;
  }, [pendingPickups]);

  useEffect(() => {
    assignedPickupsRef.current = assignedPickups;
  }, [assignedPickups]);

  useEffect(() => {
    totalAssignedCountRef.current = totalAssignedCount;
  }, [totalAssignedCount]);

  useEffect(() => {
    driverRoutesRef.current = driverRoutes;
  }, [driverRoutes]);

  useEffect(() => {
    overflowEventsRef.current = overflowEvents;
  }, [overflowEvents]);

  useEffect(() => {
    resolvedVehicleIdRef.current = resolvedVehicleId;
  }, [resolvedVehicleId]);

  const hydrateFromCache = useCallback(async () => {
    if (!driver?.id) return;
    try {
      const unloadRaw = await AsyncStorage.getItem(LANDFILL_UNLOAD_STATE_KEY);
      if (unloadRaw) {
        const parsedUnload = JSON.parse(unloadRaw);
        if (parsedUnload?.driverId != null && String(parsedUnload.driverId) === String(driver.id)) {
          setIsUnloadingAtLandfill(Boolean(parsedUnload.isUnloading));
        } else {
          setIsUnloadingAtLandfill(false);
        }
      }
    } catch {
      /* ignore unload cache read error */
    }
    const cache = await AsyncStorage.getItem(PICKUPS_CACHE_KEY);
    if (!cache) return;
    try {
      const parsed = JSON.parse(cache);
      if (String(parsed?.driverId ?? "") !== String(driver.id)) {
        return;
      }
      const pending = parsed.pendingPickups ?? [];
      const assigned = parsed.assignedPickups ?? parsed.pendingPickups ?? [];
      const routes = parsed.driverRoutes ?? [];
      const events = parsed.overflowEvents ?? [];
      const scheduleStops = parsed.assignedScheduleStops ?? [];
      const total = parsed.totalAssignedCount ?? parsed.pendingPickups?.length ?? 0;
      if (parsed.preferredActiveRouteId) {
        preferredActiveRouteIdRef.current = normalizeNonEmptyId(parsed.preferredActiveRouteId);
      }
      pendingPickupsRef.current = pending;
      assignedPickupsRef.current = assigned;
      driverRoutesRef.current = routes;
      overflowEventsRef.current = events;
      totalAssignedCountRef.current = total;
      setPendingPickups(pending);
      setAssignedPickups(assigned);
      if (Array.isArray(routes) && routes.length > 0) setDriverRoutes(routes);
      if (Array.isArray(events)) setOverflowEvents(events);
      setAssignedScheduleStops(scheduleStops);
      setTotalAssignedCount(total);
      routeIdsRef.current = new Set(assigned.map((p) => String(p.routeId)).filter(Boolean));
    } catch (error) {
      console.warn("Failed parsing pickup cache:", error?.message);
    }
  }, [driver?.id]);

  const persistCache = useCallback(
    async (
      nextPickups,
      assignedCount,
      nextAssignedPickups = nextPickups,
      nextScheduleStops = [],
      extra = {},
    ) => {
      await AsyncStorage.setItem(
        PICKUPS_CACHE_KEY,
        JSON.stringify({
          driverId: driver?.id ? String(driver.id) : null,
          pendingPickups: nextPickups,
          assignedPickups: nextAssignedPickups,
          assignedScheduleStops: nextScheduleStops,
          driverRoutes: extra.driverRoutes ?? driverRoutesRef.current,
          overflowEvents: extra.overflowEvents ?? overflowEventsRef.current,
          preferredActiveRouteId: preferredActiveRouteIdRef.current,
          totalAssignedCount: assignedCount,
        }),
      );
    },
    [driver?.id],
  );

  const loadFromSupabase = useCallback(async () => {
    const requestSeq = ++loadRequestSeqRef.current;
    setLoadError(null);
    if (!driver?.id) {
      setPendingPickups([]);
      setAssignedPickups([]);
      setDriverRoutes([]);
      setOverflowEvents([]);
      setDismissedOverflowEventIds([]);
      setResolvedVehicleId(null);
      setAssignedScheduleStops([]);
      setIsUnloadingAtLandfill(false);
      setTotalAssignedCount(0);
      pendingPickupsRef.current = [];
      assignedPickupsRef.current = [];
      driverRoutesRef.current = [];
      overflowEventsRef.current = [];
      resolvedVehicleIdRef.current = null;
      preferredActiveRouteIdRef.current = null;
      totalAssignedCountRef.current = 0;
      routeIdsRef.current = new Set();
      setIsLoading(false);
      return null;
    }

    const driverIdStr = String(driver.id);

    let { data: routeRows, error: routesErr } = await supabase
      .from("routes")
      .select(
        "id, name, status, area_code, scheduled_days, shift_label, waste_category, optimization_method, started_at, completed_at, driver_id, vehicle_id, center_lat, center_lng, created_at, generated_at, assignment_updated_at, distance_km, duration_minutes",
      )
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false });

    if (
      routesErr &&
      ["PGRST204", "42703"].includes(String(routesErr.code ?? ""))
    ) {
      ({ data: routeRows, error: routesErr } = await supabase
        .from("routes")
        .select("id, name, status, distance_km, duration_minutes, started_at, completed_at, created_at")
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false }));
    }

    if (requestSeq !== loadRequestSeqRef.current) return null;
    if (routesErr) {
      setLoadError(routesErr.message);
      setIsLoading(false);
      throw routesErr;
    }

    const rawRoutes = routeRows ?? [];
    const routeIds = rawRoutes.map((route) => route.id).filter(Boolean);
    let routeMetaById = new Map();
    if (routeIds.length > 0) {
      const { data: stopsMeta, error: stopsMetaErr } = await supabase
        .from("route_stops")
        .select("route_id, bins(location, barangay, area_code)")
        .in("route_id", routeIds);
      if (!stopsMetaErr && stopsMeta) {
        routeMetaById = stopsMeta.reduce((acc, stop) => {
          const key = String(stop.route_id);
          const current = acc.get(key) ?? { stopCount: 0, areas: [], barangays: [], areaCodes: [] };
          current.stopCount += 1;
          const location = stop.bins?.location;
          const brgy = stop.bins?.barangay;
          const areaCode = stop.bins?.area_code;
          if (brgy && !current.barangays.includes(brgy)) current.barangays.push(brgy);
          if (location && !current.areas.includes(location)) current.areas.push(location);
          if (areaCode && !current.areaCodes.includes(areaCode)) current.areaCodes.push(areaCode);
          acc.set(key, current);
          return acc;
        }, new Map());
      }
    }

    const routesList = rawRoutes.map((route) => {
      const meta = routeMetaById.get(String(route.id)) ?? { stopCount: 0, areas: [], barangays: [], areaCodes: [] };
      return {
        ...route,
        stopCount: meta.stopCount,
        areas: meta.barangays.length > 0 ? meta.barangays : meta.areas,
        inferredAreaCode: route.area_code || meta.areaCodes[0] || null,
      };
    });

    // Resolve driver's effective vehicle ID across assigned_vehicle_id, open routes, and vehicles.driver_id
    let effectiveVehicleId = normalizeNonEmptyId(driver.assigned_vehicle_id);
    if (!effectiveVehicleId) {
      const openRouteWithVeh = routesList.find(
        (r) => isOpenRouteStatus(r.status) && normalizeNonEmptyId(r.vehicle_id) != null,
      );
      effectiveVehicleId = normalizeNonEmptyId(openRouteWithVeh?.vehicle_id);
    }
    if (!effectiveVehicleId) {
      const { data: vehRows } = await supabase
        .from("vehicles")
        .select("id")
        .eq("driver_id", driverIdStr)
        .limit(1);
      effectiveVehicleId = normalizeNonEmptyId(vehRows?.[0]?.id);
    }

    // Fetch driver's relevant overflow_events even when they have 0 assigned regular routes
    const orFilters = [`target_driver_id.eq.${driverIdStr}`, `source_driver_id.eq.${driverIdStr}`];
    if (effectiveVehicleId) {
      orFilters.push(`target_vehicle_id.eq.${effectiveVehicleId}`);
      orFilters.push(`source_vehicle_id.eq.${effectiveVehicleId}`);
    }
    const { data: rawOverflowRows, error: overflowErr } = await queryOverflowEventsWithFallback((cols) =>
      supabase
        .from("overflow_events")
        .select(cols)
        .or(orFilters.join(","))
        .order("created_at", { ascending: false })
        .limit(30),
    );

    if (requestSeq !== loadRequestSeqRef.current) return null;

    const scopedOverflowEvents = !overflowErr && Array.isArray(rawOverflowRows)
      ? rawOverflowRows.filter(
          (ev) =>
            eventBelongsToDriverAsTarget(ev, driverIdStr, effectiveVehicleId) ||
            eventBelongsToDriverAsSource(ev, driverIdStr, effectiveVehicleId),
        )
      : overflowEventsRef.current;

    // Clear stale local dismissals if event returned to dispatched state or disappeared
    setDismissedOverflowEventIds((prev) =>
      prev.filter((id) =>
        scopedOverflowEvents.some((ev) => String(ev.id) === String(id) && normalizeRouteStatus(ev.status) !== "dispatched"),
      ),
    );

    const assignedRouteIds = routesList
      .filter((r) => isOpenRouteStatus(r.status))
      .map((r) => String(r.id));

    if (assignedRouteIds.length === 0) {
      driverRoutesRef.current = routesList;
      overflowEventsRef.current = scopedOverflowEvents;
      resolvedVehicleIdRef.current = effectiveVehicleId;
      pendingPickupsRef.current = [];
      assignedPickupsRef.current = [];
      totalAssignedCountRef.current = 0;
      routeIdsRef.current = new Set();

      setDriverRoutes(routesList);
      setOverflowEvents(scopedOverflowEvents);
      setResolvedVehicleId(effectiveVehicleId);
      setPendingPickups([]);
      setAssignedPickups([]);
      setAssignedScheduleStops([]);
      setTotalAssignedCount(0);
      await persistCache([], 0, [], [], {
        driverRoutes: routesList,
        overflowEvents: scopedOverflowEvents,
      });
      setLoadError(null);
      setIsLoading(false);
      return {
        routesList,
        overflowEvents: scopedOverflowEvents,
        pendingPickups: [],
        assignedPickups: [],
      };
    }

    const { data: deliveries, error } = await supabase
      .from("deliveries")
      .select(
        "id, route_id, bin_id, status, eta, due_label, has_delay, completed_at, routes(name, area_code, shift_label, waste_category), bins(id, code, location, barangay, area_code, schedule_days, schedule_time_window, waste_category, collection_status, coordinate_status, latitude, longitude, is_active, status)",
      )
      .eq("driver_id", driver.id)
      .in("route_id", assignedRouteIds)
      .order("updated_at", { ascending: false });

    if (requestSeq !== loadRequestSeqRef.current) return null;
    if (error) {
      setLoadError(error.message);
      setIsLoading(false);
      throw error;
    }

    const list = deliveries ?? [];
    const deliveryRouteIds = [...new Set(list.map((d) => d.route_id).filter(Boolean))];

    let stopRows = [];
    if (deliveryRouteIds.length > 0) {
      const { data: rs, error: rsErr } = await supabase
        .from("route_stops")
        .select("route_id, bin_id, stop_order")
        .in("route_id", deliveryRouteIds)
        .order("stop_order", { ascending: true });
      if (!rsErr && rs) stopRows = rs;
    }

    const stopKey = (routeId, binId) => `${String(routeId)}::${String(binId)}`;
    const orderMap = new Map(stopRows.map((s) => [stopKey(s.route_id, s.bin_id), Number(s.stop_order) ?? 9999]));

    const rawMapped = list
      .map((d) => {
        const bo = orderMap.get(stopKey(d.route_id, d.bin_id)) ?? 9999;
        return mapDeliveryToPickup(d, bo);
      })
      .filter(Boolean);

    // Order each route's stops respecting accepted overflow sequence first, then route_stops.stop_order
    const acceptedForDriver = scopedOverflowEvents.filter(
      (ev) =>
        normalizeRouteStatus(ev.status) === "accepted" &&
        eventBelongsToDriverAsTarget(ev, driverIdStr, effectiveVehicleId),
    );
    const pickupsByRoute = new Map();
    for (const p of rawMapped) {
      const key = String(p.routeId);
      if (!pickupsByRoute.has(key)) pickupsByRoute.set(key, []);
      pickupsByRoute.get(key).push(p);
    }

    const allMapped = [];
    for (const [routeIdKey, routePickups] of pickupsByRoute.entries()) {
      const matchedRoute = routesList.find((r) => String(r.id) === routeIdKey) ?? { id: routeIdKey };
      const linkedOv = resolveLinkedOverflowEvent(matchedRoute, acceptedForDriver, routePickups);
      allMapped.push(...sortPickupsForActiveRoute(routePickups, linkedOv));
    }

    const activeAreaCodes = [
      ...new Set(
        [
          ...routesList
            .filter((r) => assignedRouteIds.includes(String(r.id)))
            .map((r) => r.inferredAreaCode),
          ...allMapped.map((m) => m.areaCode),
        ].filter(Boolean),
      ),
    ];
    let scheduleRows = [];
    if (activeAreaCodes.length > 0) {
      const { data: schedData, error: schedErr } = await supabase
        .from("collection_schedules")
        .select(
          "id, area_code, area_name, shift_label, stop_order, location_name, stop_type, barangay, days_of_week, day_times, scheduled_time, waste_category, special_instructions, bin_id, coordinate_status",
        )
        .in("area_code", activeAreaCodes)
        .eq("is_active", true)
        .order("area_code", { ascending: true })
        .order("stop_order", { ascending: true });
      if (!schedErr && schedData) {
        scheduleRows = schedData;
      }
    }

    if (requestSeq !== loadRequestSeqRef.current) return null;

    const mapped = allMapped.filter((pickup) => normalizeRouteStatus(pickup.deliveryStatus) !== "completed");
    const assignedCount = allMapped.length;
    routeIdsRef.current = new Set([
      ...assignedRouteIds,
      ...allMapped.map((m) => String(m.routeId)).filter(Boolean),
    ]);
    driverRoutesRef.current = routesList;
    overflowEventsRef.current = scopedOverflowEvents;
    resolvedVehicleIdRef.current = effectiveVehicleId;
    pendingPickupsRef.current = mapped;
    assignedPickupsRef.current = allMapped;
    totalAssignedCountRef.current = assignedCount;

    setDriverRoutes(routesList);
    setOverflowEvents(scopedOverflowEvents);
    setResolvedVehicleId(effectiveVehicleId);
    setPendingPickups(mapped);
    setAssignedPickups(allMapped);
    setAssignedScheduleStops(scheduleRows);
    setTotalAssignedCount(assignedCount);
    await persistCache(mapped, assignedCount, allMapped, scheduleRows, {
      driverRoutes: routesList,
      overflowEvents: scopedOverflowEvents,
    });
    setLoadError(null);
    setIsLoading(false);

    return {
      routesList,
      overflowEvents: scopedOverflowEvents,
      pendingPickups: mapped,
      assignedPickups: allMapped,
    };
  }, [driver?.assigned_vehicle_id, driver?.id, persistCache]);

  const executeQueuedMutation = useCallback(async (mutation) => {
    if (mutation.type === "COMPLETE_DELIVERY") {
      const { error } = await supabase
        .from("deliveries")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", mutation.deliveryId);
      if (error) throw error;
      if (mutation.binId) {
        await supabase.from("bins").update({ collection_status: "completed" }).eq("id", mutation.binId);
      }
    }
  }, []);

  useEffect(() => {
    let cleanup = () => {};

    const boot = async () => {
      await hydrateFromCache();
      try {
        await loadFromSupabase();
      } catch (error) {
        console.warn("Failed loading deliveries from Supabase:", error?.message);
        setLoadError(error?.message ?? "Failed loading deliveries");
        setIsLoading(false);
      }
      await flushOfflineQueue(executeQueuedMutation);
      cleanup = subscribeConnectivity(executeQueuedMutation, () => {
        void loadFromSupabase().catch(() => {});
      });
    };

    boot();
    return () => cleanup();
  }, [executeQueuedMutation, hydrateFromCache, loadFromSupabase]);

  // Foreground resume & Supabase Realtime sync (including overflow_events)
  useEffect(() => {
    if (!driver?.id) return undefined;

    const safeReload = async () => {
      try {
        await flushOfflineQueue(executeQueuedMutation);
        await loadFromSupabase();
      } catch (error) {
        console.warn("Realtime/foreground refresh failed:", error?.message);
      }
    };

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void safeReload();
      }
    });

    const channel = supabase
      .channel(`driver-nav-${driver.id}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deliveries", filter: `driver_id=eq.${driver.id}` },
        () => void safeReload(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "route_stops" }, (payload) => {
        const rid = payload.new?.route_id ?? payload.old?.route_id;
        if (rid != null && routeIdsRef.current.has(String(rid))) void safeReload();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "routes", filter: `driver_id=eq.${driver.id}` },
        () => void safeReload(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "overflow_events" }, (payload) => {
        const newRec = payload?.new;
        const oldRec = payload?.old;
        const vehId = resolvedVehicleIdRef.current ?? driver?.assigned_vehicle_id;
        if (newRec?.id && normalizeRouteStatus(newRec.status) === "dispatched") {
          setDismissedOverflowEventIds((prev) => prev.filter((id) => String(id) !== String(newRec.id)));
        }
        const touchedThisDriver =
          (newRec &&
            (eventBelongsToDriverAsTarget(newRec, driver.id, vehId) ||
              eventBelongsToDriverAsSource(newRec, driver.id, vehId))) ||
          (oldRec &&
            (eventBelongsToDriverAsTarget(oldRec, driver.id, vehId) ||
              eventBelongsToDriverAsSource(oldRec, driver.id, vehId))) ||
          overflowEventsRef.current.some((ev) => String(ev.id) === String(newRec?.id ?? oldRec?.id));
        if (touchedThisDriver) {
          void safeReload();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bins" }, () => {
        if (routeIdsRef.current.size > 0) void safeReload();
      })
      .subscribe();

    return () => {
      appStateSub.remove();
      supabase.removeChannel(channel);
    };
  }, [driver?.assigned_vehicle_id, driver?.id, executeQueuedMutation, loadFromSupabase]);

  const syncCompletedOverflowEvents = useCallback(
    async ({ routeId = null, markRouteAccepted = false, remainingPending = pendingPickupsRef.current } = {}) => {
      if (!driver?.id) return;
      try {
        const { data: acceptedEvents, error } = await supabase
          .from("overflow_events")
          .select("id, overflow_bins, target_route_id, reassignment_metadata")
          .eq("target_driver_id", String(driver.id))
          .eq("status", "accepted");
        if (error || !acceptedEvents || acceptedEvents.length === 0) return;

        const remainingBinIds = new Set(remainingPending.map((p) => String(p.binId)));
        const idsToComplete = acceptedEvents
          .filter((ev) => {
            const evRouteId = getEventTargetRouteId(ev);
            if (markRouteAccepted && routeId != null && evRouteId && String(evRouteId) === String(routeId)) {
              return true;
            }
            const evBinIds = extractOverflowBinIds(ev.overflow_bins);
            if (evBinIds.length === 0) return markRouteAccepted && !routeId;
            return evBinIds.every((bid) => !remainingBinIds.has(bid));
          })
          .map((ev) => ev.id);

        if (idsToComplete.length > 0) {
          await supabase
            .from("overflow_events")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .in("id", idsToComplete);
        }
      } catch {
        /* non-fatal: dispatcher can also complete manually */
      }
    },
    [driver?.id],
  );

  const persistUnloadState = useCallback(
    async (nextUnloading) => {
      setIsUnloadingAtLandfill(nextUnloading);
      try {
        if (!driver?.id || !nextUnloading) {
          await AsyncStorage.removeItem(LANDFILL_UNLOAD_STATE_KEY);
        } else {
          await AsyncStorage.setItem(
            LANDFILL_UNLOAD_STATE_KEY,
            JSON.stringify({ driverId: String(driver.id), isUnloading: true }),
          );
        }
      } catch {
        /* non-fatal storage error */
      }
    },
    [driver?.id],
  );

  const completePickup = useCallback(
    async (deliveryId, binId) => {
      const matchDelivery = (pickup) =>
        deliveryId ? String(pickup.deliveryId) === String(deliveryId) : String(pickup.binId) === String(binId);

      const target =
        pendingPickupsRef.current.find(matchDelivery) ??
        assignedPickupsRef.current.find(matchDelivery);
      const targetDeliveryId = target?.deliveryId ?? deliveryId;
      const targetBinId = target?.binId ?? binId;
      const completedAt = new Date().toISOString();

      setPendingPickups((prev) => prev.filter((p) => !matchDelivery(p)));
      setAssignedPickups((prev) =>
        prev.map((p) =>
          matchDelivery(p)
            ? { ...p, deliveryStatus: "completed", completedAt }
            : p,
        ),
      );

      const nextPending = pendingPickupsRef.current.filter((p) => !matchDelivery(p));
      const nextAssigned = assignedPickupsRef.current.map((p) =>
        matchDelivery(p)
          ? { ...p, deliveryStatus: "completed", completedAt }
          : p,
      );
      pendingPickupsRef.current = nextPending;
      assignedPickupsRef.current = nextAssigned;

      try {
        await persistCache(nextPending, totalAssignedCountRef.current, nextAssigned, assignedScheduleStops);
      } catch (err) {
        console.warn("Failed persisting pickup cache:", err?.message);
      }

      if (targetDeliveryId) {
        try {
          const state = await NetInfo.fetch();
          if (state.isConnected) {
            try {
              await executeQueuedMutation({ type: "COMPLETE_DELIVERY", deliveryId: targetDeliveryId, binId: targetBinId });
              await syncCompletedOverflowEvents({
                routeId: target?.routeId ?? null,
                remainingPending: nextPending,
              });
            } catch (error) {
              console.warn("Online completion failed, queueing offline mutation:", error?.message);
              await enqueueMutation({ type: "COMPLETE_DELIVERY", deliveryId: targetDeliveryId, binId: targetBinId });
            }
          } else {
            await enqueueMutation({ type: "COMPLETE_DELIVERY", deliveryId: targetDeliveryId, binId: targetBinId });
          }
        } catch (err) {
          console.warn("Network check error, queueing offline mutation:", err?.message);
          await enqueueMutation({ type: "COMPLETE_DELIVERY", deliveryId: targetDeliveryId, binId: targetBinId });
        }
      }
    },
    [assignedScheduleStops, executeQueuedMutation, persistCache, syncCompletedOverflowEvents],
  );

  const acceptOverflowDispatch = useCallback(
    async (overflowEvent) => {
      if (!driver?.id || !overflowEvent?.id) {
        throw new Error("Driver profile or overflow event missing.");
      }
      const eventId = overflowEvent.id;
      if (acceptingEventIdsRef.current.has(eventId)) return null;
      acceptingEventIdsRef.current.add(eventId);

      try {
        const targetDriverId = String(driver.id);
        const targetVehicleId = normalizeNonEmptyId(resolvedVehicleIdRef.current ?? driver?.assigned_vehicle_id);

        const { data: latestEvent, error: fetchErr } = await queryOverflowEventsWithFallback((cols) =>
          supabase
            .from("overflow_events")
            .select(cols)
            .eq("id", eventId)
            .single(),
        );

        if (fetchErr || !latestEvent) {
          throw new Error("Unable to retrieve overflow event details. Please try again.");
        }

        const latestStatus = normalizeRouteStatus(latestEvent.status);
        if (latestStatus === "accepted") {
          const existingRouteId = getEventTargetRouteId(latestEvent);
          if (eventBelongsToDriverAsTarget(latestEvent, driver.id, targetVehicleId) && existingRouteId) {
            preferredActiveRouteIdRef.current = existingRouteId;
            await persistUnloadState(false);
            await loadFromSupabase();
            return { targetRouteId: existingRouteId, alreadyAccepted: true };
          }
          await loadFromSupabase();
          throw new Error("This overflow request has already been accepted.");
        }

        if (latestStatus === "declined" || latestStatus === "completed") {
          await loadFromSupabase();
          throw new Error(`This overflow request is ${latestEvent.status}.`);
        }

        // Always pass p_target_route_id = null so accept_overflow_event uses a dedicated
        // 'Overflow Assistance Route' without overwriting or modifying any regular route.
        const { data: rpcResult, error: rpcError } = await supabase.rpc("accept_overflow_event", {
          p_event_id: eventId,
          p_target_driver_id: targetDriverId,
          p_target_vehicle_id: targetVehicleId,
          p_target_route_id: null,
        });

        if (rpcError) {
          throw new Error(rpcError.message || "Unable to accept overflow request.");
        }
        if (!rpcResult || rpcResult.success !== true) {
          const errMsg = String(rpcResult?.error || "Unable to accept overflow request.");
          if (errMsg.toLowerCase().includes("already been accepted")) {
            await loadFromSupabase();
          }
          throw new Error(errMsg);
        }

        const createdRouteId = normalizeNonEmptyId(rpcResult.target_route_id ?? rpcResult.route_id);
        if (!createdRouteId) {
          throw new Error("Overflow acceptance did not return a valid route ID.");
        }

        preferredActiveRouteIdRef.current = createdRouteId;
        await persistUnloadState(false);

        try {
          await insertNotificationWithFallback(supabase, {
            role: "dispatcher",
            title: "Overflow Accepted",
            message: `${driver?.name || "Driver"} accepted overflow assistance (${latestEvent.bins_count || extractOverflowBinIds(latestEvent.overflow_bins).length} stops).`,
            type: "success",
            category: "truck",
            source_table: "overflow_events",
            read: false,
            created_at: new Date().toISOString(),
          });
        } catch (notifErr) {
          console.warn("Overflow accept notification note:", notifErr?.message);
        }

        await loadFromSupabase();
        return { targetRouteId: createdRouteId, rpcResult };
      } finally {
        acceptingEventIdsRef.current.delete(eventId);
      }
    },
    [driver?.assigned_vehicle_id, driver?.id, driver?.name, loadFromSupabase, persistUnloadState],
  );

  const declineOverflowDispatch = useCallback(
    async (overflowEvent, driverNameOverride = null) => {
      if (!driver?.id || !overflowEvent?.id) return;
      const { error } = await supabase
        .from("overflow_events")
        .update({ status: "declined" })
        .eq("id", overflowEvent.id);
      if (error) throw error;

      setDismissedOverflowEventIds((prev) => [...new Set([...prev, String(overflowEvent.id)])]);

      try {
        await insertNotificationWithFallback(supabase, {
          role: "dispatcher",
          title: "Overflow Declined",
          message: `${driverNameOverride || driver?.name || "Driver"} declined overflow assistance of ${overflowEvent.bins_count} stops. Dispatcher re-routing required.`,
          type: "warning",
          category: "truck",
          source_table: "overflow_events",
          read: false,
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.warn("Overflow decline notification note:", notifErr?.message);
      }

      await loadFromSupabase();
    },
    [driver?.id, driver?.name, loadFromSupabase],
  );

  const acceptRoute = useCallback(
    async (routeId) => {
      if (!driver?.id) return;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("routes")
        .update({ status: "active", assignment_updated_at: now })
        .eq("id", routeId)
        .eq("driver_id", driver.id)
        .in("status", ["pending", "planned"]);
      if (error) throw error;
      preferredActiveRouteIdRef.current = normalizeNonEmptyId(routeId);
      await updateDriverRouteStatus(driver.id, "available", now);
      await loadFromSupabase();
    },
    [driver?.id, loadFromSupabase],
  );

  const startRoute = useCallback(
    async (routeId) => {
      if (!driver?.id) return;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("routes")
        .update({ started_at: now })
        .eq("id", routeId)
        .eq("driver_id", driver.id)
        .eq("status", "active");
      if (error) throw error;
      preferredActiveRouteIdRef.current = normalizeNonEmptyId(routeId);
      await updateDriverRouteStatus(driver.id, "on_route", now);
      await loadFromSupabase();
    },
    [driver?.id, loadFromSupabase],
  );

  const resolveCurrentVehicleId = useCallback(
    (routeId) => {
      if (routeId != null) {
        const matched = driverRoutes.find((r) => String(r.id) === String(routeId));
        if (matched?.vehicle_id != null) return matched.vehicle_id;
      }
      const activeOrPending = driverRoutes.find((r) => isOpenRouteStatus(r.status));
      return activeOrPending?.vehicle_id ?? resolvedVehicleId ?? driver?.assigned_vehicle_id ?? null;
    },
    [driver?.assigned_vehicle_id, driverRoutes, resolvedVehicleId],
  );

  const startLandfillUnload = useCallback(async () => {
    if (!driver?.id) return;
    const vehicleId = resolveCurrentVehicleId();
    if (vehicleId) {
      await supabase.from("vehicles").update({ status: "unloading" }).eq("id", vehicleId);
    }
    await persistUnloadState(true);
  }, [driver?.id, persistUnloadState, resolveCurrentVehicleId]);

  const completeLandfillUnload = useCallback(async () => {
    if (!driver?.id) return;
    const vehicleId = resolveCurrentVehicleId();
    if (vehicleId) {
      const { error: vehErr } = await updateVehicleWithFallback(supabase, vehicleId, {
        status: "active",
        load_percent: 0,
      });
      if (vehErr) throw vehErr;
    }
    await supabase.from("drivers").update({ status: "on_route" }).eq("id", driver.id);
    await persistUnloadState(false);
    await loadFromSupabase();
  }, [driver?.id, loadFromSupabase, persistUnloadState, resolveCurrentVehicleId]);

  const completeRoute = useCallback(
    async (routeId) => {
      if (!driver?.id) return;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("routes")
        .update({ status: "completed", completed_at: now })
        .eq("id", routeId)
        .eq("driver_id", driver.id);
      if (error) throw error;

      // Preserve any still-open regular collection route when finishing an Overflow Assistance Route
      const remainingOpenRoute =
        driverRoutesRef.current.find(
          (r) => String(r.id) !== String(routeId) && isOpenRouteStatus(r.status),
        ) ?? null;

      if (String(preferredActiveRouteIdRef.current) === String(routeId)) {
        preferredActiveRouteIdRef.current = remainingOpenRoute ? String(remainingOpenRoute.id) : null;
      }

      const vehicleId = resolveCurrentVehicleId(routeId);
      if (vehicleId) {
        try {
          await updateVehicleWithFallback(supabase, vehicleId, {
            status: remainingOpenRoute ? "on_route" : "active",
            route_id: remainingOpenRoute ? String(remainingOpenRoute.id) : null,
            load_percent: 0,
          });
        } catch (_) {}
      }

      await updateDriverRouteStatus(
        driver.id,
        remainingOpenRoute?.started_at ? "on_route" : "available",
        now,
      );
      await syncCompletedOverflowEvents({
        routeId,
        markRouteAccepted: true,
        remainingPending: pendingPickupsRef.current.filter((p) => String(p.routeId) !== String(routeId)),
      });
      await persistUnloadState(false);
      await loadFromSupabase();
    },
    [driver?.id, loadFromSupabase, persistUnloadState, resolveCurrentVehicleId, syncCompletedOverflowEvents],
  );

  const syncState = useMemo(
    () =>
      formatOverflowSyncState({
        driverId: driver?.id,
        vehicleId: resolvedVehicleId ?? driver?.assigned_vehicle_id,
        driverRoutes,
        overflowEvents,
        allPickups: assignedPickups,
        preferredRouteId: preferredActiveRouteIdRef.current,
      }),
    [assignedPickups, driver?.assigned_vehicle_id, driver?.id, driverRoutes, overflowEvents, resolvedVehicleId],
  );

  const incomingOverflowEvent = useMemo(() => {
    const ev = syncState.incomingOverflowEvent;
    if (!ev) return null;
    if (dismissedOverflowEventIds.includes(String(ev.id))) return null;
    return ev;
  }, [dismissedOverflowEventIds, syncState.incomingOverflowEvent]);

  const setIncomingOverflowEvent = useCallback((nextValue) => {
    if (!nextValue) {
      const currentIncomingId = syncState.incomingOverflowEvent?.id;
      if (currentIncomingId) {
        setDismissedOverflowEventIds((prev) => [...new Set([...prev, String(currentIncomingId)])]);
      }
    }
  }, [syncState.incomingOverflowEvent?.id]);

  const getTotalPickups = useCallback(() => totalAssignedCount, [totalAssignedCount]);

  const getRemainingPickups = useCallback(() => pendingPickups.length, [pendingPickups]);

  const getCompletedPickups = useCallback(
    () => Math.max(0, totalAssignedCount - pendingPickups.length),
    [pendingPickups.length, totalAssignedCount],
  );

  const value = {
    pendingPickups,
    assignedPickups,
    driverRoutes,
    overflowEvents,
    resolvedVehicleId,
    currentRoute: syncState.currentRoute,
    routeState: syncState.routeState,
    routeAssignedPickups: syncState.routeAssignedPickups,
    routePendingPickups: syncState.routePendingPickups,
    activeOverflowEvent: syncState.activeOverflowEvent,
    activeSourceOverflowEvent: syncState.activeSourceOverflowEvent,
    incomingOverflowEvent,
    setIncomingOverflowEvent,
    isOverflowRouteActive: syncState.isOverflowRouteActive,
    acceptOverflowDispatch,
    declineOverflowDispatch,
    assignedScheduleStops,
    isUnloadingAtLandfill,
    startLandfillUnload,
    completeLandfillUnload,
    completePickup,
    acceptRoute,
    startRoute,
    completeRoute,
    getTotalPickups,
    getRemainingPickups,
    getCompletedPickups,
    isLoading,
    loadError,
    reloadPickups: loadFromSupabase,
  };

  return <PickupContext.Provider value={value}>{children}</PickupContext.Provider>;
};
