import AsyncStorage from "@react-native-async-storage/async-storage";
import { haversineMeters } from "./geoNav";

/** SWMO hideout — optional reference / fallback when driver GPS is unavailable. */
export const SWMO_HIDEOUT = { lat: 13.618989, lng: 123.199478 };

const CACHE_PREFIX = "nav_polyline_v2_";

/** Include ~11m-grid origin so route refetches when the truck moves meaningfully. */
export function routeGeometryFingerprint(pickupsOrdered, origin) {
  const stops =
    (pickupsOrdered ?? [])
      .map((p) => `${p.deliveryId}:${p.stopOrder}:${Number(p.lat).toFixed(5)}:${Number(p.lng).toFixed(5)}`)
      .join("|") || "empty";
  const o =
    origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
      ? `${Number(origin.lat).toFixed(4)}:${Number(origin.lng).toFixed(4)}`
      : "depot-fallback";
  return `${stops}|o:${o}`;
}

function cacheKey(fingerprint) {
  return `${CACHE_PREFIX}${fingerprint}`;
}

/**
 * @param {{ lat: number, lng: number }} origin — driver GPS or SWMO fallback
 * @param {Array<{ lat: number, lng: number, id?: string, street?: string }>} pickupsOrdered
 * @param {{ originKind?: "gps" | "depot" }} [options]
 * @returns {Array<{ lng: number, lat: number, text: string, distanceM: number }>}
 */
export function buildStraightLineGuidance(origin, pickupsOrdered, options = {}) {
  const fromGps = options?.originKind === "gps";
  const steps = [
    {
      lng: origin.lng,
      lat: origin.lat,
      text: fromGps
        ? "Route starts from your current location. Follow the green line."
        : "Start at SWMO reference (enable GPS to route from your truck). Follow the green line.",
      distanceM: 0,
    },
  ];
  const first = pickupsOrdered[0];
  if (first && Number.isFinite(first.lat) && Number.isFinite(first.lng)) {
    const label = first.id ? String(first.id) : "Next bin";
    const street = first.street ? ` — ${first.street}` : "";
    steps.push({
      lng: first.lng,
      lat: first.lat,
      text: `Next stop: ${label}${street}`,
      distanceM: haversineMeters(origin, { lat: first.lat, lng: first.lng }),
    });
  }
  return steps;
}

/**
 * @param {{ lat: number, lng: number }} depot
 * @param {Array<{ lat: number, lng: number }>} pickupsOrdered
 * @returns {Array<[number, number]>} [lng, lat] for routing APIs
 */
export function buildLngLatSequence(depot, pickupsOrdered) {
  const seq = [[depot.lng, depot.lat]];
  for (const p of pickupsOrdered) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) seq.push([lng, lat]);
  }
  return seq;
}

/** Leaflet wants [lat,lng][] */
export function lngLatToLeaflet(latLngPairsLngLat) {
  return latLngPairsLngLat.map(([lng, lat]) => [lat, lng]);
}

function parseMapboxGuidanceSteps(data) {
  const route = data?.routes?.[0];
  if (!route?.legs) return [];
  const steps = [];
  for (const leg of route.legs) {
    for (const step of leg.steps ?? []) {
      const m = step.maneuver;
      const loc = m?.location;
      if (!Array.isArray(loc) || loc.length < 2) continue;
      const text = (m && m.instruction) || step.name || "Continue on route";
      steps.push({
        lng: loc[0],
        lat: loc[1],
        text: String(text),
        distanceM: Number(step.distance) || 0,
      });
    }
  }
  return steps;
}

async function fetchMapboxDirections(coordsLngLat, token) {
  if (!token || coordsLngLat.length < 2) return null;
  const path = coordsLngLat.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${path}?geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const coords = data?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const meters = data.routes[0].distance ?? 0;
  const guidanceSteps = parseMapboxGuidanceSteps(data);
  return { leaflet: lngLatToLeaflet(coords), distanceM: meters, guidanceSteps };
}

async function fetchOpenRouteService(coordsLngLat, apiKey) {
  if (!apiKey || coordsLngLat.length < 2) return null;
  const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json, application/geo+json, */*",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      coordinates: coordsLngLat,
      options: { instructions: true },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const feat = data?.features?.[0];
  const coords = feat?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const meters = feat?.properties?.summary?.distance ?? 0;
  const guidanceSteps = parseOrsGuidanceSteps(feat);
  return { leaflet: lngLatToLeaflet(coords), distanceM: meters, guidanceSteps };
}

function parseOrsGuidanceSteps(feature) {
  const segs = feature?.properties?.segments;
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(segs) || !Array.isArray(coords)) return [];
  const steps = [];
  for (const seg of segs) {
    for (const step of seg.steps ?? []) {
      const wp = step.way_points;
      const idx = Array.isArray(wp) ? wp[0] : null;
      const ins = step.instruction || step.name;
      if (ins == null || idx == null || !coords[idx]) continue;
      const [lng, lat] = coords[idx];
      steps.push({ lng, lat, text: String(ins), distanceM: Number(step.distance) || 0 });
    }
  }
  return steps;
}

/** Straight-line path through ordered points (offline / fallback). Returns [lat,lng][] for Leaflet. */
export function straightLinePolyline(depot, pickupsOrdered) {
  const leaflet = [[depot.lat, depot.lng]];
  let meters = 0;
  let prev = depot;
  for (const p of pickupsOrdered) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const cur = { lat, lng };
    meters += haversineMeters(prev, cur);
    leaflet.push([lat, lng]);
    prev = cur;
  }
  return { leaflet, distanceM: meters };
}

/**
 * @param {object} opts
 * @param {{ lat: number, lng: number }} opts.depot
 * @param {Array<object>} opts.pickupsOrdered — items with lat, lng
 * @param {string} [opts.mapboxToken]
 * @param {string} [opts.openRouteApiKey]
 * @param {string} opts.fingerprint — for offline cache
 * @param {"gps" | "depot"} [opts.originKind] — affects fallback guidance copy
 */
export async function resolveRouteGeometry({ depot, pickupsOrdered, mapboxToken, openRouteApiKey, fingerprint, originKind }) {
  const seq = buildLngLatSequence(depot, pickupsOrdered);
  const gOpts = { originKind: originKind === "gps" ? "gps" : "depot" };
  if (seq.length < 2) {
    return { leaflet: [], distanceM: 0, source: "empty", guidanceSteps: [] };
  }

  let result = await fetchMapboxDirections(seq, mapboxToken);
  if (result) {
    const guidanceSteps = result.guidanceSteps?.length ? result.guidanceSteps : buildStraightLineGuidance(depot, pickupsOrdered, gOpts);
    const payload = { ...result, guidanceSteps, source: "mapbox" };
    await AsyncStorage.setItem(cacheKey(fingerprint), JSON.stringify(payload)).catch(() => {});
    return payload;
  }

  result = await fetchOpenRouteService(seq, openRouteApiKey);
  if (result) {
    const guidanceSteps = result.guidanceSteps?.length ? result.guidanceSteps : buildStraightLineGuidance(depot, pickupsOrdered, gOpts);
    const payload = { ...result, guidanceSteps, source: "ors" };
    await AsyncStorage.setItem(cacheKey(fingerprint), JSON.stringify(payload)).catch(() => {});
    return payload;
  }

  const straight = straightLinePolyline(depot, pickupsOrdered);
  const guidanceSteps = buildStraightLineGuidance(depot, pickupsOrdered, gOpts);
  const payload = { ...straight, source: "straight", guidanceSteps };
  await AsyncStorage.setItem(cacheKey(fingerprint), JSON.stringify(payload)).catch(() => {});
  return payload;
}

export async function loadCachedPolyline(fingerprint) {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(fingerprint));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
