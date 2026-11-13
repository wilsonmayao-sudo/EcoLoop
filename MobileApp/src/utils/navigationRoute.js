import AsyncStorage from "@react-native-async-storage/async-storage";
import { haversineMeters } from "./geoNav";

/** SWMO Sanitary Landfill — official disposal / dumping site from collection schedules. */
export const SWMO_LANDFILL = {
  lat: 13.6212151,
  lng: 123.2576126,
  name: "SWMO - Sanitary Landfill",
  address: "San Isidro, Naga City, Camarines Sur",
};

/** Backward-compatible alias for SWMO facility. */
export const SWMO_HIDEOUT = SWMO_LANDFILL;

const CACHE_PREFIX = "nav_polyline_v4_";
const MAX_WAYPOINTS_PER_LEG = 25;

export function isValidCoord(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}

export function formatTravelDuration(durationSeconds) {
  const mins = Math.max(1, Math.round((Number(durationSeconds) || 0) / 60));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

/** Include ~110m-grid origin bucket for cache reuse while exact GPS origin is used for fresh requests. */
export function routeGeometryFingerprint(pickupsOrdered, origin, destinationKey = "stops") {
  const stops =
    (pickupsOrdered ?? [])
      .map((p) => `${p.deliveryId ?? p.id}:${p.stopOrder ?? 0}:${Number(p.lat).toFixed(5)}:${Number(p.lng).toFixed(5)}`)
      .join("|") || "empty";
  const o =
    origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
      ? `${Number(origin.lat).toFixed(3)}:${Number(origin.lng).toFixed(3)}`
      : "depot-fallback";
  return `${destinationKey}:${stops}|o:${o}`;
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
        ? "Route starts from your current location. Follow the highlighted road path."
        : "Enable GPS to route live from your truck. Follow the highlighted road path.",
      distanceM: 0,
    },
  ];
  const first = pickupsOrdered[0];
  if (first && Number.isFinite(first.lat) && Number.isFinite(first.lng)) {
    const label = first.id ? String(first.id) : "Next stop";
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
  const seq = [];
  if (depot && isValidCoord(depot.lat, depot.lng)) {
    seq.push([Number(depot.lng), Number(depot.lat)]);
  }
  for (const p of pickupsOrdered ?? []) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!isValidCoord(lat, lng)) continue;
    const prev = seq[seq.length - 1];
    if (!prev || Math.abs(prev[0] - lng) > 1e-5 || Math.abs(prev[1] - lat) > 1e-5) {
      seq.push([lng, lat]);
    }
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

async function fetchMapboxDirectionsSegment(segmentCoordsLngLat, token) {
  const path = segmentCoordsLngLat.map(([lng, lat]) => `${lng},${lat}`).join(";");
  let sawRateLimit = false;
  let sawNoRoute = false;

  for (const profile of ["driving-traffic", "driving"]) {
    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${path}?geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
      if (!res.ok) continue;
      const data = await res.json();
      const route = data?.routes?.[0];
      const coords = route?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        return {
          leaflet: lngLatToLeaflet(coords),
          distanceM: Number(route.distance) || 0,
          durationS: Number(route.duration) || 0,
          guidanceSteps: parseMapboxGuidanceSteps(data),
        };
      }
      if (data?.code === "NoRoute" || data?.code === "NoSegment") {
        sawNoRoute = true;
      }
    } catch {
      // Try next profile or propagate failure below
    }
  }

  return {
    error: sawRateLimit
      ? "Mapbox Directions rate limit reached. Retrying shortly."
      : sawNoRoute
        ? "No drivable road route was found between the assigned stops."
        : "Unable to reach Mapbox Directions API.",
    errorCode: sawRateLimit ? "rate_limited" : sawNoRoute ? "no_route" : "api_error",
  };
}

async function stitchSegmentedDirections(coordsLngLat, fetchSegmentFn) {
  if (coordsLngLat.length < 2) return null;

  const segments = [];
  for (let i = 0; i < coordsLngLat.length - 1; i += MAX_WAYPOINTS_PER_LEG - 1) {
    const slice = coordsLngLat.slice(i, i + MAX_WAYPOINTS_PER_LEG);
    if (slice.length >= 2) segments.push(slice);
  }

  const stitchedLeaflet = [];
  const stitchedGuidance = [];
  let totalDistanceM = 0;
  let totalDurationS = 0;

  for (const seg of segments) {
    const segResult = await fetchSegmentFn(seg);
    if (!segResult || segResult.error || !segResult.leaflet?.length) {
      return segResult?.error ? { error: segResult.error, errorCode: segResult.errorCode } : null;
    }
    totalDistanceM += segResult.distanceM;
    totalDurationS += segResult.durationS;
    if (stitchedLeaflet.length === 0) {
      stitchedLeaflet.push(...segResult.leaflet);
    } else {
      stitchedLeaflet.push(...segResult.leaflet.slice(1));
    }
    stitchedGuidance.push(...(segResult.guidanceSteps ?? []));
  }

  if (stitchedLeaflet.length < 2) return null;
  return {
    leaflet: stitchedLeaflet,
    distanceM: totalDistanceM,
    durationS: totalDurationS,
    guidanceSteps: stitchedGuidance,
  };
}

async function fetchMapboxDirections(coordsLngLat, token) {
  if (!token || coordsLngLat.length < 2) return null;
  return stitchSegmentedDirections(coordsLngLat, (seg) => fetchMapboxDirectionsSegment(seg, token));
}

function formatOsrmStepInstruction(step) {
  const m = step?.maneuver ?? {};
  const type = String(m.type || "continue").replace(/_/g, " ");
  const mod = m.modifier ? ` ${m.modifier}` : "";
  const road = step?.name ? ` onto ${step.name}` : "";
  if (m.type === "arrive") return "Arrive at stop";
  if (m.type === "depart") return step?.name ? `Start on ${step.name}` : "Depart on route";
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}${mod}${road}`.trim();
}

function parseOsrmGuidanceSteps(data) {
  const route = data?.routes?.[0];
  if (!route?.legs) return [];
  const steps = [];
  for (const leg of route.legs) {
    for (const step of leg.steps ?? []) {
      const loc = step?.maneuver?.location;
      if (!Array.isArray(loc) || loc.length < 2) continue;
      steps.push({
        lng: loc[0],
        lat: loc[1],
        text: formatOsrmStepInstruction(step),
        distanceM: Number(step.distance) || 0,
      });
    }
  }
  return steps;
}

async function fetchOsrmSegment(segmentCoordsLngLat) {
  const path = segmentCoordsLngLat.map(([lng, lat]) => `${lng},${lat}`).join(";");
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${path}?geometries=geojson&overview=full&steps=true`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return {
      leaflet: lngLatToLeaflet(coords),
      distanceM: Number(route.distance) || 0,
      durationS: Number(route.duration) || 0,
      guidanceSteps: parseOsrmGuidanceSteps(data),
    };
  } catch {
    return null;
  }
}

async function fetchOsrmDirections(coordsLngLat) {
  if (coordsLngLat.length < 2) return null;
  return stitchSegmentedDirections(coordsLngLat, fetchOsrmSegment);
}

/** Straight-line path through ordered points (strictly for offline-without-cache fallback). Returns [lat,lng][]. */
export function straightLinePolyline(depot, pickupsOrdered) {
  const leaflet = [[depot.lat, depot.lng]];
  let meters = 0;
  let prev = depot;
  for (const p of pickupsOrdered) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!isValidCoord(lat, lng)) continue;
    const cur = { lat, lng };
    meters += haversineMeters(prev, cur);
    leaflet.push([lat, lng]);
    prev = cur;
  }
  return { leaflet, distanceM: meters, durationS: 0 };
}

/**
 * @param {object} opts
 * @param {{ lat: number, lng: number }} opts.depot
 * @param {Array<object>} opts.pickupsOrdered — items with lat, lng
 * @param {string} [opts.mapboxToken]
 * @param {string} opts.fingerprint — for cache
 * @param {"gps" | "depot"} [opts.originKind] — affects fallback guidance copy
 */
export async function resolveRouteGeometry({
  depot,
  pickupsOrdered,
  mapboxToken,
  fingerprint,
  originKind,
  forceRefresh = false,
}) {
  const seq = buildLngLatSequence(depot, pickupsOrdered);
  const gOpts = { originKind: originKind === "gps" ? "gps" : "depot" };
  if (seq.length < 2) {
    return {
      leaflet: [],
      distanceM: 0,
      durationS: 0,
      source: "empty",
      guidanceSteps: [],
      error: pickupsOrdered?.length ? "Valid coordinates are required to generate road directions." : undefined,
    };
  }

  if (!forceRefresh) {
    const cached = await loadCachedPolyline(fingerprint);
    if (cached?.leaflet?.length >= 2) {
      return { ...cached, source: cached.source || "mapbox-cache" };
    }
  }

  let mapboxError = null;
  if (mapboxToken) {
    const result = await fetchMapboxDirections(seq, mapboxToken);
    if (result && !result.error && result.leaflet?.length >= 2) {
      const guidanceSteps = result.guidanceSteps?.length
        ? result.guidanceSteps
        : buildStraightLineGuidance(depot, pickupsOrdered, gOpts);
      const payload = { ...result, guidanceSteps, source: "mapbox" };
      await AsyncStorage.setItem(cacheKey(fingerprint), JSON.stringify(payload)).catch(() => {});
      return payload;
    }
    mapboxError = result?.error ?? "Unable to reach Mapbox Directions API.";
  }

  const osrmResult = await fetchOsrmDirections(seq);
  if (osrmResult && osrmResult.leaflet?.length >= 2) {
    const guidanceSteps = osrmResult.guidanceSteps?.length
      ? osrmResult.guidanceSteps
      : buildStraightLineGuidance(depot, pickupsOrdered, gOpts);
    const payload = { ...osrmResult, guidanceSteps, source: "osrm" };
    await AsyncStorage.setItem(cacheKey(fingerprint), JSON.stringify(payload)).catch(() => {});
    return payload;
  }

  return {
    leaflet: [],
    distanceM: 0,
    durationS: 0,
    source: "unavailable",
    guidanceSteps: buildStraightLineGuidance(depot, pickupsOrdered, gOpts),
    error: mapboxError ?? "Mapbox Directions token is not configured for street routing.",
  };
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
