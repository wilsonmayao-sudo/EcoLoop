import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import NetInfo from "@react-native-community/netinfo";
import { useAuth } from "./AuthContext";
import { usePickups } from "./PickupContext";
import {
  LIVE_LOCATION_MIN_INTERVAL_MS,
  clearDriverLatestLocation,
  normalizeGpsFix,
  publishDriverLocation,
  shouldPublishLiveLocation,
  shouldRecordLocationHistory,
} from "../services/liveLocation";

const LiveLocationContext = createContext({ location: null, locationPermission: false });

export function useLiveLocation() {
  return useContext(LiveLocationContext);
}

function normalizeStatus(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function canTrackDriver(status) {
  const normalized = normalizeStatus(status);
  return normalized === "active" || normalized === "available" || normalized === "on_route";
}

export function LiveLocationProvider({ children }) {
  const { driver } = useAuth();
  const { driverRoutes, pendingPickups } = usePickups();
  const [location, setLocation] = useState(null);
  const [locationPermission, setLocationPermission] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const lastPublishedLocationRef = useRef(null);
  const lastPublishedStatusKeyRef = useRef("");
  const lastHistoryLocationRef = useRef(null);

  const activeRoute = useMemo(
    () =>
      (driverRoutes ?? [])
        .filter((route) => normalizeStatus(route.status) === "active")
        .sort((a, b) => {
          if (a.started_at && !b.started_at) return -1;
          if (!a.started_at && b.started_at) return 1;
          return new Date(b.started_at ?? b.created_at ?? 0).getTime() - new Date(a.started_at ?? a.created_at ?? 0).getTime();
        })[0] ?? null,
    [driverRoutes],
  );

  const routeId = activeRoute?.id ?? pendingPickups?.[0]?.routeId ?? null;
  const vehicleId = activeRoute?.vehicle_id ?? driver?.assigned_vehicle_id ?? null;
  const trackingEnabled = Boolean(driver?.id && canTrackDriver(driver?.status));
  const statusKey = `${driver?.id ?? "no-driver"}:${vehicleId ?? "no-vehicle"}:${routeId ?? "no-route"}:${normalizeStatus(driver?.status)}`;

  const clearLatestLocation = useCallback(() => {
    if (!driver?.id) return;
    void clearDriverLatestLocation({ driverId: driver.id }).catch((error) => {
      console.warn("Unable to clear driver live location:", error?.message);
    });
  }, [driver?.id]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
      if (nextState !== "active") clearLatestLocation();
    });
    return () => subscription.remove();
  }, [clearLatestLocation]);

  useEffect(() => {
    if (trackingEnabled && appState === "active") return;
    setLocation(null);
    clearLatestLocation();
  }, [appState, clearLatestLocation, trackingEnabled]);

  useEffect(() => {
    if (!trackingEnabled || appState !== "active") return undefined;

    let cancelled = false;
    let subscription;
    void (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (permission.status !== "granted") {
        setLocationPermission(false);
        clearLatestLocation();
        return;
      }

      setLocationPermission(true);
      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const fix = normalizeGpsFix(current);
        if (!cancelled && fix) setLocation(fix);
      } catch {
        // The continuous watcher can still provide the first valid fix.
      }

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 8, timeInterval: LIVE_LOCATION_MIN_INTERVAL_MS },
        (nextLocation) => {
          const fix = normalizeGpsFix(nextLocation);
          if (!cancelled && fix) setLocation(fix);
        },
      );
      if (cancelled) subscription.remove();
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [appState, clearLatestLocation, trackingEnabled]);

  useEffect(() => {
    if (!trackingEnabled || appState !== "active" || !driver?.id || !location) return undefined;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const includeHistory = shouldRecordLocationHistory(location, lastHistoryLocationRef.current);
      const shouldPublish = shouldPublishLiveLocation({
        current: location,
        lastSent: lastPublishedLocationRef.current,
        statusKey,
        lastStatusKey: lastPublishedStatusKeyRef.current,
      });
      if (!shouldPublish && !includeHistory) return;

      try {
        const network = await NetInfo.fetch();
        if (!network.isConnected || cancelled) return;
        await publishDriverLocation({ driverId: driver.id, vehicleId, routeId, location, includeHistory });
        if (cancelled) return;
        lastPublishedLocationRef.current = location;
        lastPublishedStatusKeyRef.current = statusKey;
        if (includeHistory) lastHistoryLocationRef.current = location;
      } catch (error) {
        console.warn("Live location update failed:", error?.message);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [appState, driver?.id, location, routeId, statusKey, trackingEnabled, vehicleId]);

  useEffect(() => () => clearLatestLocation(), [clearLatestLocation]);

  const value = useMemo(() => ({ location, locationPermission }), [location, locationPermission]);
  return <LiveLocationContext.Provider value={value}>{children}</LiveLocationContext.Provider>;
}
