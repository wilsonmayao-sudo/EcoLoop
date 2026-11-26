import { useEffect, useRef, useState } from "react";
import { Lock, RefreshCw, Unlock } from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  classifyMapboxError,
  getWebMapboxToken,
  MISSING_MAPBOX_TOKEN_MESSAGE,
  recoverMapboxStyleInPlace,
  safeResizeMap,
} from "../../utils/mapboxRuntime";
import {
  getConfiguredLandfill,
  getMapboxStyleUrl,
  getRuntimeSystemSettings,
  subscribeRuntimeSettings,
} from "../../utils/systemSettings";

export type LiveFleetMapTone = "green" | "amber" | "red" | "blue" | "gray";
export type LiveFleetMapIconKind = "truck" | "bin" | "landfill" | "stopped";

export interface LiveFleetMapMarker {
  key: string;
  label: string;
  latitude: number;
  longitude: number;
  delayed: boolean;
  /** Optional border tone; overrides `delayed` styling when set. */
  tone?: LiveFleetMapTone;
  /** Semantic vector icon type; defaults to truck. */
  icon?: LiveFleetMapIconKind;
  /** Optional compact marker (e.g. bins). */
  small?: boolean;
  /** Highlight marker when explicitly selected (e.g. selected bin in Area view). */
  selected?: boolean;
}

const TONE_BORDER: Record<LiveFleetMapTone, string> = {
  green: "border-emerald-500 text-emerald-700",
  amber: "border-amber-400 text-amber-700",
  red: "border-red-500 text-red-700",
  blue: "border-blue-500 text-blue-700",
  gray: "border-gray-400 text-gray-600",
};

const MARKER_SVG_BODY: Record<LiveFleetMapIconKind, string> = {
  truck:
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  bin:
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  landfill:
    '<path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 7.196 9.5 3.1 10.598"/><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"/><path d="m13.378 9.633 4.096 1.098 1.097-4.096"/>',
  stopped:
    '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
};

export function renderMapMarkerSvg(kind: LiveFleetMapIconKind = "truck", small = false): string {
  const size = small ? 15 : 20;
  const body = MARKER_SVG_BODY[kind] ?? MARKER_SVG_BODY.truck;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function markerBorder(marker: LiveFleetMapMarker) {
  if (marker.tone) return TONE_BORDER[marker.tone];
  return marker.delayed ? TONE_BORDER.amber : TONE_BORDER.green;
}

function markerClass(marker: LiveFleetMapMarker) {
  const size = marker.selected ? "size-9" : marker.small ? "size-7" : "size-11";
  const bg = marker.selected
    ? "bg-amber-50 ring-4 ring-amber-400/50 scale-110 shadow-xl"
    : marker.key.startsWith("facility:")
      ? "bg-emerald-50 ring-2 ring-emerald-600 ring-offset-2"
      : "bg-white";
  // Transition colors only; never transition transform near Mapbox/Leaflet native positioning.
  return `flex ${size} cursor-pointer items-center justify-center rounded-full border-2 ${markerBorder(marker)} ${bg} shadow-lg transition-colors`;
}

interface DriverMarkerEntry {
  marker: any;
  wrapper?: HTMLDivElement;
  button?: HTMLButtonElement;
  lastLng: number;
  lastLat: number;
  lastClass: string;
  lastLabel: string;
}

/** Build an untransformed Mapbox anchor wrapper around the styled marker button so zoom/pan transforms apply instantaneously. */
function createMapboxMarkerNodes(
  fleetMarker: LiveFleetMapMarker,
  nextClass: string,
  onClick: (key: string) => void,
): { wrapper: HTMLDivElement; button: HTMLButtonElement } {
  const wrapper = document.createElement("div");
  wrapper.style.margin = "0";
  wrapper.style.padding = "0";
  wrapper.style.border = "0";
  wrapper.style.background = "transparent";
  wrapper.style.display = "inline-flex";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.lineHeight = "0";
  wrapper.style.transition = "opacity 0.2s";
  if (fleetMarker.selected) wrapper.style.zIndex = "10";

  const button = document.createElement("button");
  button.type = "button";
  button.className = nextClass;
  button.title = fleetMarker.label;
  button.setAttribute("aria-label", `View ${fleetMarker.label}`);
  button.innerHTML = renderMapMarkerSvg(
    fleetMarker.icon,
    fleetMarker.small && !fleetMarker.selected,
  );
  button.addEventListener("click", () => onClick(fleetMarker.key));

  wrapper.appendChild(button);
  return { wrapper, button };
}

/** Official SWMO Sanitary Landfill destination where waste collection trucks go for disposal. */
export const SWMO_LANDFILL_MARKER: LiveFleetMapMarker = {
  key: "facility:swmo-landfill",
  label: "SWMO - Sanitary Landfill (Truck Disposal Site)",
  latitude: 13.6212151,
  longitude: 123.2576126,
  delayed: false,
  tone: "green",
  icon: "landfill",
  small: false,
};

export interface LiveFleetMapRoute {
  id: string;
  label: string;
  color: string;
  coordinates: [number, number][]; // [lng, lat][] following actual streets
  selected?: boolean;
}

export interface LiveFleetMapFocusTarget {
  key: string;
  latitude: number;
  longitude: number;
  zoom?: number;
}

interface LiveFleetMapProps {
  markers: LiveFleetMapMarker[];
  loading: boolean;
  onMarkerClick: (key: string) => void;
  emptyMessage?: string;
  showLandfill?: boolean;
  routes?: LiveFleetMapRoute[];
  selectedAreaCode?: string | null;
  onRouteClick?: (routeId: string) => void;
  focusTarget?: LiveFleetMapFocusTarget | null;
  className?: string;
}

const DEFAULT_NAGA_CENTER: [number, number] = [123.1948, 13.6218];
const NAGA_CITY_BOUNDS: [[number, number], [number, number]] = [
  [123.1, 13.52],
  [123.32, 13.75],
];

function isWithinNagaBounds(lng: number, lat: number) {
  return (
    lng >= NAGA_CITY_BOUNDS[0][0] &&
    lng <= NAGA_CITY_BOUNDS[1][0] &&
    lat >= NAGA_CITY_BOUNDS[0][1] &&
    lat <= NAGA_CITY_BOUNDS[1][1]
  );
}

function isCoordinateValid(latitude: unknown, longitude: unknown) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export default function LiveFleetMap({
  markers,
  loading,
  onMarkerClick,
  emptyMessage = "No fresh driver GPS locations.",
  showLandfill = true,
  routes = [],
  selectedAreaCode = null,
  onRouteClick,
  focusTarget = null,
  className = "relative h-[680px] w-full overflow-hidden bg-gray-100",
}: LiveFleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkersRef = useRef(new Map<string, DriverMarkerEntry>());
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const onMarkerClickRef = useRef(onMarkerClick);
  const onRouteClickRef = useRef(onRouteClick);
  const lastFitSignatureRef = useRef("");
  const lastFocusKeyRef = useRef<string | null>(null);
  const hasInitialFitRef = useRef(false);
  const prevSelectedAreaRef = useRef<string | null>(null);
  const routeListenersBoundRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const mapboxToken = getWebMapboxToken();

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    onRouteClickRef.current = onRouteClick;
  }, [onRouteClick]);

  // Sync interactive state to prevent accidental dragging/zooming while scrolling the page
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    if (isUnlocked) {
      map.dragPan?.enable();
      map.scrollZoom?.enable();
    } else {
      map.dragPan?.disable();
      map.scrollZoom?.disable();
    }
  }, [isUnlocked, mapReady]);

  // Pressing Escape locks the map back into scroll-safe mode
  useEffect(() => {
    if (!isUnlocked) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsUnlocked(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isUnlocked]);

  const [mapDefaults, setMapDefaults] = useState(() => getRuntimeSystemSettings().mapDefaults);
  const [landfillSite, setLandfillSite] = useState(() => getConfiguredLandfill());
  const initDefaultsRef = useRef(mapDefaults);
  const currentStyleUrlRef = useRef(getMapboxStyleUrl(mapDefaults.mapboxStyle));

  useEffect(() => {
    return subscribeRuntimeSettings(() => {
      setMapDefaults(getRuntimeSystemSettings().mapDefaults);
      setLandfillSite(getConfiguredLandfill());
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    if (!mapboxToken) {
      setMapReady(false);
      setMapNotice(null);
      setMapError(MISSING_MAPBOX_TOKEN_MESSAGE);
      return undefined;
    }

    let cancelled = false;
    let transientRecoveryTimer: number | null = null;
    setMapError(null);
    setMapNotice(null);
    setMapReady(false);
    routeListenersBoundRef.current = false;
    lastFitSignatureRef.current = "";
    hasInitialFitRef.current = false;
    prevSelectedAreaRef.current = null;

    const defaults = initDefaultsRef.current;
    const initialCenter: [number, number] = [
      Number.isFinite(defaults.centerLongitude) ? defaults.centerLongitude : DEFAULT_NAGA_CENTER[0],
      Number.isFinite(defaults.centerLatitude) ? defaults.centerLatitude : DEFAULT_NAGA_CENTER[1],
    ];
    const initialZoom = Number.isFinite(defaults.defaultZoom) ? defaults.defaultZoom : 13;
    const constrainNagaBounds = isWithinNagaBounds(initialCenter[0], initialCenter[1]);

    try {
      mapboxgl.accessToken = mapboxToken;
      const initialStyleUrl = getMapboxStyleUrl(defaults.mapboxStyle);
      currentStyleUrlRef.current = initialStyleUrl;

      const map = new mapboxgl.Map({
        container,
        style: initialStyleUrl,
        center: initialCenter,
        zoom: initialZoom,
        minZoom: 11,
        maxZoom: 19,
        maxBounds: constrainNagaBounds ? NAGA_CITY_BOUNDS : undefined,
        renderWorldCopies: false,
        cooperativeGestures: true,
        fadeDuration: 150,
        preserveDrawingBuffer: false,
      });
      // Start in stationary scroll-safe mode so scrolling bins list never moves or zooms the map
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      const handleLoadedOrStyle = () => {
        if (cancelled) return;
        if (transientRecoveryTimer !== null) {
          window.clearTimeout(transientRecoveryTimer);
          transientRecoveryTimer = null;
        }
        setMapError(null);
        setMapNotice(null);
        setMapReady(true);
        setStyleVersion((v) => v + 1);
        safeResizeMap(map, container);
        requestAnimationFrame(() => {
          if (!cancelled) safeResizeMap(map, container);
        });
      };

      map.on("load", handleLoadedOrStyle);
      map.on("style.load", handleLoadedOrStyle);
      map.on("idle", () => {
        if (cancelled) return;
        if (typeof map.isStyleLoaded !== "function" || map.isStyleLoaded()) {
          setMapNotice(null);
        }
      });
      map.on("error", (event) => {
        if (cancelled) return;
        const classified = classifyMapboxError(event);
        if (classified.kind === "ignore") return;
        if (classified.kind === "auth") {
          setMapError(classified.message);
          setMapNotice(null);
          return;
        }
        if (classified.kind === "webgl") {
          setMapNotice(classified.message);
          return;
        }
        setMapNotice("Map tiles delayed — retrying automatically…");
        if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded() && transientRecoveryTimer === null) {
          transientRecoveryTimer = window.setTimeout(() => {
            transientRecoveryTimer = null;
            if (!cancelled) {
              recoverMapboxStyleInPlace(map, currentStyleUrlRef.current);
            }
          }, 4000);
        }
      });

      const canvas = map.getCanvas?.();
      const handleContextLost = (e: Event) => {
        e.preventDefault();
        if (!cancelled) setMapNotice("Restoring map graphics…");
      };
      const handleContextRestored = () => {
        if (cancelled) return;
        setMapNotice(null);
        safeResizeMap(map, container);
        map.triggerRepaint?.();
      };
      canvas?.addEventListener("webglcontextlost", handleContextLost);
      canvas?.addEventListener("webglcontextrestored", handleContextRestored);

      const handleOffline = () => {
        if (!cancelled) {
          setMapNotice("Connection interrupted — map will refresh when back online.");
        }
      };
      const handleOnline = () => {
        if (cancelled) return;
        setMapNotice("Back online — refreshing map tiles…");
        recoverMapboxStyleInPlace(map, currentStyleUrlRef.current);
        safeResizeMap(map, container);
      };
      window.addEventListener("offline", handleOffline);
      window.addEventListener("online", handleOnline);

      const resizeObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              if (!cancelled) safeResizeMap(map, container);
            })
          : null;
      resizeObserver?.observe(container);
      requestAnimationFrame(() => {
        if (!cancelled) safeResizeMap(map, container);
      });

      mapRef.current = map;

      return () => {
        cancelled = true;
        if (transientRecoveryTimer !== null) window.clearTimeout(transientRecoveryTimer);
        resizeObserver?.disconnect();
        window.removeEventListener("offline", handleOffline);
        window.removeEventListener("online", handleOnline);
        canvas?.removeEventListener("webglcontextlost", handleContextLost);
        canvas?.removeEventListener("webglcontextrestored", handleContextRestored);
        routeListenersBoundRef.current = false;
        driverMarkersRef.current.forEach((entry) => entry.marker?.remove?.());
        driverMarkersRef.current.clear();
        map.remove();
        mapRef.current = null;
      };
    } catch (initError: any) {
      const classified = classifyMapboxError(initError);
      setMapError(classified.message || "Unable to initialize the fleet map.");
      return undefined;
    }
  }, [mapboxToken, retryNonce]);

  // Apply Mapbox style changes in place without tearing down WebGL context
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const nextStyleUrl = getMapboxStyleUrl(mapDefaults.mapboxStyle);
    if (currentStyleUrlRef.current === nextStyleUrl) return;
    currentStyleUrlRef.current = nextStyleUrl;
    mapRef.current.setStyle(nextStyleUrl);
  }, [mapDefaults.mapboxStyle, mapReady]);

  // Handle Street-Level Routes Layer (no geographic polygons)
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const validRoutes = (routes ?? []).filter(
      (r) => Array.isArray(r.coordinates) && r.coordinates.length >= 2,
    );

    if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) {
      const onStyleLoad = () => setStyleVersion((v) => v + 1);
      map.once("style.load", onStyleLoad);
      return () => {
        map.off("style.load", onStyleLoad);
      };
    }

    const sourceId = "street-routes";
    const casingLayerId = "street-routes-casing";
    const lineLayerId = "street-routes-line";

    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: validRoutes.map((r) => ({
        type: "Feature",
        id: r.id,
        properties: {
          id: r.id,
          label: r.label,
          color: r.color,
          selected: Boolean(r.selected || (selectedAreaCode && r.id === selectedAreaCode)),
        },
        geometry: {
          type: "LineString",
          coordinates: r.coordinates,
        },
      })),
    };

    const existingSource = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
    if (!existingSource) {
      map.addSource(sourceId, {
        type: "geojson",
        data: featureCollection,
      });

      const beforeLayer = map.getLayer("road-label") ? "road-label" : undefined;

      map.addLayer(
        {
          id: casingLayerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#ffffff",
            "line-width": ["case", ["get", "selected"], 8, 5.5],
            "line-opacity": 0.9,
          },
        },
        beforeLayer,
      );

      map.addLayer(
        {
          id: lineLayerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["case", ["get", "selected"], 5, 3],
            "line-opacity": ["case", ["get", "selected"], 0.95, 0.82],
          },
        },
        beforeLayer,
      );

      if (!routeListenersBoundRef.current) {
        routeListenersBoundRef.current = true;
        map.on("click", lineLayerId, (e: any) => {
          const feature = e.features?.[0];
          if (feature?.properties?.id) {
            onRouteClickRef.current?.(String(feature.properties.id));
          }
        });
        map.on("mouseenter", lineLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", lineLayerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    } else {
      existingSource.setData(featureCollection);
    }

    if (selectedAreaCode) {
      const targetCoords: [number, number][] = [];
      validRoutes
        .filter((r) => r.id === selectedAreaCode || r.selected)
        .forEach((r) => targetCoords.push(...r.coordinates));
      if (targetCoords.length === 0) {
        markersRef.current
          .filter((m) => isCoordinateValid(m.latitude, m.longitude))
          .forEach((m) => targetCoords.push([m.longitude, m.latitude]));
      }
      const fitSig = `area:${selectedAreaCode}:${targetCoords.length}`;
      if (targetCoords.length > 0 && lastFitSignatureRef.current !== fitSig) {
        lastFitSignatureRef.current = fitSig;
        const bounds = new mapboxgl.LngLatBounds();
        targetCoords.forEach((coord) => bounds.extend(coord));
        map.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 500 });
      }
    }
  }, [mapReady, styleVersion, routes, selectedAreaCode]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const activeLandfillMarker: LiveFleetMapMarker = {
      ...SWMO_LANDFILL_MARKER,
      label: `${landfillSite.name} (Truck Disposal Site)`,
      latitude: landfillSite.lat,
      longitude: landfillSite.lng,
    };
    const allMarkers = showLandfill ? [activeLandfillMarker, ...markers] : markers;
    const validMarkers = allMarkers.filter((marker) => isCoordinateValid(marker.latitude, marker.longitude));
    const nextDriverKeys = new Set(validMarkers.map((marker) => marker.key));

    driverMarkersRef.current.forEach((entry, key) => {
      if (nextDriverKeys.has(key)) return;
      entry.marker.remove();
      driverMarkersRef.current.delete(key);
    });
    validMarkers.forEach((fleetMarker) => {
      const lng = Number(fleetMarker.longitude);
      const lat = Number(fleetMarker.latitude);
      const coordinate: [number, number] = [lng, lat];
      const nextClass = markerClass(fleetMarker);
      const nextStateKey = `${nextClass}:${fleetMarker.icon ?? "truck"}:${fleetMarker.small ? "s" : "m"}:${fleetMarker.selected ? "1" : "0"}`;
      const existing = driverMarkersRef.current.get(fleetMarker.key);

      if (existing) {
        // Only update geographic position when actual coordinates change.
        const coordChanged =
          Math.abs(existing.lastLng - lng) > 1e-7 ||
          Math.abs(existing.lastLat - lat) > 1e-7;

        if (coordChanged) {
          existing.lastLng = lng;
          existing.lastLat = lat;
          existing.marker.setLngLat(coordinate);
        }

        if (existing.lastLabel !== fleetMarker.label) {
          existing.lastLabel = fleetMarker.label;
          if (existing.button) {
            existing.button.title = fleetMarker.label;
            existing.button.setAttribute("aria-label", `View ${fleetMarker.label}`);
          }
        }

        // Only update styling / class / icon when tone, delayed state, icon kind, or selection changes.
        if (existing.lastClass !== nextStateKey) {
          existing.lastClass = nextStateKey;
          if (existing.wrapper && existing.button) {
            existing.button.className = nextClass;
            existing.wrapper.style.zIndex = fleetMarker.selected ? "10" : "";
            existing.button.innerHTML = renderMapMarkerSvg(
              fleetMarker.icon,
              fleetMarker.small && !fleetMarker.selected,
            );
          }
        }
        return;
      }

      const { wrapper, button } = createMapboxMarkerNodes(
        fleetMarker,
        nextClass,
        (key) => onMarkerClickRef.current(key),
      );
      const marker = new mapboxgl.Marker({ element: wrapper, anchor: "center" })
        .setLngLat(coordinate)
        .addTo(map);
      driverMarkersRef.current.set(fleetMarker.key, {
        marker,
        wrapper,
        button,
        lastLng: lng,
        lastLat: lat,
        lastClass: nextStateKey,
        lastLabel: fleetMarker.label,
      });
    });

    // Auto-fit bounds ONLY on initial load or when resetting an area selection
    // NEVER on recurring GPS telemetry updates (which would cause map/bins to jitter or re-center)
    const isInitialFit = !hasInitialFitRef.current && validMarkers.length > 0 && !selectedAreaCode;
    const isAreaDeselected = prevSelectedAreaRef.current && !selectedAreaCode && validMarkers.length > 0;
    prevSelectedAreaRef.current = selectedAreaCode;

    if ((isInitialFit || isAreaDeselected) && !selectedAreaCode) {
      hasInitialFitRef.current = true;
      lastFitSignatureRef.current = "";
      const bounds = new mapboxgl.LngLatBounds();
      validMarkers.forEach((marker) => bounds.extend([marker.longitude, marker.latitude]));
      map.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 500 });
    }
  }, [mapReady, markers, selectedAreaCode, showLandfill, landfillSite.lat, landfillSite.lng, landfillSite.name]);

  // Pan/zoom to an explicitly focused marker (e.g. selected bin in Area view)
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (!focusTarget) {
      lastFocusKeyRef.current = null;
      return;
    }
    if (!isCoordinateValid(focusTarget.latitude, focusTarget.longitude)) return;
    if (lastFocusKeyRef.current === focusTarget.key) return;
    lastFocusKeyRef.current = focusTarget.key;

    const map = mapRef.current;
    const targetZoom = focusTarget.zoom ?? 16;
    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : 13;
    map.flyTo({
      center: [focusTarget.longitude, focusTarget.latitude],
      zoom: Math.max(currentZoom, targetZoom),
      duration: 500,
    });
  }, [focusTarget, mapReady]);

  return (
    <div className={className} style={{ touchAction: isUnlocked ? "none" : "pan-y" }}>
      <div ref={containerRef} className="h-full w-full" />

      {/* Stationary vs Interactive Mode Pill Button */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsUnlocked((prev) => !prev)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium shadow-sm border transition-all ${
            isUnlocked
              ? "bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700 shadow-md"
              : "bg-white/95 text-gray-700 border-gray-300 hover:bg-gray-50 backdrop-blur-xs"
          }`}
          title={
            isUnlocked
              ? "Map is unlocked for panning & zooming. Click to re-lock into scroll-safe mode (Esc)."
              : "Map is stationary. Mouse wheel and touch swipe scrolls the page/bins list. Click to unlock map drag."
          }
        >
          {isUnlocked ? (
            <>
              <Unlock className="size-3.5" />
              <span>Map Unlocked</span>
              <span className="text-[10px] opacity-80 font-normal hidden sm:inline">(Esc to lock)</span>
            </>
          ) : (
            <>
              <Lock className="size-3.5 text-gray-500" />
              <span>Stationary Map</span>
              <span className="text-[10px] text-gray-400 font-normal hidden sm:inline">(Click to drag)</span>
            </>
          )}
        </button>
      </div>

      {mapNotice && !mapError && (
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-1.5 text-xs text-amber-900 shadow-sm">
          <span>{mapNotice}</span>
          <button
            type="button"
            onClick={() => {
              if (mapRef.current) {
                recoverMapboxStyleInPlace(mapRef.current, currentStyleUrlRef.current);
                safeResizeMap(mapRef.current, containerRef.current);
              }
            }}
            className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
          >
            <RefreshCw className="size-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {mapError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/90 p-6 text-center text-sm text-red-600">
          <p className="max-w-md">{mapError}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-xs hover:bg-red-50"
          >
            <RefreshCw className="size-3.5" />
            <span>Reload Map</span>
          </button>
        </div>
      )}
      {!mapError && !loading && markers.length === 0 && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-white/95 px-4 py-2 text-sm text-gray-600 shadow">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
