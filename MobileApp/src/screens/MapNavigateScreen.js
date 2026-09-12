import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AppButton from "../components/ui/AppButton";
import NetInfo from "@react-native-community/netinfo";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { useTheme } from "../context/ThemeContext";
import { usePickups } from "../context/PickupContext";
import { useLiveLocation } from "../context/LiveLocationContext";
import Constants from "expo-constants";
import { bearingDegrees, compassRose, formatDistance, haversineMeters } from "../utils/geoNav";
import {
  SWMO_HIDEOUT,
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

function pickNonEmptyString(...candidates) {
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (t.length > 0) return t;
  }
  return "";
}

export default function MapNavigateScreen() {
  const { colors, tokens } = useTheme();
  const { pendingPickups, getTotalPickups, isLoading: pickupsLoading } = usePickups();
  const { location: userLocation, locationPermission } = useLiveLocation();
  const webViewRef = useRef(null);
  const insets = useSafeAreaInsets();

  const extra = Constants?.expoConfig?.extra ?? Constants?.manifest?.extra ?? {};
  const openRouteApiKey = extra.openRouteApiKey ?? "";
  const mapboxToken = pickNonEmptyString(
    extra.mapboxAccessToken,
    process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
  );

  const [routeMeta, setRouteMeta] = useState({
    name: "Assigned Route",
    distanceLabel: "—",
    distanceM: 0,
    source: "",
  });
  const [fetchError, setFetchError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [routeLineLatLng, setRouteLineLatLng] = useState([]);
  const [geometryLoading, setGeometryLoading] = useState(false);
  const [guidanceSteps, setGuidanceSteps] = useState([]);
  const [guidanceIndex, setGuidanceIndex] = useState(0);
  const [followTruck, setFollowTruck] = useState(false);

  const mapUsesMapbox = Boolean(mapboxToken && String(mapboxToken).trim());

  const mapHTML = useMemo(
    () => (mapUsesMapbox ? getMapboxNavigationHtml(mapboxToken) : getLeafletMapHtml()),
    [mapUsesMapbox, mapboxToken],
  );

  const orderedPickups = pendingPickups;

  const routeOrigin = useMemo(() => {
    if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng)) {
      return { lat: userLocation.lat, lng: userLocation.lng };
    }
    return null;
  }, [userLocation?.lat, userLocation?.lng]);

  const routeDepot = routeOrigin ?? SWMO_HIDEOUT;
  const originKind = routeOrigin ? "gps" : "depot";
  const guidanceOpts = useMemo(() => ({ originKind: routeOrigin ? "gps" : "depot" }), [routeOrigin]);

  const fp = useMemo(() => routeGeometryFingerprint(orderedPickups, routeOrigin), [orderedPickups, routeOrigin]);

  const nextStop = orderedPickups[0] ?? null;
  const totalStops = getTotalPickups();
  const doneStops = Math.max(0, totalStops - orderedPickups.length);
  const progress = totalStops > 0 ? doneStops / totalStops : 0;

  const navHint = useMemo(() => {
    if (!nextStop) return { title: "No active stops", detail: "Accept an active route on Home, then open stops will appear here." };
    if (!userLocation || !Number.isFinite(userLocation.lat)) {
      return {
        title: `Next: ${nextStop.id}`,
        detail: "Enable location for distance, bearing, and follow mode.",
      };
    }
    const from = { lat: userLocation.lat, lng: userLocation.lng };
    const to = { lat: nextStop.lat, lng: nextStop.lng };
    const m = haversineMeters(from, to);
    const brg = bearingDegrees(from, to);
    const rose = compassRose(brg);
    return {
      title: `Next: ${nextStop.id}`,
      detail: `${formatDistance(m)} · ${rose} (${Math.round(brg)}°)`,
    };
  }, [nextStop, userLocation]);

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
    setRouteMeta((prev) => ({
      ...prev,
      name: orderedPickups[0]?.routeName ?? "Assigned Route",
    }));
  }, [orderedPickups]);

  useEffect(() => {
    setGuidanceIndex(0);
  }, [fp]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (orderedPickups.length === 0) {
        setRouteLineLatLng([]);
        setGuidanceSteps([]);
        setRouteMeta((p) => ({ ...p, distanceLabel: "—", distanceM: 0, source: "" }));
        return;
      }
      setGeometryLoading(true);
      setFetchError("");
      try {
        const net = await NetInfo.fetch();
        let leaflet = [];
        let distanceM = 0;
        let source = "straight";

        let gSteps = [];

        if (!net.isConnected) {
          const cached = await loadCachedPolyline(fp);
          if (cached?.leaflet?.length) {
            leaflet = cached.leaflet;
            distanceM = cached.distanceM ?? 0;
            source = cached.source ? `${cached.source} (offline)` : "cached-offline";
            gSteps =
              cached.guidanceSteps?.length > 0
                ? cached.guidanceSteps
                : buildStraightLineGuidance(routeDepot, orderedPickups, guidanceOpts);
          } else {
            const s = straightLinePolyline(routeDepot, orderedPickups);
            leaflet = s.leaflet;
            distanceM = s.distanceM;
            source = "straight-offline";
            gSteps = buildStraightLineGuidance(routeDepot, orderedPickups, guidanceOpts);
          }
        } else {
          const geom = await resolveRouteGeometry({
            depot: routeDepot,
            pickupsOrdered: orderedPickups,
            mapboxToken,
            openRouteApiKey: openRouteApiKey || undefined,
            fingerprint: fp,
            originKind,
          });
          leaflet = geom.leaflet ?? [];
          distanceM = geom.distanceM ?? 0;
          source = geom.source ?? "";
          gSteps = geom.guidanceSteps?.length ? geom.guidanceSteps : buildStraightLineGuidance(routeDepot, orderedPickups, guidanceOpts);
        }

        if (cancelled) return;
        setRouteLineLatLng(leaflet);
        setGuidanceSteps(gSteps);
        setRouteMeta((prev) => ({
          ...prev,
          distanceLabel: distanceM > 0 ? `${(distanceM / 1000).toFixed(1)} km` : "—",
          distanceM,
          source,
        }));
      } catch (e) {
        if (!cancelled) setFetchError(e?.message ?? "Route geometry failed");
      } finally {
        if (!cancelled) setGeometryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fp, mapboxToken, openRouteApiKey]);

  useEffect(() => {
    setMapReady(false);
  }, [mapUsesMapbox, mapHTML]);

  const pushMapLayers = useCallback(() => {
    if (!webViewRef.current || !mapReady) return;

    const binsJson = JSON.stringify(
      orderedPickups.map((p, idx) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        idx,
        isNext: idx === 0,
      })),
    );

    const lineJson = JSON.stringify(routeLineLatLng);
    const userJson = userLocation && Number.isFinite(userLocation.lat) ? JSON.stringify(userLocation) : "null";
    const routeStartJson = JSON.stringify(routeDepot);
    const referenceDepotJson = JSON.stringify(SWMO_HIDEOUT);
    const driverIsRouteOrigin = Boolean(routeOrigin);
    const showReferenceDepot = Boolean(
      routeOrigin && haversineMeters(routeOrigin, SWMO_HIDEOUT) > 120,
    );

    const layerArgs = {
      followTruck,
      binsJson,
      lineJson,
      userJson,
      routeStartJson,
      referenceDepotJson,
      driverIsRouteOrigin,
      showReferenceDepot,
    };

    const script = mapUsesMapbox ? buildMapboxLayersScript(layerArgs) : buildLeafletLayersScript(layerArgs);

    webViewRef.current.injectJavaScript(script);
  }, [mapReady, orderedPickups, routeLineLatLng, userLocation, followTruck, mapUsesMapbox, routeDepot, routeOrigin]);

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
      setFetchError(data.replace(/^mapbox-error:/, "").trim() || "The map could not load. Try closing and reopening this screen.");
    }
  }, []);

  const handleRecenter = useCallback(() => {
    setFollowTruck(false);
    if (!webViewRef.current) return;
    if (userLocation?.lat != null) {
      if (mapUsesMapbox) {
        webViewRef.current.injectJavaScript(
          `try{window.map&&window.map.easeTo({center:[${userLocation.lng},${userLocation.lat}],zoom:15,duration:400});}catch(e){}true;`,
        );
      } else {
        webViewRef.current.injectJavaScript(
          `map.setView([${userLocation.lat},${userLocation.lng}],15); true;`,
        );
      }
    } else if (mapUsesMapbox) {
      webViewRef.current.injectJavaScript(
        `try{window.map&&window.map.easeTo({center:[${SWMO_HIDEOUT.lng},${SWMO_HIDEOUT.lat}],zoom:${INITIAL_ZOOM},duration:400});}catch(e){}true;`,
      );
    } else {
      webViewRef.current.injectJavaScript(
        `map.setView([${SWMO_HIDEOUT.lat},${SWMO_HIDEOUT.lng}],${INITIAL_ZOOM}); true;`,
      );
    }
  }, [userLocation, mapUsesMapbox]);

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
  const mapLoading = geometryLoading || pickupsLoading;

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={styles.mapLayer}>
        {mapLoading ? (
          <View style={[styles.mapLoading, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ marginTop: 10, color: colors.textSecondary, fontSize: 15 }}>Loading route…</Text>
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
            {(fetchError || (!locationPermission && orderedPickups.length > 0)) && (
              <View
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
                  {fetchError ||
                    (!locationPermission
                      ? "Location disabled: enable GPS for live position and turn-by-turn hints."
                      : "")}
                </Text>
              </View>
            )}

            {!mapLoading ? (
              <View style={styles.topRow}>
                <View style={[styles.topHud, { backgroundColor: colors.card + "F2", borderColor: colors.borderSubtle }]}>
                  <View style={styles.topHudLeft}>
                    <Text style={[styles.hudTitle, { color: colors.textPrimary }]}>Navigate</Text>
                    <Text style={[styles.hudMeta, { color: colors.textSecondary }]} numberOfLines={2}>
                      {mapUsesMapbox ? "Live traffic map" : "Standard map"}
                      {totalStops > 0 ? ` · ${doneStops}/${totalStops} stops` : ""}
                      {routeMeta.distanceLabel !== "—" ? ` · ~${routeMeta.distanceLabel}` : ""}
                    </Text>
                  </View>
                  {nextStop ? (
                    <View style={styles.topHudRight}>
                      <Text style={[styles.nextLabel, { color: colors.textSecondary }]}>NEXT</Text>
                      <Text style={[styles.nextId, { color: colors.textPrimary }]} numberOfLines={1}>
                        {nextStop.id}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}
          </SafeAreaView>

          {!mapLoading ? (
            <>
              {!nextStop ? (
                <TouchableOpacity
                  style={[
                    styles.locationButtonFloating,
                    { top: insets.top + 8, backgroundColor: colors.card, borderColor: colors.borderSubtle },
                    tokens.shadow.fab,
                  ]}
                  onPress={handleRecenter}
                  activeOpacity={0.85}
                  accessibilityLabel="Recenter map on my location"
                  hitSlop={tokens.hitSlop}
                >
                  <Ionicons name="locate" size={22} color={colors.primary} />
                </TouchableOpacity>
              ) : null}
              <View style={[styles.bottomStack, { paddingBottom: dockBottomPad }]} pointerEvents="box-none">
              <View style={[styles.mapDock, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
                {totalStops > 0 ? (
                  <View style={[styles.progressTrack, styles.progressInDock, { backgroundColor: colors.textSecondary + "33" }]} pointerEvents="none">
                    <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.primary }]} />
                  </View>
                ) : null}
                {nextStop ? (
                  <>
                    <Text style={[styles.dockCue, { color: colors.textPrimary }]} numberOfLines={3}>
                      {currentGuidanceText}
                    </Text>
                    <Text style={[styles.dockStreet, { color: colors.textSecondary }]} numberOfLines={2}>
                      {nextStop.street}
                    </Text>
                    <View style={styles.dockLegendRow}>
                      {routeOrigin ? (
                        <>
                          <LegendDot color={colors.mapYou} label="You · start" textColor={colors.textSecondary} />
                          {haversineMeters(routeOrigin, SWMO_HIDEOUT) > 120 ? (
                            <LegendDot color={colors.mapDepot} label="Depot" textColor={colors.textSecondary} />
                          ) : null}
                          <LegendDot color={colors.mapNext} label="Next" textColor={colors.textSecondary} />
                          <LegendDot color={colors.mapStops} label="Stops" textColor={colors.textSecondary} />
                        </>
                      ) : (
                        <>
                          <LegendDot color={colors.mapRouteStart} label="Start" textColor={colors.textSecondary} />
                          <LegendDot color={colors.mapNext} label="Next" textColor={colors.textSecondary} />
                          <LegendDot color={colors.mapStops} label="Stops" textColor={colors.textSecondary} />
                          <LegendDot color={colors.mapYou} label="You" textColor={colors.textSecondary} />
                        </>
                      )}
                    </View>
                    {routeMeta.source ? (
                      <Text style={[styles.dockSource, { color: colors.textSecondary }]} numberOfLines={1}>
                        {routeMeta.source}
                      </Text>
                    ) : null}
                    <View style={styles.mapDockActions}>
                      <AppButton
                        title={followTruck ? "Pause follow" : "Follow GPS"}
                        icon={followTruck ? "pause" : "navigate"}
                        onPress={() => setFollowTruck((v) => !v)}
                        variant={followTruck ? "outline" : "primary"}
                        fullWidth={false}
                        style={styles.followActionBtn}
                      />
                      <TouchableOpacity
                        style={[
                          styles.dockLocateBtn,
                          { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
                        ]}
                        onPress={handleRecenter}
                        activeOpacity={0.85}
                        accessibilityLabel="Recenter map on my location"
                      >
                        <Ionicons name="locate" size={22} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={[styles.dockCue, { color: colors.textPrimary }]}>No route to display</Text>
                    <Text style={[styles.dockStreet, { color: colors.textSecondary }]}>
                      Open Home to see assigned stops. The map updates when dispatch assigns deliveries.
                    </Text>
                  </>
                )}
              </View>
            </View>
          </>
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
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  topHudLeft: { flex: 1, marginRight: 8, minWidth: 0 },
  topHudRight: { alignItems: "flex-end", maxWidth: "38%" },
  hudTitle: { fontSize: 16, fontWeight: "700" },
  hudMeta: { fontSize: 11, marginTop: 1, fontWeight: "600" },
  nextLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  nextId: { fontSize: 14, fontWeight: "800", marginTop: 1 },
  bottomStack: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 8,
    gap: 0,
  },
  locationButtonFloating: {
    position: "absolute",
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 5,
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
  mapDockActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  followActionBtn: {
    flex: 1,
    minWidth: 0,
  },
  dockLocateBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  dockCue: { fontSize: 15, fontWeight: "700", lineHeight: 21 },
  dockStreet: { fontSize: 13, marginTop: 5, lineHeight: 18 },
  dockLegendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontSize: 10, fontWeight: "700" },
  dockSource: { fontSize: 10, marginTop: 6, fontWeight: "600", opacity: 0.85 },
});
