/**
 * Mapbox Directions Matrix API (driving-traffic) for pairwise travel durations.
 * Used as edge weights for route stop ordering (see optimizeMultiStopRouteAsync).
 * @see https://docs.mapbox.com/api/navigation/matrix/
 */

const MAPBOX_TOKEN = (import.meta as ImportMeta & { env?: { VITE_MAPBOX_ACCESS_TOKEN?: string } }).env?.VITE_MAPBOX_ACCESS_TOKEN;

/** Mapbox Matrix allows up to 25 coordinates per request (standard tier). */
export const MAPBOX_MATRIX_MAX_COORDS = 25;
const MATRIX_CACHE_TTL_MS = 5 * 60 * 1000;
const MATRIX_TIMEOUT_MS = 3500;

const matrixCache = new Map<string, { expiresAt: number; matrix: Map<string, number> }>();

export function isMapboxConfigured(): boolean {
  return Boolean(MAPBOX_TOKEN?.trim());
}

function matrixCacheKey(nodes: { id: string; coordinate: { lat: number; lng: number } }[]): string {
  return nodes
    .map((n) => `${n.id}:${Number(n.coordinate.lat).toFixed(5)},${Number(n.coordinate.lng).toFixed(5)}`)
    .join("|");
}

/**
 * Returns duration in seconds for each ordered pair (i -> j), excluding i===j.
 * Null if token missing, too many coordinates, or request fails.
 */
export async function fetchDrivingDurationMatrix(
  nodes: { id: string; coordinate: { lat: number; lng: number } }[],
): Promise<Map<string, number> | null> {
  if (!MAPBOX_TOKEN?.trim() || nodes.length < 2) return null;
  if (nodes.length > MAPBOX_MATRIX_MAX_COORDS) {
    console.warn(
      `[mapbox] ${nodes.length} coordinates exceed Matrix limit (${MAPBOX_MATRIX_MAX_COORDS}); using haversine fallback.`,
    );
    return null;
  }

  const cacheKey = matrixCacheKey(nodes);
  const cached = matrixCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new Map(cached.matrix);
  }

  const coordPath = nodes.map((n) => `${n.coordinate.lng},${n.coordinate.lat}`).join(";");
  const url = new URL(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic/${coordPath}`);
  url.searchParams.set("access_token", MAPBOX_TOKEN.trim());
  url.searchParams.set("annotations", "duration");
  url.searchParams.set("sources", "all");
  url.searchParams.set("destinations", "all");

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), MATRIX_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text();
      console.warn("[mapbox] Matrix HTTP", res.status, body.slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { durations?: (number | null)[][] };
    const durations = data.durations;
    if (!Array.isArray(durations) || durations.length !== nodes.length) return null;

    const matrix = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const sec = durations[i]?.[j];
        if (sec == null || !Number.isFinite(sec) || sec <= 0) continue;
        matrix.set(`${nodes[i].id}->${nodes[j].id}`, sec);
      }
    }

    if (matrix.size < nodes.length * (nodes.length - 1)) {
      console.warn("[mapbox] Incomplete duration matrix; using haversine fallback.");
      return null;
    }
    matrixCache.set(cacheKey, { expiresAt: Date.now() + MATRIX_CACHE_TTL_MS, matrix: new Map(matrix) });
    return matrix;
  } catch (e) {
    console.warn("[mapbox] Matrix fetch failed:", e);
    return null;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
