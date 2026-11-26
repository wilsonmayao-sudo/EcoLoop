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
  getMapboxStyleUrl,
  getRuntimeSystemSettings,
  subscribeRuntimeSettings,
} from "../../utils/systemSettings";

type Coordinate = {
  latitude: number;
  longitude: number;
};

type BinLocationPickerProps = {
  latitude?: number | null;
  longitude?: number | null;
  onChange?: (coordinate: Coordinate) => void;
  readOnly?: boolean;
  className?: string;
};

const DEFAULT_CENTER: Coordinate = { latitude: 13.6218, longitude: 123.1948 };

function isValidCoordinate(latitude?: number | null, longitude?: number | null) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Number(latitude) >= -90 &&
    Number(latitude) <= 90 &&
    Number(longitude) >= -180 &&
    Number(longitude) <= 180
  );
}

export default function BinLocationPicker({
  latitude,
  longitude,
  onChange,
  readOnly = false,
  className = "h-[320px] w-full",
}: BinLocationPickerProps) {
  const containerRef = useRef(null as HTMLDivElement | null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const readOnlyRef = useRef(readOnly);
  const selectedCoordinateRef = useRef(null as Coordinate | null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null as string | null);
  const [mapNotice, setMapNotice] = useState(null as string | null);
  const [retryNonce, setRetryNonce] = useState(0);
  const mapboxToken = getWebMapboxToken();

  const selectedCoordinate = useMemo((): Coordinate | null => {
    if (!isValidCoordinate(latitude, longitude)) return null;
    return { latitude: Number(latitude), longitude: Number(longitude) };
  }, [latitude, longitude]);

  const [mapDefaults, setMapDefaults] = useState(() => getRuntimeSystemSettings().mapDefaults);
  const initDefaultsRef = useRef(mapDefaults);
  const currentStyleUrlRef = useRef(getMapboxStyleUrl(mapDefaults.mapboxStyle));

  useEffect(() => {
    return subscribeRuntimeSettings(() => {
      setMapDefaults(getRuntimeSystemSettings().mapDefaults);
    });
  }, []);

  const initialCenter = selectedCoordinate ?? {
    latitude: initDefaultsRef.current.centerLatitude ?? DEFAULT_CENTER.latitude,
    longitude: initDefaultsRef.current.centerLongitude ?? DEFAULT_CENTER.longitude,
  };
  const initialPickerZoom = selectedCoordinate
    ? Math.max(14, initDefaultsRef.current.defaultZoom)
    : initDefaultsRef.current.defaultZoom;
  const initialCenterRef = useRef({ center: initialCenter, zoom: initialPickerZoom });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    markerRef.current?.setDraggable?.(!readOnly);
  }, [readOnly]);

  useEffect(() => {
    selectedCoordinateRef.current = selectedCoordinate;
  }, [selectedCoordinate]);

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

    const { center, zoom } = initialCenterRef.current;
    const latestCoordOnMount = selectedCoordinateRef.current ?? center;
    const mountZoom = selectedCoordinateRef.current ? Math.max(14, initDefaultsRef.current.defaultZoom) : zoom;

    try {
      mapboxgl.accessToken = mapboxToken;
      const initialStyleUrl = getMapboxStyleUrl(initDefaultsRef.current.mapboxStyle);
      currentStyleUrlRef.current = initialStyleUrl;

      const map = new mapboxgl.Map({
        container,
        style: initialStyleUrl,
        center: [latestCoordOnMount.longitude, latestCoordOnMount.latitude],
        zoom: mountZoom,
        cooperativeGestures: true,
        fadeDuration: 150,
      });
      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      const marker = new mapboxgl.Marker({ color: "#059669", draggable: !readOnlyRef.current })
        .setLngLat([latestCoordOnMount.longitude, latestCoordOnMount.latitude])
        .addTo(map);

      const emitCoordinate = (next: Coordinate) => {
        marker.setLngLat([next.longitude, next.latitude]);
        onChangeRef.current?.(next);
      };

      map.on("click", (event) => {
        if (readOnlyRef.current) return;
        emitCoordinate({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      });
      marker.on("dragend", () => {
        if (readOnlyRef.current) return;
        const lngLat = marker.getLngLat();
        onChangeRef.current?.({ latitude: lngLat.lat, longitude: lngLat.lng });
      });

      const handleLoadedOrStyle = () => {
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
        if (!cancelled) setMapNotice("Connection interrupted — retrying when online.");
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
      markerRef.current = marker;

      return () => {
        cancelled = true;
        if (transientRecoveryTimer !== null) window.clearTimeout(transientRecoveryTimer);
        resizeObserver?.disconnect();
        window.removeEventListener("offline", handleOffline);
        window.removeEventListener("online", handleOnline);
        canvas?.removeEventListener("webglcontextlost", handleContextLost);
        canvas?.removeEventListener("webglcontextrestored", handleContextRestored);
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      };
    } catch (initError: any) {
      const classified = classifyMapboxError(initError);
      setMapError(classified.message || "Unable to load the Mapbox map.");
      return undefined;
    }
  }, [mapboxToken, retryNonce]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const nextStyleUrl = getMapboxStyleUrl(mapDefaults.mapboxStyle);
    if (currentStyleUrlRef.current === nextStyleUrl) return;
    currentStyleUrlRef.current = nextStyleUrl;
    mapRef.current.setStyle(nextStyleUrl);
  }, [mapDefaults.mapboxStyle, mapReady]);

  useEffect(() => {
    if (!selectedCoordinate || !mapRef.current || !markerRef.current) return;
    markerRef.current.setLngLat([selectedCoordinate.longitude, selectedCoordinate.latitude]);
    mapRef.current.easeTo({ center: [selectedCoordinate.longitude, selectedCoordinate.latitude], duration: 250 });
  }, [selectedCoordinate]);

  return (
    <div className={`relative overflow-hidden rounded-xl border border-gray-200 bg-gray-100 ${className}`} style={{ touchAction: "pan-y" }}>
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg bg-white/95 px-3 py-2 text-xs text-gray-700 shadow">
        {readOnly ? "Current saved bin position" : "Click the map or drag the pin to set the bin coordinates."}
      </div>
      {mapNotice && !mapError && (
        <div className="absolute bottom-3 left-3 z-20 rounded-md border border-amber-200 bg-amber-50/95 px-3 py-1.5 text-xs text-amber-900 shadow-sm">
          {mapNotice}
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
