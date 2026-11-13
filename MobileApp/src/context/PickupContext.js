import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { supabase } from "../lib/supabase";
import { enqueueMutation, flushOfflineQueue, subscribeConnectivity } from "../services/offlineSync";
import { updateVehicleWithFallback } from "../utils/schemaFallback";
import { useAuth } from "./AuthContext";

const PickupContext = createContext();
const PICKUPS_CACHE_KEY = "pickups_cache_v2";
const LANDFILL_UNLOAD_STATE_KEY = "landfill_unload_state_v1";

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

function normalizeRouteStatus(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

async function updateDriverRouteStatus(driverId, status, timestamp) {
  const { error } = await supabase.from("drivers").update({ status, last_seen_at: timestamp }).eq("id", driverId);
  if (error) throw error;
}

export const PickupProvider = ({ children }) => {
  const { driver } = useAuth();
  const [pendingPickups, setPendingPickups] = useState([]);
  const [assignedPickups, setAssignedPickups] = useState([]);
  const [driverRoutes, setDriverRoutes] = useState([]);
  const [assignedScheduleStops, setAssignedScheduleStops] = useState([]);
  const [isUnloadingAtLandfill, setIsUnloadingAtLandfill] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [totalAssignedCount, setTotalAssignedCount] = useState(0);
  const routeIdsRef = useRef(new Set());
  const pendingPickupsRef = useRef([]);
  const assignedPickupsRef = useRef([]);
  const totalAssignedCountRef = useRef(0);

  useEffect(() => {
    pendingPickupsRef.current = pendingPickups;
  }, [pendingPickups]);

  useEffect(() => {
    assignedPickupsRef.current = assignedPickups;
  }, [assignedPickups]);

  useEffect(() => {
    totalAssignedCountRef.current = totalAssignedCount;
  }, [totalAssignedCount]);

  const hydrateFromCache = useCallback(async () => {
    try {
      const unloadRaw = await AsyncStorage.getItem(LANDFILL_UNLOAD_STATE_KEY);
      if (unloadRaw) {
        const parsedUnload = JSON.parse(unloadRaw);
        if (parsedUnload?.driverId != null && String(parsedUnload.driverId) === String(driver?.id)) {
          setIsUnloadingAtLandfill(Boolean(parsedUnload.isUnloading));
        }
      }
    } catch {
      /* ignore unload cache read error */
    }
    const cache = await AsyncStorage.getItem(PICKUPS_CACHE_KEY);
    if (!cache) return;
    try {
      const parsed = JSON.parse(cache);
      const pending = parsed.pendingPickups ?? [];
      const assigned = parsed.assignedPickups ?? parsed.pendingPickups ?? [];
      const scheduleStops = parsed.assignedScheduleStops ?? [];
      const total = parsed.totalAssignedCount ?? parsed.pendingPickups?.length ?? 0;
      pendingPickupsRef.current = pending;
      assignedPickupsRef.current = assigned;
      totalAssignedCountRef.current = total;
      setPendingPickups(pending);
      setAssignedPickups(assigned);
      setAssignedScheduleStops(scheduleStops);
      setTotalAssignedCount(total);
      routeIdsRef.current = new Set(assigned.map((p) => String(p.routeId)).filter(Boolean));
    } catch (error) {
      console.warn("Failed parsing pickup cache:", error?.message);
    }
  }, []);

  const persistCache = useCallback(
    async (nextPickups, assignedCount, nextAssignedPickups = nextPickups, nextScheduleStops = []) => {
      await AsyncStorage.setItem(
        PICKUPS_CACHE_KEY,
        JSON.stringify({
          pendingPickups: nextPickups,
          assignedPickups: nextAssignedPickups,
          assignedScheduleStops: nextScheduleStops,
          totalAssignedCount: assignedCount,
        }),
      );
    },
    [],
  );

  const loadFromSupabase = useCallback(async () => {
    setLoadError(null);
      if (!driver?.id) {
      setPendingPickups([]);
      setAssignedPickups([]);
      setDriverRoutes([]);
      setAssignedScheduleStops([]);
      setIsUnloadingAtLandfill(false);
      setTotalAssignedCount(0);
      pendingPickupsRef.current = [];
      assignedPickupsRef.current = [];
      totalAssignedCountRef.current = 0;
      routeIdsRef.current = new Set();
      setIsLoading(false);
      return;
    }

    const { data: routeRows, error: routesErr } = await supabase
      .from("routes")
      .select(
        "id, name, status, area_code, scheduled_days, shift_label, waste_category, started_at, completed_at, driver_id, vehicle_id, center_lat, center_lng, created_at, generated_at, assignment_updated_at, distance_km, duration_minutes",
      )
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false });

    if (routesErr) {
      setLoadError(routesErr.message);
      setIsLoading(false);
      throw routesErr;
    }
    const routeIds = (routeRows ?? []).map((route) => route.id).filter(Boolean);
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

    const routesList = (routeRows ?? []).map((route) => {
      const meta = routeMetaById.get(String(route.id)) ?? { stopCount: 0, areas: [], barangays: [], areaCodes: [] };
      return {
        ...route,
        stopCount: meta.stopCount,
        areas: meta.barangays.length > 0 ? meta.barangays : meta.areas,
        inferredAreaCode: route.area_code || meta.areaCodes[0] || null,
      };
    });
    setDriverRoutes(routesList);

    const assignedRouteIds = routesList
      .filter((r) => ["active", "pending", "planned"].includes(normalizeRouteStatus(r.status)))
      .map((r) => String(r.id));

    if (assignedRouteIds.length === 0) {
      setPendingPickups([]);
      setAssignedPickups([]);
      setAssignedScheduleStops([]);
      setTotalAssignedCount(0);
      pendingPickupsRef.current = [];
      assignedPickupsRef.current = [];
      totalAssignedCountRef.current = 0;
      routeIdsRef.current = new Set();
      await persistCache([], 0, [], []);
      setLoadError(null);
      setIsLoading(false);
      return;
    }

    const { data: deliveries, error } = await supabase
      .from("deliveries")
      .select(
        "id, route_id, bin_id, status, eta, due_label, has_delay, completed_at, routes(name, area_code, shift_label, waste_category), bins(id, code, location, barangay, area_code, schedule_days, schedule_time_window, waste_category, collection_status, coordinate_status, latitude, longitude, is_active, status)",
      )
      .eq("driver_id", driver.id)
      .in("route_id", assignedRouteIds)
      .order("updated_at", { ascending: false });

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

    const allMapped = list
      .map((d) => {
        const bo = orderMap.get(stopKey(d.route_id, d.bin_id)) ?? 9999;
        return mapDeliveryToPickup(d, bo);
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (String(a.routeId) !== String(b.routeId)) return String(a.routeId).localeCompare(String(b.routeId));
        return a.stopOrder - b.stopOrder;
      });

    // Fetch official SWMO collection_schedules rows for the driver's active/pending route area(s)
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

    const mapped = allMapped.filter((pickup) => normalizeRouteStatus(pickup.deliveryStatus) !== "completed");
    const assignedCount = allMapped.length;
    routeIdsRef.current = new Set(allMapped.map((m) => String(m.routeId)).filter(Boolean));
    pendingPickupsRef.current = mapped;
    assignedPickupsRef.current = allMapped;
    totalAssignedCountRef.current = assignedCount;
    setPendingPickups(mapped);
    setAssignedPickups(allMapped);
    setAssignedScheduleStops(scheduleRows);
    setTotalAssignedCount(assignedCount);
    await persistCache(mapped, assignedCount, allMapped, scheduleRows);
    setLoadError(null);
    setIsLoading(false);
  }, [driver?.id, persistCache]);

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
        try {
          loadFromSupabase();
        } catch {
          /* safe reload */
        }
      });
    };

    boot();
    return () => cleanup();
  }, [executeQueuedMutation, hydrateFromCache, loadFromSupabase]);

  useEffect(() => {
    if (!driver?.id) return undefined;

    const safeReload = async () => {
      try {
        await loadFromSupabase();
      } catch (error) {
        console.warn("Realtime refresh failed:", error?.message);
      }
    };

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
      .on("postgres_changes", { event: "*", schema: "public", table: "bins" }, () => {
        if (routeIdsRef.current.size > 0) void safeReload();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, loadFromSupabase]);

  const syncCompletedOverflowEvents = useCallback(
    async ({ markAllAccepted = false, remainingPending = pendingPickupsRef.current } = {}) => {
      if (!driver?.id) return;
      try {
        const { data: acceptedEvents, error } = await supabase
          .from("overflow_events")
          .select("id, overflow_bins")
          .eq("target_driver_id", String(driver.id))
          .eq("status", "accepted");
        if (error || !acceptedEvents || acceptedEvents.length === 0) return;

        const remainingBinIds = new Set(remainingPending.map((p) => String(p.binId)));
        const idsToComplete = acceptedEvents
          .filter((ev) => {
            if (markAllAccepted) return true;
            const binsList = Array.isArray(ev.overflow_bins) ? ev.overflow_bins : [];
            if (binsList.length === 0) return false;
            return binsList.every((b) => !remainingBinIds.has(String(b.bin_id)));
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

      // Pure functional state updates
      setPendingPickups((prev) => prev.filter((p) => !matchDelivery(p)));
      setAssignedPickups((prev) =>
        prev.map((p) =>
          matchDelivery(p)
            ? { ...p, deliveryStatus: "completed", completedAt }
            : p,
        ),
      );

      // Maintain ref snapshots immediately for consecutive calls
      const nextPending = pendingPickupsRef.current.filter((p) => !matchDelivery(p));
      const nextAssigned = assignedPickupsRef.current.map((p) =>
        matchDelivery(p)
          ? { ...p, deliveryStatus: "completed", completedAt }
          : p,
      );
      pendingPickupsRef.current = nextPending;
      assignedPickupsRef.current = nextAssigned;

      // Persistence side effect outside React state updaters
      try {
        await persistCache(nextPending, totalAssignedCountRef.current, nextAssigned, assignedScheduleStops);
      } catch (err) {
        console.warn("Failed persisting pickup cache:", err?.message);
      }

      // Network and offline queue mutation side effects outside state updaters
      if (targetDeliveryId) {
        try {
          const state = await NetInfo.fetch();
          if (state.isConnected) {
            try {
              await executeQueuedMutation({ type: "COMPLETE_DELIVERY", deliveryId: targetDeliveryId, binId: targetBinId });
              await syncCompletedOverflowEvents({ remainingPending: nextPending });
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
      await updateDriverRouteStatus(driver.id, "on_route", now);
      await loadFromSupabase();
    },
    [driver?.id, loadFromSupabase],
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

  const resolveCurrentVehicleId = useCallback(
    (routeId) => {
      if (routeId != null) {
        const matched = driverRoutes.find((r) => String(r.id) === String(routeId));
        if (matched?.vehicle_id != null) return matched.vehicle_id;
      }
      const activeOrPending = driverRoutes.find((r) => r.status === "active" || r.status === "pending" || r.status === "planned");
      return activeOrPending?.vehicle_id ?? driver?.assigned_vehicle_id ?? null;
    },
    [driver?.assigned_vehicle_id, driverRoutes],
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
      const vehicleId = resolveCurrentVehicleId(routeId);
      if (vehicleId) {
        try {
          await updateVehicleWithFallback(supabase, vehicleId, {
            status: "active",
            route_id: null,
            load_percent: 0,
          });
        } catch (_) {}
      }
      await updateDriverRouteStatus(driver.id, "available", now);
      await syncCompletedOverflowEvents({ markAllAccepted: true });
      await persistUnloadState(false);
      await loadFromSupabase();
    },
    [driver?.id, loadFromSupabase, persistUnloadState, resolveCurrentVehicleId, syncCompletedOverflowEvents],
  );

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
