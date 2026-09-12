import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

export interface LiveFleetMapMarker {
  key: string;
  label: string;
  latitude: number;
  longitude: number;
  delayed: boolean;
}

interface LiveFleetMapProps {
  markers: LiveFleetMapMarker[];
  loading: boolean;
  onMarkerClick: (key: string) => void;
}

declare global {
  interface Window {
    L?: any;
    __ecoloopLeafletPromise?: Promise<any>;
  }
}

const NAGA_CITY_CENTER: [number, number] = [123.1948, 13.6218];
const NAGA_CITY_BOUNDS: [[number, number], [number, number]] = [
  [123.1, 13.52],
  [123.32, 13.75],
];
const LEAFLET_SCRIPT_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_STYLE_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

function isCoordinateValid(latitude: unknown, longitude: unknown) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function ensureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (window.__ecoloopLeafletPromise) return window.__ecoloopLeafletPromise;

  window.__ecoloopLeafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_STYLE_URL}"]`)) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = LEAFLET_STYLE_URL;
      document.head.appendChild(style);
    }

    const script = document.createElement("script");
    script.src = LEAFLET_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Unable to load the OpenStreetMap library."));
    document.body.appendChild(script);
  });

  return window.__ecoloopLeafletPromise;
}

export default function LiveFleetMap({ markers, loading, onMarkerClick }: LiveFleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const engineRef = useRef<"mapbox" | "leaflet" | null>(null);
  const driverMarkersRef = useRef(new Map<string, any>());
  const onMarkerClickRef = useRef(onMarkerClick);
  const lastFitSignatureRef = useRef("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;
    setMapError(null);
    setMapReady(false);
    lastFitSignatureRef.current = "";

    if (mapboxToken) {
      mapboxgl.accessToken = mapboxToken;
      const map = new mapboxgl.Map({
        container,
        style: "mapbox://styles/mapbox/streets-v12",
        center: NAGA_CITY_CENTER,
        zoom: 13,
        minZoom: 11,
        maxZoom: 19,
        maxBounds: NAGA_CITY_BOUNDS,
        renderWorldCopies: false,
      });
      map.addControl(new mapboxgl.NavigationControl(), "top-right");
      map.on("load", () => {
        if (!cancelled) setMapReady(true);
      });
      map.on("error", (event) => {
        if (!cancelled && !map.loaded()) setMapError(event.error?.message ?? "Unable to load the fleet map.");
      });
      mapRef.current = map;
      engineRef.current = "mapbox";

      return () => {
        cancelled = true;
        driverMarkersRef.current.clear();
        map.remove();
        mapRef.current = null;
        engineRef.current = null;
      };
    }

    ensureLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;
        const leafletBounds = [
          [NAGA_CITY_BOUNDS[0][1], NAGA_CITY_BOUNDS[0][0]],
          [NAGA_CITY_BOUNDS[1][1], NAGA_CITY_BOUNDS[1][0]],
        ];
        const map = L.map(containerRef.current, {
          minZoom: 11,
          maxZoom: 19,
          maxBounds: leafletBounds,
          maxBoundsViscosity: 1,
        }).setView([NAGA_CITY_CENTER[1], NAGA_CITY_CENTER[0]], 13);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(map);
        mapRef.current = map;
        engineRef.current = "leaflet";
        window.setTimeout(() => map.invalidateSize(), 0);
        setMapReady(true);
      })
      .catch((error) => {
        if (!cancelled) setMapError(error?.message ?? "Unable to load the fleet map.");
      });

    return () => {
      cancelled = true;
      driverMarkersRef.current.clear();
      mapRef.current?.remove?.();
      mapRef.current = null;
      engineRef.current = null;
    };
  }, [mapboxToken]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !engineRef.current) return;
    const map = mapRef.current;
    const engine = engineRef.current;
    const validMarkers = markers.filter((marker) => isCoordinateValid(marker.latitude, marker.longitude));
    const nextDriverKeys = new Set(validMarkers.map((marker) => marker.key));

    driverMarkersRef.current.forEach((entry, key) => {
      if (nextDriverKeys.has(key)) return;
      entry.marker.remove();
      driverMarkersRef.current.delete(key);
    });
    validMarkers.forEach((fleetMarker) => {
      const coordinate: [number, number] = [fleetMarker.longitude, fleetMarker.latitude];
      const existing = driverMarkersRef.current.get(fleetMarker.key);
      if (existing) {
        if (engine === "mapbox") {
          existing.marker.setLngLat(coordinate);
          existing.element.className = fleetMarker.delayed
            ? "flex size-11 cursor-pointer items-center justify-center rounded-full border-2 border-amber-400 bg-white text-xl shadow-lg"
            : "flex size-11 cursor-pointer items-center justify-center rounded-full border-2 border-emerald-500 bg-white text-xl shadow-lg";
        } else {
          existing.marker.setLatLng([coordinate[1], coordinate[0]]);
        }
        return;
      }

      if (engine === "mapbox") {
        const element = document.createElement("button");
        element.type = "button";
        element.textContent = "🚛";
        element.title = fleetMarker.label;
        element.setAttribute("aria-label", `View ${fleetMarker.label}`);
        element.className = fleetMarker.delayed
          ? "flex size-11 cursor-pointer items-center justify-center rounded-full border-2 border-amber-400 bg-white text-xl shadow-lg"
          : "flex size-11 cursor-pointer items-center justify-center rounded-full border-2 border-emerald-500 bg-white text-xl shadow-lg";
        element.addEventListener("click", () => onMarkerClickRef.current(fleetMarker.key));
        const marker = new mapboxgl.Marker({ element, anchor: "center" }).setLngLat(coordinate).addTo(map);
        driverMarkersRef.current.set(fleetMarker.key, { marker, element });
      } else {
        const icon = window.L.divIcon({
          className: "",
          html: `<div class="flex size-11 items-center justify-center rounded-full border-2 ${fleetMarker.delayed ? "border-amber-400" : "border-emerald-500"} bg-white text-xl shadow-lg">🚛</div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        });
        const marker = window.L.marker([coordinate[1], coordinate[0]], { icon })
          .bindTooltip(fleetMarker.label, { direction: "top", offset: [0, -22] })
          .on("click", () => onMarkerClickRef.current(fleetMarker.key))
          .addTo(map);
        driverMarkersRef.current.set(fleetMarker.key, { marker });
      }
    });

    const fitSignature = validMarkers.map((marker) => marker.key).sort().join("|");
    if (validMarkers.length > 0 && fitSignature !== lastFitSignatureRef.current) {
      lastFitSignatureRef.current = fitSignature;
      if (engine === "mapbox") {
        const bounds = new mapboxgl.LngLatBounds();
        validMarkers.forEach((marker) => bounds.extend([marker.longitude, marker.latitude]));
        map.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 500 });
      } else {
        map.fitBounds(validMarkers.map((marker) => [marker.latitude, marker.longitude]), { padding: [60, 60], maxZoom: 15 });
      }
    }
  }, [mapReady, markers]);

  return (
    <div className="relative h-[680px] w-full overflow-hidden bg-gray-100">
      <div ref={containerRef} className="h-full w-full" />
      {mapError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90 p-6 text-center text-sm text-red-600">
          {mapError}
        </div>
      )}
      {!mapError && !loading && markers.length === 0 && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-white/95 px-4 py-2 text-sm text-gray-600 shadow">
          No fresh driver GPS locations.
        </div>
      )}
    </div>
  );
}
