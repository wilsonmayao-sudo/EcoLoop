import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, AppState } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute } from "@react-navigation/native";
import AppButton from "../components/ui/AppButton";
import NetInfo from "@react-native-community/netinfo";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { usePickups } from "../context/PickupContext";
import { useLiveLocation } from "../context/LiveLocationContext";
import Constants from "expo-constants";
import {
  bearingDegrees,
  compassRose,
  distanceToPolylineMeters,
  formatDistance,
  haversineMeters,
} from "../utils/geoNav";
import {
  SWMO_HIDEOUT,
  SWMO_LANDFILL,
  formatTravelDuration,
  routeGeometryFingerprint,
  resolveRouteGeometry,
  loadCachedPolyline,
  straightLinePolyline,
  buildStraightLineGuidance,
} from "../utils/navigationRoute";
import {
  getLeafletMapHtml,
  getMapboxNavigationHtml,
  buildLeafletLayersScript,
  buildMapboxLayersScript,
} from "../utils/mapboxWebMap";

const INITIAL_ZOOM = 13;
const OFF_ROUTE_THRESHOLD_METERS = 65;
const OFF_ROUTE_MIN_INTERVAL_MS = 12_000;
const COARSE_REFRESH_METERS = 300;
const COARSE_REFRESH_INTERVAL_MS = 30_000;

function routeNorm(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function pickActiveRoute(routes) {
  const list = routes ?? [];
  return (
    list.find((route) => routeNorm(route.status) === "active" && route.started_at) ??
    list.find((route) => routeNorm(route.status) === "active") ??
    list.find((route) => ["pending", "planned"].includes(routeNorm(route.status))) ??
    null
  );
}

function pickNonEmptyString(...candidates) {
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (t.length > 0) return t;
  }
  return "";
}

function remainingRoadDistanceMeters(origin, polylineLatLng, fallbackTarget) {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return null;
  if (!Array.isArray(polylineLatLng) || polylineLatLng.length < 2) {
    return fallbackTarget && Number.isFinite(fallbackTarget.lat)
      ? haversineMeters(origin, { lat: fallbackTarget.lat, lng: fallbackTarget.lng })
      : null;
  }

  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < polylineLatLng.length; i++) {
    const [lat, lng] = polylineLatLng[i];
    const d = haversineMeters(origin, { lat, lng });
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }

  let total = closestDist;
  for (let i = closestIdx; i < polylineLatLng.length - 1; i++) {
    const [lat1, lng1] = polylineLatLng[i];
    const [lat2, lng2] = polylineLatLng[i + 1];
    total += haversineMeters({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
  }
  return total;
}

export default function MapNavigateScreen() {
  const navRoute = useRoute();
  const { colors, tokens } = useTheme();
  const { t } = useLanguage();
  const {
    pendingPickups,
    assignedPickups,
    driverRoutes,
    isUnloadingAtLandfill,
    startLandfillUnload,
    completeLandfillUnload,
    completePickup,
    completeRoute,
    isLoading: pickupsLoading,
  } = usePickups();
  const { location: userLocation, locationPermission } = useLiveLocation();
  const webViewRef = useRef(null);
  const insets = useSafeAreaInsets();
  const [localLandfillMode, setLocalLandfillMode] = useState(Boolean(navRoute?.params?.navigateToLandfill));
  const [actionBusy, setActionBusy] = useState(false);
  const wasUnloadingRef = useRef(Boolean(isUnloadingAtLandfill));

  useEffect(() => {
    if (navRoute?.params?.navigateToLandfill !== undefined) {
      setLocalLandfillMode(Boolean(navRoute.params.navigateToLandfill));
    }
  }, [navRoute?.params?.navigateToLandfill]);

  useEffect(() => {
    if (wasUnloadingRef.current && !isUnloadingAtLandfill) {
      setLocalLandfillMode(false);
    }
    wasUnloadingRef.current = Boolean(isUnloadingAtLandfill);
  }, [isUnloadingAtLandfill]);

  const extra = Constants?.expoConfig?.extra ?? Constants?.manifest?.extra ?? {};
  const mapboxToken = pickNonEmptyString(
    extra.mapboxAccessToken,
    process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
  );

  const [routeMeta, setRouteMeta] = useState({
    name: "Assigned Route",
    distanceM: 0,
    durationS: 0,
    source: "",
  });
  const [fetchError, setFetchError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [routeLineLatLng, setRouteLineLatLng] = useState([]);
  const [geometryLoading, setGeometryLoading] = useState(false);
  const [guidanceSteps, setGuidanceSteps] = useState([]);
  const [guidanceIndex, setGuidanceIndex] = useState(0);
  const [followTruck, setFollowTruck] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  // Controls when Mapbox Directions should be requested without spamming on minor GPS jitter
  const [fetchRequest, setFetchRequest] = useState({
    destKey: "",
    origin: null,
    originKind: "depot",
    forceRefresh: false,
    seq: 0,
  });
  const routeFetchStateRef = useRef({
    destKey: "",
    origin: null,
    originKind: null,
    fetchedAtMs: 0,
    polyline: [],
  });

  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((state) => {
      setIsConnected(Boolean(state.isConnected));
    });
    const subApp = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setFetchRequest((prev) => ({ ...prev, seq: prev.seq + 1 }));
      }
    });
    return () => {
      unsubNet();
      subApp.remove();
    };
  }, []);

  const mapUsesMapbox = Boolean(mapboxToken && String(mapboxToken).trim());
  const mapHTML = useMemo(
    () => (mapUsesMapbox ? getMapboxNavigationHtml(mapboxToken) : getLeafletMapHtml()),
    [mapUsesMapbox, mapboxToken],
  );

  const currentRoute = useMemo(() => pickActiveRoute(driverRoutes), [driverRoutes]);
  const routeState = useMemo(() => {
    const status = routeNorm(currentRoute?.status);
    if (!currentRoute) return "none";
    if (status === "completed") return "completed";
    if (status === "pending" || status === "planned") return "pending";
    if (status === "active" && currentRoute.started_at) return "in_progress";
    if (status === "active") return "accepted";
    return "none";
  }, [currentRoute]);
  const canCompleteCollections = routeState === "accepted" || routeState === "in_progress";

  const orderedPickups = useMemo(() => {
    const list = pendingPickups ?? [];
    if (!currentRoute?.id) return list;
    return list.filter((p) => String(p.routeId) === String(currentRoute.id));
  }, [pendingPickups, currentRoute?.id]);

  const routeAssignedStops = useMemo(() => {
    const list = assignedPickups ?? [];
    if (!currentRoute?.id) return list;
    return list.filter((p) => String(p.routeId) === String(currentRoute.id));
  }, [assignedPickups, currentRoute?.id]);

  const totalStops = routeAssignedStops.length > 0 ? routeAssignedStops.length : orderedPickups.length;
  const doneStops = Math.max(0, totalStops - orderedPickups.length);
  const progress = totalStops > 0 ? doneStops / totalStops : 0;
  const allStopsDone = totalStops > 0 && orderedPickups.length === 0;

  // Official landfill is active when unloading mid-route or after all assigned collection points are finished
  const isNavigatingToLandfill = Boolean(isUnloadingAtLandfill || localLandfillMode || allStopsDone);

  // Strictly one active destination at a time
  const activeStop = isNavigatingToLandfill ? null : (orderedPickups[0] ?? null);
  const nextStopAfterActive = !isNavigatingToLandfill ? (orderedPickups[1] ?? null) : (orderedPickups[0] ?? null);

  const activeTarget = useMemo(() => {
    if (isNavigatingToLandfill) {
      return {
        id: "SWMO_LANDFILL",
        name: SWMO_LANDFILL.name,
        street: SWMO_LANDFILL.address,
        lat: SWMO_LANDFILL.lat,
        lng: SWMO_LANDFILL.lng,
        kind: "landfill",
      };
    }
    if (activeStop) {
      return {
        ...activeStop,
        name: activeStop.id,
        kind: "stop",
      };
    }
    return null;
  }, [isNavigatingToLandfill, activeStop]);

  const activeDestKey = useMemo(() => {
    if (!activeTarget) return "none";
    if (activeTarget.kind === "landfill") return "swmo-landfill";
    return `stop:${activeTarget.deliveryId ?? activeTarget.id}`;
  }, [activeTarget]);

  const routeOrigin = useMemo(() => {
    if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng)) {
      return { lat: userLocation.lat, lng: userLocation.lng };
    }
    return null;
  }, [userLocation?.lat, userLocation?.lng]);

  // Decide when to trigger a new Mapbox Directions request for the active single destination
  useEffect(() => {
    if (activeDestKey === "none") {
      routeFetchStateRef.current = { destKey: "none", origin: null, originKind: null, fetchedAtMs: 0, polyline: [] };
      setRouteLineLatLng([]);
      setGuidanceSteps([]);
      setRouteMeta((p) => ({ ...p, distanceM: 0, durationS: 0, source: "" }));
      return;
    }

    const prev = routeFetchStateRef.current;
    const now = Date.now();
    const desiredOrigin = routeOrigin ?? SWMO_HIDEOUT;
    const desiredKind = routeOrigin ? "gps" : "depot";

    const destChanged = prev.destKey !== activeDestKey;
    const gainedGpsLock = prev.originKind !== "gps" && desiredKind === "gps";
    const missingLine = prev.polyline.length < 2 && now - prev.fetchedAtMs >= 5_000;
    const deviated =
      desiredKind === "gps" &&
      prev.polyline.length >= 2 &&
      now - prev.fetchedAtMs >= OFF_ROUTE_MIN_INTERVAL_MS &&
      distanceToPolylineMeters(desiredOrigin, prev.polyline) > OFF_ROUTE_THRESHOLD_METERS;
    const movedFar =
      desiredKind === "gps" &&
      prev.origin != null &&
      now - prev.fetchedAtMs >= COARSE_REFRESH_INTERVAL_MS &&
      haversineMeters(desiredOrigin, prev.origin) > COARSE_REFRESH_METERS;

    if (destChanged || gainedGpsLock || missingLine || deviated || movedFar) {
      setFetchRequest((curr) => ({
        destKey: activeDestKey,
        origin: desiredOrigin,
        originKind: desiredKind,
        forceRefresh: Boolean(deviated),
        seq: curr.seq + 1,
      }));
    }
  }, [activeDestKey, routeOrigin]);

  // Re-attempt route fetch cleanly when network reconnects after offline/unavailable fallback
  const prevConnectedRef = useRef(isConnected);
  useEffect(() => {
    const wasOffline = !prevConnectedRef.current;
    prevConnectedRef.current = isConnected;
    if (wasOffline && isConnected && activeTarget && !routeMeta.source.startsWith("mapbox")) {
      setFetchRequest((curr) => ({
        destKey: activeDestKey,
        origin: routeOrigin ?? SWMO_HIDEOUT,
        originKind: routeOrigin ? "gps" : "depot",
        forceRefresh: false,
        seq: curr.seq + 1,
      }));
    }
  }, [isConnected, activeDestKey, activeTarget, routeMeta.source, routeOrigin]);

  const targetWaypoints = useMemo(() => (activeTarget ? [activeTarget] : []), [activeTarget]);

  const fp = useMemo(
    () =>
      routeGeometryFingerprint(
        targetWaypoints,
        fetchRequest.origin ?? SWMO_HIDEOUT,
        isNavigatingToLandfill ? "swmo-landfill" : "single-stop",
      ),
    [targetWaypoints, fetchRequest.origin, isNavigatingToLandfill],
  );

  useEffect(() => {
    setRouteMeta((prev) => ({
      ...prev,
      name: currentRoute?.name ?? orderedPickups[0]?.routeName ?? "Assigned Route",
    }));
  }, [currentRoute?.name, orderedPickups]);

  useEffect(() => {
    setGuidanceIndex(0);
  }, [activeDestKey]);

  useEffect(() => {
    if (!activeTarget || !fetchRequest.origin || fetchRequest.destKey !== activeDestKey) return undefined;

    let cancelled = false;
    const effectiveDepot = fetchRequest.origin;
    const effectiveKind = fetchRequest.originKind;
    const guidanceOpts = { originKind: effectiveKind };

    (async () => {
      setGeometryLoading((prev) => (routeFetchStateRef.current.destKey !== activeDestKey ? true : prev));
      setFetchError("");
      try {
        const net = await NetInfo.fetch();
        let leaflet = [];
        let distanceM = 0;
        let durationS = 0;
        let source = "mapbox";
        let gSteps = [];

        if (!net.isConnected) {
          const cached = await loadCachedPolyline(fp);
          if (cached?.leaflet?.length) {
            leaflet = cached.leaflet;
            distanceM = cached.distanceM ?? 0;
            durationS = cached.durationS ?? 0;
            source = cached.source ? `${cached.source} (offline)` : "cached-offline";
            gSteps =
              cached.guidanceSteps?.length > 0
                ? cached.guidanceSteps
                : buildStraightLineGuidance(effectiveDepot, targetWaypoints, guidanceOpts);
          } else {
            const s = straightLinePolyline(effectiveDepot, targetWaypoints);
            leaflet = s.leaflet;
            distanceM = s.distanceM;
            durationS = 0;
            source = "offline-fallback";
            gSteps = buildStraightLineGuidance(effectiveDepot, targetWaypoints, guidanceOpts);
          }
        } else {
          const geom = await resolveRouteGeometry({
            depot: effectiveDepot,
            pickupsOrdered: targetWaypoints,
            mapboxToken,
            fingerprint: fp,
            originKind: effectiveKind,
            forceRefresh: fetchRequest.forceRefresh,
          });
          leaflet = geom.leaflet ?? [];
          distanceM = geom.distanceM ?? 0;
          durationS = geom.durationS ?? 0;
          source = geom.source ?? "";
          gSteps = geom.guidanceSteps?.length
            ? geom.guidanceSteps
            : buildStraightLineGuidance(effectiveDepot, targetWaypoints, guidanceOpts);

          if (geom.error && leaflet.length === 0) {
            setFetchError(geom.error);
            const fallback = straightLinePolyline(effectiveDepot, targetWaypoints);
            leaflet = fallback.leaflet;
            distanceM = fallback.distanceM;
            durationS = 0;
            source = "fallback";
          }
        }

        if (cancelled) return;
        routeFetchStateRef.current = {
          destKey: activeDestKey,
          origin: effectiveDepot,
          originKind: effectiveKind,
          fetchedAtMs: Date.now(),
          polyline: leaflet,
        };
        setRouteLineLatLng(leaflet);
        setGuidanceSteps(gSteps);
        setRouteMeta((prev) => ({
          ...prev,
          distanceM,
          durationS,
          source: isNavigatingToLandfill ? `mapbox-landfill (${source})` : source,
        }));
      } catch (e) {
        if (!cancelled) setFetchError(e?.message ?? "Unable to calculate route directions.");
      } finally {
        if (!cancelled) setGeometryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeDestKey,
    activeTarget,
    fetchRequest.destKey,
    fetchRequest.forceRefresh,
    fetchRequest.origin,
    fetchRequest.originKind,
    fetchRequest.seq,
    fp,
    isNavigatingToLandfill,
    mapboxToken,
    targetWaypoints,
  ]);

  // Live remaining distance & ETA estimate along the single active segment
  const remainingStats = useMemo(() => {
    if (!activeTarget) return { distanceLabel: "—", durationLabel: "—" };
    const roadM = routeOrigin
      ? remainingRoadDistanceMeters(routeOrigin, routeLineLatLng, activeTarget)
      : routeMeta.distanceM > 0
        ? routeMeta.distanceM
        : null;
    const distanceLabel = roadM != null && Number.isFinite(roadM) ? formatDistance(roadM) : "—";

    let durationLabel = "—";
    if (routeMeta.durationS > 0 && routeMeta.distanceM > 0 && roadM != null) {
      const scaledS = Math.max(30, Math.round((roadM / routeMeta.distanceM) * routeMeta.durationS));
      durationLabel = formatTravelDuration(scaledS);
    } else if (routeMeta.durationS > 0) {
      durationLabel = formatTravelDuration(routeMeta.durationS);
    }

    return { distanceLabel, durationLabel };
  }, [activeTarget, routeOrigin, routeLineLatLng, routeMeta.distanceM, routeMeta.durationS]);

  const navHint = useMemo(() => {
    if (!activeTarget) {
      return {
        title: "No active destination",
        detail: "Accept an active route on Home to begin sequential navigation.",
      };
    }
    if (!routeOrigin) {
      return {
        title: activeTarget.name,
        detail:
          activeTarget.kind === "landfill"
            ? "Waiting for GPS lock to guide you to SWMO Sanitary Landfill."
            : `Waiting for GPS lock. Destination: ${activeTarget.street}`,
      };
    }
    const m = haversineMeters(routeOrigin, { lat: activeTarget.lat, lng: activeTarget.lng });
    const brg = bearingDegrees(routeOrigin, { lat: activeTarget.lat, lng: activeTarget.lng });
    const rose = compassRose(brg);
    return {
      title: activeTarget.name,
      detail: `${formatDistance(m)} · Heading ${rose} (${Math.round(brg)}°)`,
    };
  }, [activeTarget, routeOrigin]);

  const currentGuidanceText = useMemo(() => {
    if (guidanceSteps.length > 0 && guidanceSteps[guidanceIndex]?.text) {
      return guidanceSteps[guidanceIndex].text;
    }
    return navHint.detail;
  }, [guidanceSteps, guidanceIndex, navHint.detail]);

  useEffect(() => {
    if (!userLocation?.lat || !guidanceSteps.length) return;
    setGuidanceIndex((idx) => {
      const step = guidanceSteps[idx];
      if (!step) return idx;
      const d = haversineMeters(
        { lat: userLocation.lat, lng: userLocation.lng },
        { lat: step.lat, lng: step.lng },
      );
      if (d < 42 && idx < guidanceSteps.length - 1) return idx + 1;
      return idx;
    });
  }, [userLocation, guidanceSteps]);

  useEffect(() => {
    setMapReady(false);
  }, [mapUsesMapbox, mapHTML]);

  const pushMapLayers = useCallback(() => {
    if (!webViewRef.current || !mapReady) return;

    const singleStopJson = JSON.stringify(
      !isNavigatingToLandfill && activeStop
        ? [
            {
              id: activeStop.id,
              lat: activeStop.lat,
              lng: activeStop.lng,
              idx: doneStops,
              isNext: true,
            },
          ]
        : [],
    );

    const lineJson = JSON.stringify(routeLineLatLng);
    const userJson = userLocation && Number.isFinite(userLocation.lat) ? JSON.stringify(userLocation) : "null";
    const routeStartJson = JSON.stringify(routeOrigin ?? SWMO_HIDEOUT);
    const driverIsRouteOrigin = Boolean(routeOrigin);

    const layerArgs = {
      followTruck,
      binsJson: singleStopJson,
      lineJson,
      userJson,
      routeStartJson,
      driverIsRouteOrigin,
      showLandfillMarker: isNavigatingToLandfill,
      landfillJson: JSON.stringify(SWMO_LANDFILL),
    };

    const script = mapUsesMapbox ? buildMapboxLayersScript(layerArgs) : buildLeafletLayersScript(layerArgs);
    webViewRef.current.injectJavaScript(script);
  }, [
    mapReady,
    isNavigatingToLandfill,
    activeStop,
    doneStops,
    routeLineLatLng,
    userLocation,
    routeOrigin,
    followTruck,
    mapUsesMapbox,
  ]);

  useEffect(() => {
    const t = setTimeout(pushMapLayers, 120);
    return () => clearTimeout(t);
  }, [pushMapLayers]);

  const handleWebViewLoad = useCallback(() => {
    if (!mapUsesMapbox) setMapReady(true);
  }, [mapUsesMapbox]);

  const onWebViewMessage = useCallback((event) => {
    const data = event?.nativeEvent?.data;
    if (data === "mapbox-ready") {
      setFetchError("");
      setMapReady(true);
      return;
    }
    if (typeof data === "string" && data.startsWith("mapbox-error:")) {
      setFetchError(data.replace(/^mapbox-error:/, "").trim() || "The map could not load. Try reopening this screen.");
    }
  }, []);

  const handleRecenter = useCallback(() => {
    setFollowTruck(false);
    if (!webViewRef.current) return;
    const focus = userLocation?.lat != null ? userLocation : activeTarget ?? SWMO_HIDEOUT;
    if (mapUsesMapbox) {
      webViewRef.current.injectJavaScript(
        `try{window.map&&window.map.easeTo({center:[${focus.lng},${focus.lat}],zoom:15,duration:400});}catch(e){}true;`,
      );
    } else {
      webViewRef.current.injectJavaScript(`map.setView([${focus.lat},${focus.lng}],15); true;`);
    }
  }, [userLocation, activeTarget, mapUsesMapbox]);

  const handleRetryDirections = useCallback(() => {
    if (!activeTarget) return;
    setFetchRequest((curr) => ({
      destKey: activeDestKey,
      origin: routeOrigin ?? SWMO_HIDEOUT,
      originKind: routeOrigin ? "gps" : "depot",
      forceRefresh: true,
      seq: curr.seq + 1,
    }));
  }, [activeDestKey, activeTarget, routeOrigin]);

  const handleCompleteCurrentStop = useCallback(() => {
    if (!activeStop || actionBusy) return;
    if (!canCompleteCollections) {
      Alert.alert(
        t("alert_accept_route_nav_title", "Accept Route First"),
        t("alert_accept_route_nav_msg", "Please accept and start the route on Home before completing collection stops."),
      );
      return;
    }
    Alert.alert(
      t("alert_complete_stop_title", "Complete Collection Point"),
      t("alert_complete_stop_msg", "Confirm completion for {id} ({street})?", {
        id: activeStop.id,
        street: activeStop.street,
      }),
      [
        { text: t("cancel", "Cancel"), style: "cancel" },
        {
          text: t("complete_btn", "Complete"),
          onPress: async () => {
            setActionBusy(true);
            try {
              await completePickup(activeStop.deliveryId, activeStop.binId);
            } catch (e) {
              Alert.alert(
                t("alert_stop_complete_err", "Could Not Complete Stop"),
                e?.message ?? t("err_try_again", "Please try again."),
              );
            } finally {
              setActionBusy(false);
            }
          },
        },
      ],
    );
  }, [activeStop, actionBusy, canCompleteCollections, completePickup, t]);

  const handleStartLandfillTrip = useCallback(() => {
    if (actionBusy || isNavigatingToLandfill) return;
    Alert.alert(
      t("alert_go_landfill_title", "Go to SWMO Landfill"),
      t(
        "alert_go_landfill_msg",
        "Navigate to SWMO Sanitary Landfill to unload now? Your remaining collection points will stay queued until you finish unloading.",
      ),
      [
        { text: t("cancel", "Cancel"), style: "cancel" },
        {
          text: t("btn_navigate_landfill", "Navigate to Landfill"),
          onPress: async () => {
            setActionBusy(true);
            try {
              await startLandfillUnload();
              setLocalLandfillMode(true);
            } catch (e) {
              Alert.alert(
                t("alert_landfill_start_err", "Unable to Start Landfill Trip"),
                e?.message ?? t("err_try_again", "Please try again."),
              );
            } finally {
              setActionBusy(false);
            }
          },
        },
      ],
    );
  }, [actionBusy, isNavigatingToLandfill, startLandfillUnload, t]);

  const handleFinishUnloading = useCallback(() => {
    if (actionBusy) return;
    const hasRemainingStops = orderedPickups.length > 0;
    Alert.alert(
      hasRemainingStops
        ? t("alert_resume_stops_title", "Resume Collection Stops")
        : t("alert_complete_at_landfill_title", "Complete Route at Landfill"),
      hasRemainingStops
        ? t(
            "alert_resume_stops_msg",
            "Confirm truck is unloaded at SWMO Sanitary Landfill and continue to {id}?",
            { id: orderedPickups[0].id },
          )
        : t(
            "alert_complete_at_landfill_msg",
            "Confirm final unloading at SWMO Sanitary Landfill and mark this route completed?",
          ),
      [
        { text: t("cancel", "Cancel"), style: "cancel" },
        {
          text: hasRemainingStops
            ? t("btn_resume_route", "Resume Route")
            : t("btn_complete_route", "Complete Route"),
          onPress: async () => {
            setActionBusy(true);
            try {
              if (hasRemainingStops) {
                await completeLandfillUnload();
                setLocalLandfillMode(false);
              } else if (currentRoute?.id) {
                await completeRoute(currentRoute.id);
                setLocalLandfillMode(false);
              } else {
                await completeLandfillUnload();
                setLocalLandfillMode(false);
              }
            } catch (e) {
              Alert.alert(
                t("alert_unload_status_err", "Could not update unloading status"),
                e?.message ?? t("err_try_again", "Please try again."),
              );
            } finally {
              setActionBusy(false);
            }
          },
        },
      ],
    );
  }, [actionBusy, completeLandfillUnload, completeRoute, currentRoute?.id, orderedPickups, t]);

  useEffect(() => {
    if (!followTruck || !mapReady || !webViewRef.current || userLocation?.lat == null) return;
    const { lat, lng } = userLocation;
    if (mapUsesMapbox) {
      webViewRef.current.injectJavaScript(
        `try{if(window.map&&window.map.isStyleLoaded()){window.map.easeTo({center:[${lng},${lat}],zoom:17,duration:300});}}catch(e){}true;`,
      );
    } else {
      webViewRef.current.injectJavaScript(
        `try{if(typeof map!=='undefined'){map.setView([${lat},${lng}],17,{animate:true});}}catch(e){}true;`,
      );
    }
  }, [followTruck, userLocation, mapReady, mapUsesMapbox]);

  const dockBottomPad = Math.max(insets.bottom, tokens.space.sm) + tokens.space.md;
  const mapLoading = (geometryLoading && routeLineLatLng.length === 0 && Boolean(activeTarget)) || pickupsLoading;

  const nextDestinationLabel = useMemo(() => {
    if (!activeTarget) return null;
    if (isNavigatingToLandfill) {
      if (nextStopAfterActive) {
        return `Next after unload: ${nextStopAfterActive.id} (${nextStopAfterActive.street})`;
      }
      return "Final destination: Complete route after unloading";
    }
    if (nextStopAfterActive) {
      return `Next destination: ${nextStopAfterActive.id} (${nextStopAfterActive.street})`;
    }
    return `Next destination: ${SWMO_LANDFILL.name}`;
  }, [activeTarget, isNavigatingToLandfill, nextStopAfterActive]);

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={styles.mapLayer}>
        {mapLoading ? (
          <View style={[styles.mapLoading, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ marginTop: 10, color: colors.textSecondary, fontSize: 15 }}>Loading route directions…</Text>
          </View>
        ) : (
          <WebView
            key={mapUsesMapbox ? "mapbox-gl" : "leaflet-osm"}
            ref={webViewRef}
            source={{ html: mapHTML }}
            style={StyleSheet.absoluteFillObject}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            onMessage={onWebViewMessage}
            onLoadEnd={handleWebViewLoad}
          />
        )}

        <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
          <SafeAreaView edges={["top"]} style={styles.safeTop} pointerEvents="box-none">
            {(fetchError || (!locationPermission && Boolean(activeTarget))) && (
              <TouchableOpacity
                onPress={handleRetryDirections}
                activeOpacity={0.85}
                style={[
                  styles.errorBar,
                  {
                    backgroundColor: colors.warning + "22",
                    borderColor: colors.warning + "55",
                    borderRadius: tokens.radius.md,
                  },
                ]}
              >
                <Text style={[styles.errorBarText, { color: colors.textPrimary }]} numberOfLines={3}>
                  {fetchError
                    ? t("tap_to_retry", "{error} Tap to retry.", { error: fetchError })
                    : t("gps_disabled_hint", "GPS disabled: enable location services for turn-by-turn directions from your truck.")}
                </Text>
              </TouchableOpacity>
            )}

            {!mapLoading ? (
              <View style={styles.topRow}>
                <View style={[styles.topHud, { backgroundColor: colors.card + "F5", borderColor: colors.borderSubtle }]}>
                  <View style={styles.topHudLeft}>
                    <View style={styles.destBadgeRow}>
                      <View
                        style={[
                          styles.destTypeBadge,
                          {
                            backgroundColor: isNavigatingToLandfill ? "#04785720" : colors.primary + "1F",
                            borderColor: isNavigatingToLandfill ? "#047857" : colors.primary,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.destTypeText,
                            { color: isNavigatingToLandfill ? "#047857" : colors.primary },
                          ]}
                        >
                          {isNavigatingToLandfill
                            ? t("dest_landfill", "SWMO SANITARY LANDFILL")
                            : activeTarget
                              ? t("dest_collection_point", "COLLECTION POINT")
                              : t("dest_no_active", "NO ACTIVE STOP")}
                        </Text>
                      </View>
                      {totalStops > 0 ? (
                        <Text style={[styles.stopProgressText, { color: colors.textSecondary }]}>
                          {isNavigatingToLandfill
                            ? allStopsDone
                              ? t("final_trip", "Final Trip")
                              : `${doneStops}/${totalStops}`
                            : t("stop_x_of_y", "Stop {current} / {total}", {
                                current: Math.min(doneStops + 1, totalStops),
                                total: totalStops,
                              })}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.hudTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                      {activeTarget ? activeTarget.name : routeMeta.name}
                    </Text>
                    {activeTarget?.street ? (
                      <Text style={[styles.hudAddress, { color: colors.textSecondary }]} numberOfLines={1}>
                        {activeTarget.street}
                      </Text>
                    ) : null}
                  </View>

                  {activeTarget ? (
                    <View style={styles.topHudRight}>
                      <Text style={[styles.metricValue, { color: colors.textPrimary }]} numberOfLines={1}>
                        {remainingStats.distanceLabel}
                      </Text>
                      <Text style={[styles.metricSub, { color: colors.textSecondary }]} numberOfLines={1}>
                        {remainingStats.durationLabel !== "—" ? `ETA ${remainingStats.durationLabel}` : t("gps_dist", "GPS dist")}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}
          </SafeAreaView>

          {!mapLoading ? (
            <View style={[styles.bottomStack, { paddingBottom: dockBottomPad }]} pointerEvents="box-none">
              <View style={[styles.mapDock, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
                {totalStops > 0 ? (
                  <View style={[styles.progressTrack, styles.progressInDock, { backgroundColor: colors.textSecondary + "33" }]} pointerEvents="none">
                    <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.primary }]} />
                  </View>
                ) : null}

                {activeTarget ? (
                  <>
                    <Text style={[styles.dockCue, { color: colors.textPrimary }]} numberOfLines={3}>
                      {currentGuidanceText}
                    </Text>

                    {nextDestinationLabel ? (
                      <View style={[styles.nextBanner, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
                        <Ionicons
                          name={isNavigatingToLandfill && !nextStopAfterActive ? "flag-outline" : "arrow-forward-circle-outline"}
                          size={15}
                          color={colors.textSecondary}
                        />
                        <Text style={[styles.nextBannerText, { color: colors.textSecondary }]} numberOfLines={2}>
                          {nextDestinationLabel}
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.dockLegendRow}>
                      <LegendDot color="#2563eb" label={t("legend_truck_gps", "Truck GPS")} textColor={colors.textSecondary} />
                      <LegendDot
                        color={isNavigatingToLandfill ? "#047857" : "#ca8a04"}
                        label={
                          isNavigatingToLandfill
                            ? t("legend_landfill", "SWMO Sanitary Landfill")
                            : t("legend_collection_point", "Active Collection Point")
                        }
                        textColor={colors.textSecondary}
                      />
                    </View>

                    {isNavigatingToLandfill ? (
                      <View style={styles.primaryRow}>
                        {routeState !== "completed" && (orderedPickups.length > 0 || currentRoute?.id) ? (
                          <AppButton
                            title={
                              orderedPickups.length > 0
                                ? t("mark_unloaded_resume", "Mark Unloaded & Resume Stops")
                                : t("mark_unloaded_complete", "Mark Unloaded & Complete Route")
                            }
                            icon="checkmark-circle"
                            onPress={handleFinishUnloading}
                            disabled={actionBusy}
                            loading={actionBusy}
                            style={{ backgroundColor: "#047857" }}
                          />
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.primaryRow}>
                        <AppButton
                          title={t("complete_current_stop", "Complete Current Stop")}
                          icon="checkmark-circle"
                          onPress={handleCompleteCurrentStop}
                          disabled={actionBusy || !canCompleteCollections}
                          loading={actionBusy}
                        />
                      </View>
                    )}

                    <View style={styles.mapDockActions}>
                      <AppButton
                        title={followTruck ? t("btn_pause_follow", "Pause Follow") : t("btn_follow_gps", "Follow GPS")}
                        icon={followTruck ? "pause" : "navigate"}
                        iconSize={17}
                        onPress={() => setFollowTruck((v) => !v)}
                        variant={followTruck ? "outline" : "primary"}
                        fullWidth={false}
                        style={styles.followActionBtn}
                        textStyle={styles.dockActionBtnText}
                      />
                      {!isNavigatingToLandfill && canCompleteCollections ? (
                        <AppButton
                          title={t("unload_at_landfill", "Unload at Landfill")}
                          icon="trash-outline"
                          iconSize={17}
                          onPress={handleStartLandfillTrip}
                          variant="outline"
                          fullWidth={false}
                          style={styles.followActionBtn}
                          textStyle={styles.dockActionBtnText}
                          disabled={actionBusy}
                        />
                      ) : null}
                      <TouchableOpacity
                        style={[
                          styles.dockLocateBtn,
                          { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
                        ]}
                        onPress={handleRecenter}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Recenter map"
                      >
                        <Ionicons name="locate" size={22} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={[styles.dockCue, { color: colors.textPrimary }]}>{t("no_active_dest", "No active destination")}</Text>
                    <Text style={[styles.dockStreet, { color: colors.textSecondary }]}>
                      {t(
                        "no_active_dest_hint",
                        "Open Home to accept your assigned route. Navigation will guide you stop by stop and to SWMO Sanitary Landfill when unloading.",
                      )}
                    </Text>
                    <View style={styles.mapDockActions}>
                      <AppButton
                        title={t("navigate_to_landfill", "Navigate to SWMO Landfill")}
                        icon="navigate"
                        iconSize={17}
                        onPress={async () => {
                          setActionBusy(true);
                          try {
                            await startLandfillUnload();
                            setLocalLandfillMode(true);
                          } finally {
                            setActionBusy(false);
                          }
                        }}
                        variant="outline"
                        fullWidth={false}
                        style={styles.followActionBtn}
                        textStyle={styles.dockActionBtnText}
                        disabled={actionBusy}
                      />
                      <TouchableOpacity
                        style={[
                          styles.dockLocateBtn,
                          { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
                        ]}
                        onPress={handleRecenter}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Recenter map"
                      >
                        <Ionicons name="locate" size={22} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function LegendDot({ color, label, textColor }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendLabel, { color: textColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapLayer: { flex: 1, position: "relative" },
  mapLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  safeTop: { paddingHorizontal: 10, paddingTop: 2 },
  errorBar: { marginBottom: 6, padding: 8, borderWidth: 1 },
  errorBarText: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  topHud: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  topHudLeft: { flex: 1, marginRight: 10, minWidth: 0 },
  topHudRight: { alignItems: "flex-end", minWidth: 70 },
  destBadgeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  destTypeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  destTypeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  stopProgressText: { fontSize: 11, fontWeight: "600" },
  hudTitle: { fontSize: 16, fontWeight: "700" },
  hudAddress: { fontSize: 12, marginTop: 1 },
  metricValue: { fontSize: 17, fontWeight: "800" },
  metricSub: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  bottomStack: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 8,
    gap: 0,
  },
  progressTrack: {
    height: 4,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 3 },
  progressInDock: {
    marginBottom: 10,
  },
  mapDock: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 8,
  },
  nextBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nextBannerText: { fontSize: 12, fontWeight: "600", flex: 1 },
  primaryRow: { marginTop: 10 },
  mapDockActions: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    marginTop: 8,
  },
  followActionBtn: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  dockActionBtnText: {
    fontSize: 13,
    lineHeight: 17,
  },
  dockLocateBtn: {
    width: 48,
    minHeight: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  dockCue: { fontSize: 15, fontWeight: "700", lineHeight: 21 },
  dockStreet: { fontSize: 13, marginTop: 5, lineHeight: 18 },
  dockLegendRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 10, fontWeight: "700" },
});
