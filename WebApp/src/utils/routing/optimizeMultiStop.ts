import { STOP_HANDLING_MINUTES } from "./geo";
import { runAStarSearch } from "./astar";
import {
  applyTrafficOverlay,
  buildLocalTravelCostMatrix,
  getTravelCost,
  isValidCoordinate,
  type TravelCostMatrix,
} from "./costModel";
import type { GraphNode, NodeId, OptimizedRouteResult, RouteStop } from "./types";
import { fetchDrivingDurationMatrix } from "../../services/mapboxMatrix";

interface OptimizeInput {
  depot: { id: string; coordinate: { lat: number; lng: number } };
  stops: RouteStop[];
}

const EXACT_ASTAR_STOP_LIMIT = 10;
const IMPROVEMENT_PASS_LIMIT = 8;

function computeCenter(stops: RouteStop[], depot: { lat: number; lng: number }): [number, number] {
  if (stops.length === 0) {
    return [depot.lat, depot.lng];
  }
  const lat = stops.reduce((sum, stop) => sum + stop.coordinate.lat, depot.lat) / (stops.length + 1);
  const lng = stops.reduce((sum, stop) => sum + stop.coordinate.lng, depot.lng) / (stops.length + 1);
  return [lat, lng];
}

function routeCost(order: NodeId[], matrix: TravelCostMatrix): number {
  let seconds = 0;
  for (let i = 0; i < order.length - 1; i++) {
    seconds += getTravelCost(matrix, order[i], order[i + 1]).costSeconds;
  }
  return seconds;
}

function twoOptImprove(order: NodeId[], matrix: TravelCostMatrix): NodeId[] {
  if (order.length < 4) return order;
  const improved = [...order];
  let bestCost = routeCost(improved, matrix);
  let changed = true;
  let passes = 0;

  while (changed && passes < IMPROVEMENT_PASS_LIMIT) {
    changed = false;
    passes += 1;
    for (let i = 1; i < improved.length - 2; i++) {
      for (let k = i + 1; k < improved.length - 1; k++) {
        const candidate = [...improved.slice(0, i), ...improved.slice(i, k + 1).reverse(), ...improved.slice(k + 1)];
        const candidateCost = routeCost(candidate, matrix);
        if (candidateCost + 1 < bestCost) {
          improved.splice(0, improved.length, ...candidate);
          bestCost = candidateCost;
          changed = true;
        }
      }
    }
  }

  return improved;
}

function orOptImprove(order: NodeId[], matrix: TravelCostMatrix): NodeId[] {
  if (order.length < 5) return order;
  const improved = [...order];
  let bestCost = routeCost(improved, matrix);
  let changed = true;
  let passes = 0;

  while (changed && passes < IMPROVEMENT_PASS_LIMIT) {
    changed = false;
    passes += 1;
    for (let from = 1; from < improved.length - 1; from++) {
      for (let to = 1; to < improved.length; to++) {
        if (to === from || to === from + 1) continue;
        const candidate = [...improved];
        const [moved] = candidate.splice(from, 1);
        const insertAt = to > from ? to - 1 : to;
        candidate.splice(insertAt, 0, moved);
        const candidateCost = routeCost(candidate, matrix);
        if (candidateCost + 1 < bestCost) {
          improved.splice(0, improved.length, ...candidate);
          bestCost = candidateCost;
          changed = true;
        }
      }
    }
  }

  return improved;
}

function totalDistanceAlongOrder(order: NodeId[], matrix: TravelCostMatrix): number {
  let meters = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const distance = getTravelCost(matrix, order[i], order[i + 1]).distanceMeters;
    if (Number.isFinite(distance)) meters += distance;
  }
  return meters;
}

function buildCheapestInsertionOrder(depotId: NodeId, stopNodes: GraphNode[], matrix: TravelCostMatrix): NodeId[] | null {
  const unvisited = new Set(stopNodes.map((node) => node.id));
  const order: NodeId[] = [depotId, depotId];

  while (unvisited.size > 0) {
    let bestStop: NodeId | null = null;
    let bestInsertIndex = 1;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const stopId of unvisited) {
      for (let i = 0; i < order.length - 1; i++) {
        const from = order[i];
        const to = order[i + 1];
        const delta =
          getTravelCost(matrix, from, stopId).costSeconds +
          getTravelCost(matrix, stopId, to).costSeconds -
          getTravelCost(matrix, from, to).costSeconds;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestStop = stopId;
          bestInsertIndex = i + 1;
        }
      }
    }

    if (!bestStop) return null;
    order.splice(bestInsertIndex, 0, bestStop);
    unvisited.delete(bestStop);
  }

  return order;
}

function buildAStarStateOrder(depotId: NodeId, stopNodes: GraphNode[], matrix: TravelCostMatrix): NodeId[] | null {
  if (stopNodes.length > EXACT_ASTAR_STOP_LIMIT) return null;
  const nodes = [{ id: depotId }, ...stopNodes];
  const allVisitedMask = (1 << stopNodes.length) - 1;
  const state = (currentIndex: number, visitedMask: number) => `${currentIndex}|${visitedMask}`;
  const parseState = (value: string) => {
    const [currentIndex, visitedMask] = value.split("|").map(Number);
    return { currentIndex, visitedMask };
  };

  const result = runAStarSearch({
    start: state(0, 0),
    isGoal: (value) => {
      const parsed = parseState(value);
      return parsed.currentIndex === 0 && parsed.visitedMask === allVisitedMask;
    },
    getNeighbors: (value) => {
      const { currentIndex, visitedMask } = parseState(value);
      const currentId = nodes[currentIndex].id;

      if (visitedMask === allVisitedMask) {
        return currentIndex === 0
          ? []
          : [{ to: state(0, visitedMask), cost: getTravelCost(matrix, currentId, depotId).costSeconds }];
      }

      const neighbors: Array<{ to: string; cost: number }> = [];
      for (let stopIndex = 0; stopIndex < stopNodes.length; stopIndex++) {
        const bit = 1 << stopIndex;
        if (visitedMask & bit) continue;
        const nextNodeIndex = stopIndex + 1;
        const nextId = nodes[nextNodeIndex].id;
        neighbors.push({
          to: state(nextNodeIndex, visitedMask | bit),
          cost: getTravelCost(matrix, currentId, nextId).costSeconds,
        });
      }
      return neighbors;
    },
    heuristic: (value) => {
      const { currentIndex, visitedMask } = parseState(value);
      const currentId = nodes[currentIndex].id;
      if (visitedMask === allVisitedMask) {
        return currentIndex === 0 ? 0 : getTravelCost(matrix, currentId, depotId).costSeconds;
      }

      let minFromCurrent = Number.POSITIVE_INFINITY;
      let minReturnToDepot = Number.POSITIVE_INFINITY;
      for (let stopIndex = 0; stopIndex < stopNodes.length; stopIndex++) {
        const bit = 1 << stopIndex;
        if (visitedMask & bit) continue;
        const stopId = stopNodes[stopIndex].id;
        minFromCurrent = Math.min(minFromCurrent, getTravelCost(matrix, currentId, stopId).costSeconds);
        minReturnToDepot = Math.min(minReturnToDepot, getTravelCost(matrix, stopId, depotId).costSeconds);
      }
      return (Number.isFinite(minFromCurrent) ? minFromCurrent : 0) + (Number.isFinite(minReturnToDepot) ? minReturnToDepot : 0);
    },
    maxIterations: 75000,
  });

  if (!result) return null;
  const orderedIds = result.path.map((value) => nodes[parseState(value).currentIndex].id);
  return orderedIds.filter((id, index) => index === 0 || id !== orderedIds[index - 1]);
}

/**
 * Multi-stop ordering using local costs first, with optional Mapbox traffic overlay.
 */
export async function optimizeMultiStopRouteAsync({ depot, stops }: OptimizeInput): Promise<OptimizedRouteResult | null> {
  const validStops = stops.filter((stop) => isValidCoordinate(stop.coordinate));
  if (!isValidCoordinate(depot.coordinate) || validStops.length === 0) {
    return null;
  }

  const stopNodes: GraphNode[] = validStops.map((stop) => ({
    id: stop.id,
    coordinate: stop.coordinate,
  }));

  const allNodes: GraphNode[] = [{ id: depot.id, coordinate: depot.coordinate }, ...stopNodes];
  const mapboxMatrix = await fetchDrivingDurationMatrix(allNodes);
  const usedMapbox = Boolean(mapboxMatrix && mapboxMatrix.size > 0);
  const matrix = applyTrafficOverlay(buildLocalTravelCostMatrix(allNodes), mapboxMatrix);

  const astarOrder = buildAStarStateOrder(depot.id, stopNodes, matrix);
  const initialOrder = astarOrder ?? buildCheapestInsertionOrder(depot.id, stopNodes, matrix);
  if (!initialOrder) return null;

  const improvedOrder = orOptImprove(twoOptImprove(initialOrder, matrix), matrix);
  const totalDistanceMeters = totalDistanceAlongOrder(improvedOrder, matrix);
  const totalTravelSeconds = routeCost(improvedOrder, matrix);
  const stopCount = improvedOrder.filter((id) => id !== depot.id).length;
  const estimatedDurationMinutes = Math.max(1, Math.round(totalTravelSeconds / 60 + stopCount * STOP_HANDLING_MINUTES));

  const orderedStops = improvedOrder
    .filter((nodeId) => nodeId !== depot.id)
    .map((nodeId) => validStops.find((stop) => stop.id === nodeId)!)
    .filter(Boolean);

  return {
    orderedStops,
    totalDistanceMeters,
    totalTravelSeconds,
    estimatedDurationMinutes,
    routeCenter: computeCenter(orderedStops, depot.coordinate),
    usedMapboxTraffic: usedMapbox,
    optimizationMethod: astarOrder ? "astar-state" : "insertion-2opt-oropt",
    costSource: usedMapbox ? "mapbox-traffic" : "local-estimate",
  };
}
