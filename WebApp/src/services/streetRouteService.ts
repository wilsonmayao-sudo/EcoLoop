import type { BinRecord, CollectionScheduleRecord } from "../hooks/useLiveData";
import { getConfiguredLandfill, getRuntimeSystemSettings } from "../utils/systemSettings";

export type LngLat = [number, number];

export interface StreetRouteResult {
  coordinates: LngLat[];
  distanceMeters: number;
  durationSeconds: number;
  source: "mapbox-directions" | "osrm" | "cache";
}

export type StreetRouteErrorCode =
  | "invalid_coordinates"
  | "rate_limited"
  | "no_route"
  | "api_error";

export interface StreetRouteResponse {
  result: StreetRouteResult | null;
  error?: string;
  errorCode?: StreetRouteErrorCode;
}

export const SWMO_SANITARY_LANDFILL = {
  name: "SWMO - Sanitary Landfill",
  address: "San Isidro, Naga City, Camarines Sur",
  lat: 13.6212151,
  lng: 123.2576126,
} as const;

export function getActiveSanitaryLandfill() {
  return getConfiguredLandfill();
}

export const AREA_ROUTE_COLORS: Record<string, string> = {
  "AREA-1": "#2563eb",
  "AREA-2A": "#059669",
  "AREA-2B": "#0d9488",
  "AREA-3": "#7c3aed",
  "AREA-4": "#d97706",
  "AREA-5": "#db2777",
  "AREA-6": "#4f46e5",
  "AREA-7": "#ea580c",
  "AREA-8": "#16a34a",
  "AREA-9": "#0284c7",
  "AREA-10": "#8b5cf6",
  "AREA-11": "#0891b2",
  "AREA-12": "#c026d3",
  "AREA-13": "#475569",
  "AREA-15": "#e11d48",
  COMPACTOR: "#b45309",
  "FLEET-CLEARING": "#64748b",
};

const FALLBACK_PALETTE = [
  "#2563eb",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
  "#16a34a",
  "#e11d48",
];

const CACHE_PREFIX = "ecoloop_street_route_v3:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_WAYPOINTS_PER_LEG = 25;

const memoryCache = new Map<string, { expiresAt: number; data: StreetRouteResult }>();
const inflightRequests = new Map<string, Promise<StreetRouteResponse>>();

function getMapboxToken(): string | undefined {
  return (import.meta as ImportMeta & { env?: { VITE_MAPBOX_ACCESS_TOKEN?: string } }).env
    ?.VITE_MAPBOX_ACCESS_TOKEN?.trim() || undefined;
}

export function isMapboxDirectionsConfigured(): boolean {
  return Boolean(getMapboxToken());
}

export function getAreaRouteColor(areaCode: string, index = 0): string {
  const normalized = areaCode.trim().toUpperCase();
  return AREA_ROUTE_COLORS[normalized] ?? FALLBACK_PALETTE[Math.abs(index) % FALLBACK_PALETTE.length];
}

export function isValidLngLat(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}

/**
 * Deduplicate consecutive identical/near-identical waypoints (< ~1.1m apart).
 */
export function deduplicateWaypoints(points: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const [lng, lat] of points) {
    if (!isValidLngLat(lat, lng)) continue;
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev[0] - lng) > 1e-5 || Math.abs(prev[1] - lat) > 1e-5) {
      out.push([lng, lat]);
    }
  }
  return out;
}

/**
 * Extract ordered street-route waypoints for a collection area from schedule records,
 * preferring live bin coordinates when linked via `bin_id`.
 */
export function getScheduleWaypointsForArea(
  areaCode: string,
  collectionSchedules: CollectionScheduleRecord[],
  binsById: Map<string, BinRecord>,
): LngLat[] {
  const stops = collectionSchedules
    .filter((row) => row.area_code === areaCode)
    .sort((a, b) => a.stop_order - b.stop_order);

  const rawPoints: LngLat[] = [];
  for (const stop of stops) {
    const linkedBin = stop.bin_id != null ? binsById.get(String(stop.bin_id)) : undefined;
    const lat = linkedBin && isValidLngLat(linkedBin.latitude, linkedBin.longitude)
      ? Number(linkedBin.latitude)
      : Number(stop.latitude);
    const lng = linkedBin && isValidLngLat(linkedBin.latitude, linkedBin.longitude)
      ? Number(linkedBin.longitude)
      : Number(stop.longitude);
    if (isValidLngLat(lat, lng)) {
      rawPoints.push([lng, lat]);
    }
  }

  return deduplicateWaypoints(rawPoints);
}

function buildCacheKey(_id: string, waypoints: LngLat[]): string {
  const sig = waypoints.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join("|");
  return `${CACHE_PREFIX}${sig}`;
}

function readCachedRoute(key: string): StreetRouteResult | null {
  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.data;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt: number; data: StreetRouteResult };
    if (
      parsed.expiresAt > Date.now() &&
      Array.isArray(parsed.data?.coordinates) &&
      parsed.data.coordinates.length >= 2 &&
      typeof parsed.data.durationSeconds === "number"
    ) {
      memoryCache.set(key, parsed);
      return { ...parsed.data, source: "cache" };
    }
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
  return null;
}

function writeCachedRoute(key: string, data: StreetRouteResult): void {
  const entry = { expiresAt: Date.now() + CACHE_TTL_MS, data };
  memoryCache.set(key, entry);
  try {
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Ignore quota errors
  }
}

interface FetchAttemptResult {
  data: any | null;
  status: number;
  rateLimited: boolean;
  timedOut: boolean;
}

async function fetchJsonWithTimeout(url: string): Promise<FetchAttemptResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { data: null, status: res.status, rateLimited: res.status === 429, timedOut: false };
    }
    return { data: await res.json(), status: res.status, rateLimited: false, timedOut: false };
  } catch (err: any) {
    return {
      data: null,
      status: 0,
      rateLimited: false,
      timedOut: err?.name === "AbortError",
    };
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchSegmentGeometry(segment: LngLat[]): Promise<StreetRouteResponse> {
  if (segment.length < 2) {
    return {
      result: null,
      error: "At least two distinct valid coordinates are required to generate street directions.",
      errorCode: "invalid_coordinates",
    };
  }
  const path = segment.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const mapboxToken = getMapboxToken();
  let sawRateLimit = false;
  let sawNoRoute = false;

  if (mapboxToken) {
    const profiles = getRuntimeSystemSettings().operationsConfig.preferTrafficRouting
      ? (["driving-traffic", "driving"] as const)
      : (["driving"] as const);
    for (const profile of profiles) {
      const mapboxUrl = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${path}?geometries=geojson&overview=full&access_token=${encodeURIComponent(mapboxToken)}`;
      const attempt = await fetchJsonWithTimeout(mapboxUrl);
      if (attempt.rateLimited) {
        sawRateLimit = true;
        break;
      }
      if (attempt.status === 401 || attempt.status === 403) {
        break;
      }
      const route = attempt.data?.routes?.[0];
      const coords = route?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        return {
          result: {
            coordinates: coords as LngLat[],
            distanceMeters: Number(route.distance) || 0,
            durationSeconds: Number(route.duration) || 0,
            source: "mapbox-directions",
          },
        };
      }
      if (attempt.data?.code === "NoRoute" || attempt.data?.code === "NoSegment") {
        sawNoRoute = true;
      }
      if (attempt.timedOut) {
        break;
      }
    }
  }

  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${path}?geometries=geojson&overview=full`;
  const osrmAttempt = await fetchJsonWithTimeout(osrmUrl);
  if (osrmAttempt.rateLimited) {
    sawRateLimit = true;
  }
  const osrmRoute = osrmAttempt.data?.routes?.[0];
  const osrmCoords = osrmRoute?.geometry?.coordinates;
  if (Array.isArray(osrmCoords) && osrmCoords.length >= 2) {
    return {
      result: {
        coordinates: osrmCoords as LngLat[],
        distanceMeters: Number(osrmRoute.distance) || 0,
        durationSeconds: Number(osrmRoute.duration) || 0,
        source: "osrm",
      },
    };
  }

  if (sawRateLimit) {
    return {
      result: null,
      error: "Directions API rate limit reached. Please wait a moment and try again.",
      errorCode: "rate_limited",
    };
  }
  if (sawNoRoute || osrmAttempt.data?.code === "NoRoute") {
    return {
      result: null,
      error: "No drivable road route was found between the selected coordinates.",
      errorCode: "no_route",
    };
  }
  return {
    result: null,
    error: "Directions service is unavailable right now. Please verify connectivity or Mapbox configuration.",
    errorCode: "api_error",
  };
}

/**
 * Resolve a street-following GeoJSON path with distance, travel duration, and structured error details.
 * Never fabricates straight-line segments across buildings.
 */
export async function fetchStreetRouteWithFeedback(
  routeId: string,
  rawWaypoints: LngLat[],
): Promise<StreetRouteResponse> {
  const validInputCount = rawWaypoints.filter(([lng, lat]) => isValidLngLat(lat, lng)).length;
  if (validInputCount !== rawWaypoints.length) {
    return {
      result: null,
      error: "One or more stops have invalid coordinates.",
      errorCode: "invalid_coordinates",
    };
  }

  const waypoints = deduplicateWaypoints(rawWaypoints);
  if (waypoints.length < 2) {
    return {
      result: null,
      error: "At least two distinct locations are required to generate directions.",
      errorCode: "invalid_coordinates",
    };
  }

  const key = buildCacheKey(routeId, waypoints);
  const cached = readCachedRoute(key);
  if (cached) return { result: cached };

  const existingInflight = inflightRequests.get(key);
  if (existingInflight) return existingInflight;

  const task = (async (): Promise<StreetRouteResponse> => {
    const segments: LngLat[][] = [];
    for (let i = 0; i < waypoints.length - 1; i += MAX_WAYPOINTS_PER_LEG - 1) {
      const slice = waypoints.slice(i, i + MAX_WAYPOINTS_PER_LEG);
      if (slice.length >= 2) segments.push(slice);
    }

    const segmentResponses = await Promise.all(segments.map((seg) => fetchSegmentGeometry(seg)));
    const stitched: LngLat[] = [];
    let totalDistance = 0;
    let totalDuration = 0;
    let lastSource: StreetRouteResult["source"] = "mapbox-directions";

    for (const segResp of segmentResponses) {
      if (!segResp.result) return segResp;
      totalDistance += segResp.result.distanceMeters;
      totalDuration += segResp.result.durationSeconds;
      lastSource = segResp.result.source;
      if (stitched.length === 0) {
        stitched.push(...segResp.result.coordinates);
      } else {
        stitched.push(...segResp.result.coordinates.slice(1));
      }
    }

    if (stitched.length < 2) {
      return {
        result: null,
        error: "Unable to resolve street route geometry for these stops.",
        errorCode: "no_route",
      };
    }

    const finalResult: StreetRouteResult = {
      coordinates: stitched,
      distanceMeters: totalDistance,
      durationSeconds: totalDuration,
      source: lastSource,
    };
    writeCachedRoute(key, finalResult);
    return { result: finalResult };
  })().finally(() => {
    inflightRequests.delete(key);
  });

  inflightRequests.set(key, task);
  return task;
}

/**
 * Resolve a street-following GeoJSON path for the given ordered waypoints.
 * Returns null if fewer than 2 waypoints exist or road routing is unavailable
 * (never fabricates straight-line segments across buildings).
 */
export async function fetchStreetRouteGeometry(
  routeId: string,
  rawWaypoints: LngLat[],
): Promise<StreetRouteResult | null> {
  const response = await fetchStreetRouteWithFeedback(routeId, rawWaypoints);
  return response.result;
}
