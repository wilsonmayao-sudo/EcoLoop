import { useEffect, useMemo, useRef, useState } from "react";
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
import { fetchStreetRouteGeometry, type LngLat } from "../../services/streetRouteService";
import { renderMapMarkerSvg } from "./LiveFleetMap";

export type RoutePreviewStop = {
  id?: string;
  label: string;
  location?: string;
  lat: number;
  lng: number;
};

type TrafficRouteMapPreviewProps = {
  lat: number;
  lng: number;
  zoom?: number;
  className?: string;
  stops?: RoutePreviewStop[];
  depot?: { label?: string; lat: number; lng: number } | null;
  routeId?: string;
};

const ROUTE_SOURCE_ID = "planned-street-route";
const ROUTE_CASING_LAYER_ID = "planned-street-route-casing";
const ROUTE_LINE_LAYER_ID = "planned-street-route-line";

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Mapbox GL route preview with street-following Mapbox Directions
 * polyline (with OSRM street-routing fallback) and numbered stop pins.
 */
export default function TrafficRouteMapPreview({
  lat,
  lng,
  zoom = 12,
  className = "w-full h-full min-h-[320px]",
  stops = [],
  depot,
  routeId = "preview",
}: TrafficRouteMapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const previewMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [onlineRetryTick, setOnlineRetryTick] = useState(0);
  const [mapDefaults, setMapDefaults] = useState(() => getRuntimeSystemSettings().mapDefaults);
  const [landfill, setLandfill] = useState(() => getConfiguredLandfill());
  const token = getWebMapboxToken();
  const currentStyleUrlRef = useRef(getMapboxStyleUrl(mapDefaults.mapboxStyle));
  const initViewRef = useRef({ lat, lng, zoom, mapboxStyle: mapDefaults.mapboxStyle });
  const routeErrorRef = useRef<string | null>(null);
  routeErrorRef.current = routeError;

  const propsRef = useRef({ lat, lng, zoom, stops, depot, routeId, landfill });
  propsRef.current = { lat, lng, zoom, stops, depot, routeId, landfill };

  useEffect(() => {
    return subscribeRuntimeSettings(() => {
      setMapDefaults(getRuntimeSystemSettings().mapDefaults);
      setLandfill(getConfiguredLandfill());
    });
  }, []);

  const waypointsSignature = useMemo(() => {
    const stopsKey = (stops ?? [])
      .map((s) => `${Number.isFinite(s.lat) ? s.lat.toFixed(5) : "x"},${Number.isFinite(s.lng) ? s.lng.toFixed(5) : "x"}:${s.label ?? ""}`)
      .join("|");
    const depotKey = depot ? `${depot.lat},${depot.lng}:${depot.label ?? ""}` : "no-depot";
    return `${routeId}:${lat.toFixed(5)},${lng.toFixed(5)}:${zoom}:${depotKey}:${stopsKey}:${landfill.lat},${landfill.lng}:${landfill.name}:${landfill.address}`;
  }, [depot, landfill.address, landfill.lat, landfill.lng, landfill.name, lat, lng, routeId, stops, zoom]);

  // Initialize Mapbox map once per mount/token
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    if (!token) {
      setMapReady(false);
      setMapNotice(null);
      setMapError(MISSING_MAPBOX_TOKEN_MESSAGE);
      return undefined;
    }

    let cancelled = false;
    let transientRecoveryTimer: number | null = null;
    setMapReady(false);
    setMapError(null);
    setMapNotice(null);

    try {
      mapboxgl.accessToken = token;
      const initialStyleUrl = getMapboxStyleUrl(initViewRef.current.mapboxStyle);
      currentStyleUrlRef.current = initialStyleUrl;

      const map = new mapboxgl.Map({
        container,
        style: initialStyleUrl,
        center: [initViewRef.current.lng, initViewRef.current.lat],
        zoom: initViewRef.current.zoom,
        cooperativeGestures: true,
        fadeDuration: 150,
      });
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
        if (!cancelled) setMapNotice("Connection interrupted — map will refresh when online.");
      };
      const handleOnline = () => {
        if (cancelled) return;
        setMapNotice("Back online — refreshing route map…");
        recoverMapboxStyleInPlace(map, currentStyleUrlRef.current);
        safeResizeMap(map, container);
        if (routeErrorRef.current) {
          setOnlineRetryTick((t) => t + 1);
        }
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
        previewMarkersRef.current.forEach((m) => m.remove());
        previewMarkersRef.current = [];
        map.remove();
        mapRef.current = null;
      };
    } catch (initError: any) {
      const classified = classifyMapboxError(initError);
      setMapError(classified.message || "Unable to load route preview map.");
      return undefined;
    }
  }, [token, retryNonce]);

  // Apply Mapbox basemap style changes in place
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const nextStyleUrl = getMapboxStyleUrl(mapDefaults.mapboxStyle);
    if (currentStyleUrlRef.current === nextStyleUrl) return;
    currentStyleUrlRef.current = nextStyleUrl;
    mapRef.current.setStyle(nextStyleUrl);
  }, [mapDefaults.mapboxStyle, mapReady]);

  // Update markers and street-following GeoJSON polyline without recreating the WebGL map
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return undefined;

    let cancelled = false;
    setRouteError(null);

    const { lat: curLat, lng: curLng, stops: curStops, depot: curDepot, routeId: curRouteId, landfill: curLandfill } =
      propsRef.current;

    previewMarkersRef.current.forEach((m) => m.remove());
    previewMarkersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();
    const waypoints: LngLat[] = [];

    if (curDepot && Number.isFinite(curDepot.lat) && Number.isFinite(curDepot.lng)) {
      waypoints.push([curDepot.lng, curDepot.lat]);
      bounds.extend([curDepot.lng, curDepot.lat]);

      const depotEl = document.createElement("div");
      depotEl.className =
        "flex size-7 items-center justify-center rounded-full border-2 border-white bg-slate-800 text-[11px] font-bold text-white shadow";
      depotEl.textContent = "D";
      const depotMarker = new mapboxgl.Marker({ element: depotEl, anchor: "center" })
        .setLngLat([curDepot.lng, curDepot.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 14 }).setHTML(
            `<b>${curDepot.label ?? "Dispatch Depot"}</b><br><span style="font-size:12px;">Route origin</span>`,
          ),
        )
        .addTo(map);
      previewMarkersRef.current.push(depotMarker);
    }

    if (curStops.length > 0) {
      curStops.forEach((stop, index) => {
        if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
        waypoints.push([stop.lng, stop.lat]);
        bounds.extend([stop.lng, stop.lat]);

        const stopEl = document.createElement("div");
        stopEl.className =
          "flex size-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-[11px] font-bold text-white shadow";
        stopEl.textContent = String(index + 1);
        const stopMarker = new mapboxgl.Marker({ element: stopEl, anchor: "center" })
          .setLngLat([stop.lng, stop.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 14 }).setHTML(
              `<b>Stop #${index + 1}: ${stop.label}</b>${
                stop.location ? `<br><span style="font-size:12px;">${stop.location}</span>` : ""
              }`,
            ),
          )
          .addTo(map);
        previewMarkersRef.current.push(stopMarker);
      });
    } else {
      bounds.extend([curLng, curLat]);
      previewMarkersRef.current.push(
        new mapboxgl.Marker({ color: "#059669" }).setLngLat([curLng, curLat]).addTo(map),
      );
    }

    // SWMO Sanitary Landfill marker (official destination for collection trucks)
    const landfillLngLat: LngLat = [curLandfill.lng, curLandfill.lat];
    bounds.extend(landfillLngLat);
    const landfillEl = document.createElement("div");
    landfillEl.className =
      "flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-50 text-emerald-700 shadow-md";
    landfillEl.innerHTML = renderMapMarkerSvg("landfill", true);
    landfillEl.title = `${curLandfill.name} (Disposal Site)`;
    const landfillMarker = new mapboxgl.Marker({ element: landfillEl, anchor: "center" })
      .setLngLat(landfillLngLat)
      .setPopup(
        new mapboxgl.Popup({ offset: 18 }).setHTML(
          `<b>${curLandfill.name}</b><br><span style="font-size:12px;">${curLandfill.address} · Disposal Destination</span>`,
        ),
      )
      .addTo(map);
    previewMarkersRef.current.push(landfillMarker);

    const applyRouteGeoJson = (coordinates: LngLat[] | null) => {
      if (cancelled) return;
      if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) {
        map.once("style.load", () => {
          if (!cancelled) setStyleVersion((v) => v + 1);
        });
        return;
      }

      const data: GeoJSON.FeatureCollection = coordinates?.length
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates,
                },
              },
            ],
          }
        : EMPTY_FEATURE_COLLECTION;

      const existingSource = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (existingSource) {
        existingSource.setData(data);
      } else if (coordinates?.length) {
        map.addSource(ROUTE_SOURCE_ID, {
          type: "geojson",
          data,
        });
        map.addLayer({
          id: ROUTE_CASING_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: ROUTE_LINE_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#059669", "line-width": 4.5, "line-opacity": 0.92 },
        });
      }
    };

    if (waypoints.length >= 2) {
      void fetchStreetRouteGeometry(`route-preview-${curRouteId}`, [...waypoints, landfillLngLat]).then(
        (streetResult) => {
          if (cancelled) return;
          if (!streetResult || streetResult.coordinates.length < 2) {
            setRouteError("Could not load street directions for this route preview.");
            applyRouteGeoJson(null);
          } else {
            streetResult.coordinates.forEach((pt) => bounds.extend(pt));
            applyRouteGeoJson(streetResult.coordinates);
          }
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 350 });
          }
        },
      );
    } else {
      applyRouteGeoJson(null);
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 350 });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [mapReady, styleVersion, waypointsSignature, onlineRetryTick]);

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="w-full h-full" />
      {(routeError || mapNotice) && !mapError && (
        <div className="pointer-events-none absolute top-3 left-3 right-14 rounded-md bg-amber-50/95 border border-amber-200 px-3 py-1.5 text-xs text-amber-800 shadow-sm">
          {routeError ?? mapNotice}
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/90 p-4 text-center text-sm text-red-600">
          <p>{mapError}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            Reload Map
          </button>
        </div>
      )}
    </div>
  );
}
