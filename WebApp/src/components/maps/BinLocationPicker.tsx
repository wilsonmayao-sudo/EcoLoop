import React, { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

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

declare global {
  interface Window {
    L?: any;
    __ecoloopLeafletPromise?: Promise<any>;
  }
}

const DEFAULT_CENTER: Coordinate = { latitude: 13.6218, longitude: 123.1948 };
const LEAFLET_SCRIPT_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_STYLE_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

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
    script.onerror = () => reject(new Error("Unable to load the map library."));
    document.body.appendChild(script);
  });

  return window.__ecoloopLeafletPromise;
}

export default function BinLocationPicker({
  latitude,
  longitude,
  onChange,
  readOnly = false,
  className = "h-[320px] w-full",
}: BinLocationPickerProps) {
  const containerRef = useRef(null as HTMLDivElement | null);
  const mapRef = useRef(null as any);
  const markerRef = useRef(null as any);
  const onChangeRef = useRef(onChange);
  const selectedCoordinateRef = useRef(null as Coordinate | null);
  const [mapError, setMapError] = useState(null as string | null);
  const mapboxToken = ((import.meta as ImportMeta & { env?: { VITE_MAPBOX_ACCESS_TOKEN?: string } }).env?.VITE_MAPBOX_ACCESS_TOKEN ?? "").trim();

  const selectedCoordinate = useMemo((): Coordinate | null => {
    if (!isValidCoordinate(latitude, longitude)) return null;
    return { latitude: Number(latitude), longitude: Number(longitude) };
  }, [latitude, longitude]);

  const center = selectedCoordinate ?? DEFAULT_CENTER;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    selectedCoordinateRef.current = selectedCoordinate;
  }, [selectedCoordinate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;
    setMapError(null);

    if (mapboxToken) {
      mapboxgl.accessToken = mapboxToken;
      const map = new mapboxgl.Map({
        container,
        style: "mapbox://styles/mapbox/navigation-day-v1",
        center: [center.longitude, center.latitude],
        zoom: 14,
      });
      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      const marker = new mapboxgl.Marker({ color: "#059669", draggable: !readOnly })
        .setLngLat([center.longitude, center.latitude])
        .addTo(map);

      const emitCoordinate = (next: Coordinate) => {
        marker.setLngLat([next.longitude, next.latitude]);
        onChangeRef.current?.(next);
      };

      if (!readOnly) {
        map.on("click", (event) => {
          emitCoordinate({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
        });
        marker.on("dragend", () => {
          const lngLat = marker.getLngLat();
          onChangeRef.current?.({ latitude: lngLat.lat, longitude: lngLat.lng });
        });
      }

      mapRef.current = map;
      markerRef.current = marker;
      const latestCoordinate = selectedCoordinateRef.current;
      if (latestCoordinate) {
        marker.setLngLat([latestCoordinate.longitude, latestCoordinate.latitude]);
        map.setCenter([latestCoordinate.longitude, latestCoordinate.latitude]);
      }

      return () => {
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      };
    }

    ensureLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;

        const map = L.map(containerRef.current).setView([center.latitude, center.longitude], 14);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        const marker = L.marker([center.latitude, center.longitude], { draggable: !readOnly }).addTo(map);
        const emitCoordinate = (next: Coordinate) => {
          marker.setLatLng([next.latitude, next.longitude]);
          onChangeRef.current?.(next);
        };

        if (!readOnly) {
          map.on("click", (event: any) => {
            emitCoordinate({ latitude: event.latlng.lat, longitude: event.latlng.lng });
          });
          marker.on("dragend", () => {
            const latLng = marker.getLatLng();
            onChangeRef.current?.({ latitude: latLng.lat, longitude: latLng.lng });
          });
        }

        mapRef.current = map;
        markerRef.current = marker;
        const latestCoordinate = selectedCoordinateRef.current;
        if (latestCoordinate) {
          marker.setLatLng([latestCoordinate.latitude, latestCoordinate.longitude]);
          map.setView([latestCoordinate.latitude, latestCoordinate.longitude], 14);
        }
        window.setTimeout(() => map.invalidateSize(), 0);
      })
      .catch((error) => {
        if (!cancelled) setMapError(error?.message ?? "Unable to load the map.");
      });

    return () => {
      cancelled = true;
      if (mapRef.current?.remove) mapRef.current.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [mapboxToken, readOnly]);

  useEffect(() => {
    if (!selectedCoordinate || !mapRef.current || !markerRef.current) return;

    if (mapboxToken) {
      markerRef.current.setLngLat([selectedCoordinate.longitude, selectedCoordinate.latitude]);
      mapRef.current.easeTo({ center: [selectedCoordinate.longitude, selectedCoordinate.latitude], duration: 250 });
      return;
    }

    markerRef.current.setLatLng([selectedCoordinate.latitude, selectedCoordinate.longitude]);
    mapRef.current.panTo([selectedCoordinate.latitude, selectedCoordinate.longitude]);
  }, [mapboxToken, selectedCoordinate]);

  return (
    <div className={`relative overflow-hidden rounded-xl border border-gray-200 bg-gray-100 ${className}`}>
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg bg-white/95 px-3 py-2 text-xs text-gray-700 shadow">
        {readOnly ? "Current saved bin position" : "Click the map or drag the pin to set the bin coordinates."}
      </div>
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 p-4 text-center text-sm text-red-600">
          {mapError}
        </div>
      )}
    </div>
  );
}
