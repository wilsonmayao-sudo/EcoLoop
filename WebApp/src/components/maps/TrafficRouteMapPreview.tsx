import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  fetchStreetRouteGeometry,
  type LngLat,
} from "../../services/streetRouteService";
import {
  getConfiguredLandfill,
  getMapboxStyleUrl,
  getRuntimeSystemSettings,
  subscribeRuntimeSettings,
} from "../../utils/systemSettings";
import { renderMapMarkerSvg } from "./LiveFleetMap";

export interface RoutePreviewStop {
  id: string;
  label: string;
  location?: string;
  lat: number;
  lng: number;
}

type TrafficRouteMapPreviewProps = {
  /** Latitude */
  lat: number;
  /** Longitude */
  lng: number;
  /** Optional zoom; default 12 */
  zoom?: number;
  className?: string;
  /** Ordered stops for the planned route */
  stops?: RoutePreviewStop[];
  /** Starting depot coordinate */
  depot?: { lat: number; lng: number; label?: string };
  /** Optional route ID for direction caching */
  routeId?: string;
};

/**
 * Mapbox GL route preview with live traffic style, street-following Mapbox Directions
 * geometry, ordered stop markers, and SWMO Sanitary Landfill disposal destination.
 * Falls back to OSM embed when `VITE_MAPBOX_ACCESS_TOKEN` is unset.
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
  const [routeError, setRouteError] = useState<string | null>(null);
  const [mapDefaults, setMapDefaults] = useState(() => getRuntimeSystemSettings().mapDefaults);
  const [landfill, setLandfill] = useState(() => getConfiguredLandfill());
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

  useEffect(() => {
    return subscribeRuntimeSettings(() => {
      setMapDefaults(getRuntimeSystemSettings().mapDefaults);
      setLandfill(getConfiguredLandfill());
    });
  }, []);

  useEffect(() => {
    if (!token || !containerRef.current) return;

    let cancelled = false;
    setRouteError(null);
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: getMapboxStyleUrl(mapDefaults.mapboxStyle),
      center: [lng, lat],
      zoom,
      cooperativeGestures: true,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    const bounds = new mapboxgl.LngLatBounds();
    const waypoints: LngLat[] = [];

    if (depot && Number.isFinite(depot.lat) && Number.isFinite(depot.lng)) {
      waypoints.push([depot.lng, depot.lat]);
      bounds.extend([depot.lng, depot.lat]);

      const depotEl = document.createElement("div");
      depotEl.className =
        "flex size-7 items-center justify-center rounded-full border-2 border-white bg-slate-800 text-[11px] font-bold text-white shadow";
      depotEl.textContent = "D";
      new mapboxgl.Marker({ element: depotEl, anchor: "center" })
        .setLngLat([depot.lng, depot.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 14 }).setHTML(
            `<b>${depot.label ?? "Dispatch Depot"}</b><br><span style="font-size:12px;">Route origin</span>`,
          ),
        )
        .addTo(map);
    }

    if (stops.length > 0) {
      stops.forEach((stop, index) => {
        if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
        waypoints.push([stop.lng, stop.lat]);
        bounds.extend([stop.lng, stop.lat]);

        const stopEl = document.createElement("div");
        stopEl.className =
          "flex size-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-[11px] font-bold text-white shadow";
        stopEl.textContent = String(index + 1);
        new mapboxgl.Marker({ element: stopEl, anchor: "center" })
          .setLngLat([stop.lng, stop.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 14 }).setHTML(
              `<b>Stop #${index + 1}: ${stop.label}</b>${
                stop.location ? `<br><span style="font-size:12px;">${stop.location}</span>` : ""
              }`,
            ),
          )
          .addTo(map);
      });
    } else {
      bounds.extend([lng, lat]);
      new mapboxgl.Marker({ color: "#059669" }).setLngLat([lng, lat]).addTo(map);
    }

    // SWMO Sanitary Landfill marker (official destination for collection trucks)
    const landfillLngLat: LngLat = [landfill.lng, landfill.lat];
    bounds.extend(landfillLngLat);
    const landfillEl = document.createElement("div");
    landfillEl.className =
      "flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-50 text-emerald-700 shadow-md";
    landfillEl.innerHTML = renderMapMarkerSvg("landfill", true);
    landfillEl.title = `${landfill.name} (Disposal Site)`;
    new mapboxgl.Marker({ element: landfillEl, anchor: "center" })
      .setLngLat(landfillLngLat)
      .setPopup(
        new mapboxgl.Popup({ offset: 18 }).setHTML(
          `<b>${landfill.name}</b><br><span style="font-size:12px;">${landfill.address} · Disposal Destination</span>`,
        ),
      )
      .addTo(map);

    map.on("load", async () => {
      if (waypoints.length >= 2) {
        const streetResult = await fetchStreetRouteGeometry(
          `route-preview-${routeId}`,
          [...waypoints, landfillLngLat],
        );
        if (cancelled) return;

        if (!streetResult || streetResult.coordinates.length < 2) {
          setRouteError("Could not load street directions for this route preview.");
        } else {
          streetResult.coordinates.forEach((pt) => bounds.extend(pt));
          map.addSource("planned-street-route", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: streetResult.coordinates,
              },
            },
          });
          map.addLayer({
            id: "planned-street-route-casing",
            type: "line",
            source: "planned-street-route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 },
          });
          map.addLayer({
            id: "planned-street-route-line",
            type: "line",
            source: "planned-street-route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#059669", "line-width": 4.5, "line-opacity": 0.92 },
          });
        }
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 350 });
      }
    });

    mapRef.current = map;

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, zoom, token, stops, depot, routeId, mapDefaults.mapboxStyle, landfill.lat, landfill.lng, landfill.name, landfill.address]);

  if (!token) {
    const pad = 0.02;
    const bbox = `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
    return (
      <div className={`relative ${className}`}>
        <iframe width="100%" height="100%" style={{ border: 0 }} src={src} title="Route map" />
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="w-full h-full" />
      {routeError && (
        <div className="pointer-events-none absolute top-3 left-3 right-14 rounded-md bg-amber-50/95 border border-amber-200 px-3 py-1.5 text-xs text-amber-800 shadow-sm">
          {routeError}
        </div>
      )}
    </div>
  );
}
