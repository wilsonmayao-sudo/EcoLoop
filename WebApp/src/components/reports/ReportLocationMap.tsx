import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { parseReportCoordinate } from "../../utils/reportMedia";
import {
  classifyMapboxError,
  getWebMapboxToken,
  MISSING_MAPBOX_TOKEN_MESSAGE,
  recoverMapboxStyleInPlace,
  safeResizeMap,
} from "../../utils/mapboxRuntime";
import {
  getMapboxStyleUrl,
  getRuntimeSystemSettings,
  subscribeRuntimeSettings,
} from "../../utils/systemSettings";

type ReportLocationMapProps = {
  latitude: unknown;
  longitude: unknown;
  className?: string;
};

/** Interactive Mapbox GL location map for citizen/driver report coordinates. */
export default function ReportLocationMap({ latitude, longitude, className = "" }: ReportLocationMapProps) {
  const lat = parseReportCoordinate(latitude);
  const lng = parseReportCoordinate(longitude);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [mapDefaults, setMapDefaults] = useState(() => getRuntimeSystemSettings().mapDefaults);
  const token = getWebMapboxToken();
  const currentStyleUrlRef = useRef(getMapboxStyleUrl(mapDefaults.mapboxStyle));
  const initCoordRef = useRef<{ lat: number; lng: number; style: string } | null>(
    lat != null && lng != null ? { lat, lng, style: currentStyleUrlRef.current } : null,
  );
  if (lat != null && lng != null && !initCoordRef.current) {
    initCoordRef.current = { lat, lng, style: currentStyleUrlRef.current };
  }

  useEffect(() => {
    return subscribeRuntimeSettings(() => {
      setMapDefaults(getRuntimeSystemSettings().mapDefaults);
    });
  }, []);

  const openHref = useMemo(
    () => (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null),
    [lat, lng],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (lat == null || lng == null || !container) return undefined;

    if (!token) {
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

    try {
      mapboxgl.accessToken = token;
      const startStyle = getMapboxStyleUrl(mapDefaults.mapboxStyle);
      currentStyleUrlRef.current = startStyle;
      const startLat = initCoordRef.current?.lat ?? lat;
      const startLng = initCoordRef.current?.lng ?? lng;

      const map = new mapboxgl.Map({
        container,
        style: startStyle,
        center: [startLng, startLat],
        zoom: 15,
        cooperativeGestures: true,
        fadeDuration: 150,
      });
      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      const marker = new mapboxgl.Marker({ color: "#059669" }).setLngLat([lng, lat]).addTo(map);

      const handleReady = () => {
        if (cancelled) return;
        if (transientRecoveryTimer !== null) {
          window.clearTimeout(transientRecoveryTimer);
          transientRecoveryTimer = null;
        }
        setMapError(null);
        setMapNotice(null);
        setMapReady(true);
        safeResizeMap(map, container);
        requestAnimationFrame(() => {
          if (!cancelled) safeResizeMap(map, container);
        });
      };

      map.on("load", handleReady);
      map.on("style.load", handleReady);
      map.on("idle", () => {
        if (!cancelled && (typeof map.isStyleLoaded !== "function" || map.isStyleLoaded())) {
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
        setMapNotice(classified.message);
        if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded() && transientRecoveryTimer === null) {
          transientRecoveryTimer = window.setTimeout(() => {
            transientRecoveryTimer = null;
            if (!cancelled) recoverMapboxStyleInPlace(map, currentStyleUrlRef.current);
          }, 4000);
        }
      });

      const canvas = map.getCanvas?.();
      const onContextLost = (e: Event) => {
        e.preventDefault();
        if (!cancelled) setMapNotice("Restoring map graphics…");
      };
      const onContextRestored = () => {
        if (cancelled) return;
        setMapNotice(null);
        safeResizeMap(map, container);
        map.triggerRepaint?.();
      };
      canvas?.addEventListener("webglcontextlost", onContextLost);
      canvas?.addEventListener("webglcontextrestored", onContextRestored);

      const onOnline = () => {
        if (cancelled) return;
        recoverMapboxStyleInPlace(map, currentStyleUrlRef.current);
        safeResizeMap(map, container);
      };
      window.addEventListener("online", onOnline);

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
      markerRef.current = marker;

      return () => {
        cancelled = true;
        if (transientRecoveryTimer !== null) window.clearTimeout(transientRecoveryTimer);
        resizeObserver?.disconnect();
        window.removeEventListener("online", onOnline);
        canvas?.removeEventListener("webglcontextlost", onContextLost);
        canvas?.removeEventListener("webglcontextrestored", onContextRestored);
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      };
    } catch (err: any) {
      const classified = classifyMapboxError(err);
      setMapError(classified.message || "Unable to load Mapbox location map.");
      return undefined;
    }
  }, [token, retryNonce, lat != null && lng != null]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const nextStyleUrl = getMapboxStyleUrl(mapDefaults.mapboxStyle);
    if (currentStyleUrlRef.current === nextStyleUrl) return;
    currentStyleUrlRef.current = nextStyleUrl;
    mapRef.current.setStyle(nextStyleUrl);
  }, [mapDefaults.mapboxStyle, mapReady]);

  useEffect(() => {
    if (lat == null || lng == null || !mapRef.current || !markerRef.current) return;
    markerRef.current.setLngLat([lng, lat]);
    mapRef.current.easeTo({ center: [lng, lat], duration: 250 });
  }, [lat, lng]);

  if (lat == null || lng == null) {
    return (
      <div className={`rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 ${className}`}>
        No GPS coordinates on file for this report.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="relative h-56 w-full min-h-[200px] overflow-hidden rounded-lg border border-gray-200 bg-gray-100 shadow-inner md:h-72">
        <div ref={containerRef} className="h-full w-full" />
        {mapNotice && !mapError && (
          <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-amber-50/95 border border-amber-200 px-2.5 py-1 text-xs text-amber-800 shadow-xs">
            {mapNotice}
          </div>
        )}
        {mapError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/90 p-4 text-center text-xs text-red-600">
            <p>{mapError}</p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="rounded border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 hover:bg-red-50"
            >
              Reload Map
            </button>
          </div>
        )}
      </div>
      {openHref && (
        <a href={openHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800">
          <ExternalLink className="size-4 shrink-0" />
          Open full map
        </a>
      )}
    </div>
  );
}
