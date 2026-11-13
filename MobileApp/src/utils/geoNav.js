const R = 6371000;

function toRad(d) {
  return (d * Math.PI) / 180;
}

/** Distance in meters between two WGS84 points. */
export function haversineMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Bearing from a → b in degrees (0 = north, clockwise). */
export function bearingDegrees(a, b) {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

export function compassRose(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

export function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/**
 * Minimum distance in meters from point {lat, lng} to a polyline of [lat, lng] pairs.
 * Uses local equirectangular projection around `point.lat` for fast mobile off-route detection.
 */
export function distanceToPolylineMeters(point, latLngPolyline) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return Infinity;
  if (!Array.isArray(latLngPolyline) || latLngPolyline.length === 0) return Infinity;
  if (latLngPolyline.length === 1) {
    const [lat, lng] = latLngPolyline[0];
    return haversineMeters(point, { lat, lng });
  }

  const cosLat = Math.cos(toRad(point.lat)) || 1;
  const toXY = (lat, lng) => ({
    x: toRad(lng - point.lng) * R * cosLat,
    y: toRad(lat - point.lat) * R,
  });

  let minSq = Infinity;
  for (let i = 0; i < latLngPolyline.length - 1; i++) {
    const [lat1, lng1] = latLngPolyline[i];
    const [lat2, lng2] = latLngPolyline[i + 1];
    if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) {
      continue;
    }
    const a = toXY(lat1, lng1);
    const b = toXY(lat2, lng2);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, (-a.x * dx - a.y * dy) / lenSq));
    }
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const distSq = projX * projX + projY * projY;
    if (distSq < minSq) minSq = distSq;
  }

  return Number.isFinite(minSq) ? Math.sqrt(minSq) : Infinity;
}
