import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { supabase } from "../lib/supabase";
import { enqueueMutation, flushOfflineQueue, subscribeConnectivity } from "../services/offlineSync";
import { useAuth } from "./AuthContext";

const PickupContext = createContext();
const PICKUPS_CACHE_KEY = "pickups_cache_v2";

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
  const latitude = Number(bin.latitude);
  const longitude = Number(bin.longitude);
  if (!isValidCoordinate(latitude, longitude)) return null;

  return {
    deliveryId: delivery.id,
    binId: String(bin.id),
    id: bin.code ?? `Bin ${bin.id}`,
    street: bin.location ?? "Unknown Street",
    eta: delivery.eta ?? "Pending",
    coords: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    lat: latitude,
    lng: longitude,
    status: `Pending Pick-up - ${bin.location ?? "Unspecified"}`,
    due: delivery.due_label ?? "Scheduled",
    tagColor: "pillBlue",
    hasDelay: delivery.has_delay ?? false,
    address: bin.location ?? "Naga City",
    isValidated: true,
    accessibilityStatus: "accessible",
    routeName: delivery.routes?.name ?? "Assigned Route",
    routeId: delivery.route_id,
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
  const [driverRoutes, setDriverRoutes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalAssignedCount, setTotalAssignedCount] = useState(0);
  const routeIdsRef = useRef(new Set());

  const hydrateFromCache = useCallback(async () => {
    const cache = await AsyncStorage.getItem(PICKUPS_CACHE_KEY);
    if (!cache) return;
    try {
      const parsed = JSON.parse(cache);
      setPendingPickups(parsed.pendingPickups ?? []);
      setTotalAssignedCount(parsed.totalAssignedCount ?? parsed.pendingPickups?.length ?? 0);
      routeIdsRef.current = new Set((parsed.pendingPickups ?? []).map((p) => String(p.routeId)).filter(Boolean));
    } catch (error) {
      console.warn("Failed parsing pickup cache:", error?.message);
    }
  }, []);

  const persistCache = useCallback(async (nextPickups, assignedCount) => {
    await AsyncStorage.setItem(
      PICKUPS_CACHE_KEY,
      JSON.stringify({
        pendingPickups: nextPickups,
        totalAssignedCount: assignedCount,
      }),
    );
  }, []);

  const loadFromSupabase = useCallback(async () => {
    if (!driver?.id) {
      setPendingPickups([]);
      setDriverRoutes([]);
      setTotalAssignedCount(0);
      routeIdsRef.current = new Set();
      setIsLoading(false);
      return;
    }

    const { data: routeRows, error: routesErr } = await supabase
      .from("routes")
      .select("id, name, status, started_at, completed_at, driver_id, vehicle_id, created_at")
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false });

    if (routesErr) throw routesErr;
    const routesList = routeRows ?? [];
    setDriverRoutes(routesList);

    const activeRouteIds = routesList
      .filter((r) => normalizeRouteStatus(r.status) === "active")
      .map((r) => String(r.id));

    if (activeRouteIds.length === 0) {
      setPendingPickups([]);
      setTotalAssignedCount(0);
      routeIdsRef.current = new Set();
      await persistCache([], 0);
      setIsLoading(false);
      return;
    }

    const { data: deliveries, error } = await supabase
      .from("deliveries")
      .select("id, route_id, bin_id, status, eta, due_label, has_delay, routes(name), bins(id, code, location, latitude, longitude)")
      .eq("driver_id", driver.id)
      .in("route_id", activeRouteIds)
      .neq("status", "completed")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const list = deliveries ?? [];
    const routeIds = [...new Set(list.map((d) => d.route_id).filter(Boolean))];

    let stopRows = [];
    if (routeIds.length > 0) {
      const { data: rs, error: rsErr } = await supabase
        .from("route_stops")
        .select("route_id, bin_id, stop_order")
        .in("route_id", routeIds)
        .order("stop_order", { ascending: true });
      if (!rsErr && rs) stopRows = rs;
    }

    const stopKey = (routeId, binId) => `${String(routeId)}::${String(binId)}`;
    const orderMap = new Map(stopRows.map((s) => [stopKey(s.route_id, s.bin_id), Number(s.stop_order) ?? 9999]));

    const mapped = list
      .map((d) => {
        const bo = orderMap.get(stopKey(d.route_id, d.bin_id)) ?? 9999;
        return mapDeliveryToPickup(d, bo);
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (String(a.routeId) !== String(b.routeId)) return String(a.routeId).localeCompare(String(b.routeId));
        return a.stopOrder - b.stopOrder;
      });

    const assignedCount = mapped.length;
    routeIdsRef.current = new Set(mapped.map((m) => String(m.routeId)).filter(Boolean));
    setPendingPickups(mapped);
    setTotalAssignedCount(assignedCount);
    await persistCache(mapped, assignedCount);
    setIsLoading(false);
  }, [driver?.id, persistCache]);

  const executeQueuedMutation = useCallback(async (mutation) => {
    if (mutation.type === "COMPLETE_DELIVERY") {
      const { error } = await supabase
        .from("deliveries")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", mutation.deliveryId);
      if (error) throw error;
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
        setIsLoading(false);
      }
      await flushOfflineQueue(executeQueuedMutation);
      cleanup = subscribeConnectivity(executeQueuedMutation);
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

  const completePickup = useCallback(
    (binId) => {
      setPendingPickups((prev) => {
        const target = prev.find((pickup) => pickup.binId === binId);
        const next = prev.filter((pickup) => pickup.binId !== binId);
        persistCache(next, totalAssignedCount).catch(() => {});

        if (target?.deliveryId) {
          NetInfo.fetch().then(async (state) => {
            if (state.isConnected) {
              try {
                await executeQueuedMutation({ type: "COMPLETE_DELIVERY", deliveryId: target.deliveryId });
              } catch (error) {
                await enqueueMutation({ type: "COMPLETE_DELIVERY", deliveryId: target.deliveryId });
              }
            } else {
              await enqueueMutation({ type: "COMPLETE_DELIVERY", deliveryId: target.deliveryId });
            }
          });
        }
        return next;
      });
    },
    [executeQueuedMutation, persistCache, totalAssignedCount],
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

  const completeRoute = useCallback(
    async (routeId) => {
      if (!driver?.id) return;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("routes")
        .update({ status: "completed", completed_at: now })
        .eq("id", routeId)
        .eq("driver_id", driver.id)
        .eq("status", "active");
      if (error) throw error;
      await updateDriverRouteStatus(driver.id, "available", now);
      await loadFromSupabase();
    },
    [driver?.id, loadFromSupabase],
  );

  const getTotalPickups = useCallback(() => totalAssignedCount, [totalAssignedCount]);

  const getRemainingPickups = useCallback(() => pendingPickups.length, [pendingPickups]);

  const getCompletedPickups = useCallback(
    () => Math.max(0, totalAssignedCount - pendingPickups.length),
    [pendingPickups.length, totalAssignedCount],
  );

  const value = {
    pendingPickups,
    driverRoutes,
    completePickup,
    acceptRoute,
    startRoute,
    completeRoute,
    getTotalPickups,
    getRemainingPickups,
    getCompletedPickups,
    isLoading,
    reloadPickups: loadFromSupabase,
  };

  return <PickupContext.Provider value={value}>{children}</PickupContext.Provider>;
};
