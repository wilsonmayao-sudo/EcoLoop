import { haversineMeters } from "./geo";
import type { Coordinate, GraphNode, OptimizationCostSource } from "./types";

const LOCAL_ROAD_FACTOR = 1.32;
const COLLECTION_SPEED_KMPH = 22;
const MIN_LEG_SECONDS = 20;

export interface TravelCost {
  costSeconds: number;
  distanceMeters: number;
  source: OptimizationCostSource;
}

export type TravelCostMatrix = Map<string, TravelCost>;

export function edgeKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`;
}

export function isValidCoordinate(coordinate: Coordinate): boolean {
  return (
    Number.isFinite(coordinate.lat) &&
    Number.isFinite(coordinate.lng) &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90 &&
    coordinate.lng >= -180 &&
    coordinate.lng <= 180
  );
}

export function estimateLocalTravelCost(from: Coordinate, to: Coordinate): TravelCost {
  const straightLineMeters = haversineMeters(from, to);
  const distanceMeters = straightLineMeters * LOCAL_ROAD_FACTOR;
  const costSeconds = Math.max(MIN_LEG_SECONDS, (distanceMeters / 1000 / COLLECTION_SPEED_KMPH) * 3600);
  return { costSeconds, distanceMeters, source: "local-estimate" };
}

export function buildLocalTravelCostMatrix(nodes: GraphNode[]): TravelCostMatrix {
  const matrix: TravelCostMatrix = new Map();

  for (const from of nodes) {
    for (const to of nodes) {
      if (from.id === to.id) continue;
      matrix.set(edgeKey(from.id, to.id), estimateLocalTravelCost(from.coordinate, to.coordinate));
    }
  }

  return matrix;
}

export function applyTrafficOverlay(
  localMatrix: TravelCostMatrix,
  trafficDurationSeconds: Map<string, number> | null,
): TravelCostMatrix {
  if (!trafficDurationSeconds || trafficDurationSeconds.size === 0) return localMatrix;

  const hybrid: TravelCostMatrix = new Map();
  for (const [key, localCost] of localMatrix) {
    const trafficSeconds = trafficDurationSeconds.get(key);
    hybrid.set(key, {
      ...localCost,
      costSeconds: trafficSeconds && Number.isFinite(trafficSeconds) ? trafficSeconds : localCost.costSeconds,
      source: trafficSeconds && Number.isFinite(trafficSeconds) ? "mapbox-traffic" : localCost.source,
    });
  }

  return hybrid;
}

export function getTravelCost(matrix: TravelCostMatrix, from: string, to: string): TravelCost {
  return (
    matrix.get(edgeKey(from, to)) ?? {
      costSeconds: Number.POSITIVE_INFINITY,
      distanceMeters: Number.POSITIVE_INFINITY,
      source: "local-estimate",
    }
  );
}
