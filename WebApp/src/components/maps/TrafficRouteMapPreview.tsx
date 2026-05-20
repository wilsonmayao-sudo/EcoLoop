import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type TrafficRouteMapPreviewProps = {
  /** Latitude */
  lat: number;
  /** Longitude */
  lng: number;
  /** Optional zoom; default 12 */
  zoom?: number;
  className?: string;
};

/**
 * Mapbox GL with a navigation style that includes traffic.
 * Falls back to OSM embed when `VITE_MAPBOX_ACCESS_TOKEN` is unset.
 */
export default function TrafficRouteMapPreview({ lat, lng, zoom = 12, className = "w-full h-full min-h-[320px]" }: TrafficRouteMapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();

  useEffect(() => {
    if (!token || !containerRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/navigation-day-v1",
      center: [lng, lat],
      zoom,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    new mapboxgl.Marker({ color: "#059669" }).setLngLat([lng, lat]).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, zoom, token]);

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

  return <div ref={containerRef} className={className} />;
}
