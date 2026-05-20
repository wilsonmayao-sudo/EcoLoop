import { estimateDurationMinutes, haversineMeters, STOP_HANDLING_MINUTES } from "./geo";
import type { GraphNode, NodeId, OptimizedRouteResult, RouteStop } from "./types";
import { fetchDrivingDurationMatrix } from "../../services/mapboxMatrix";

interface OptimizeInput {
  depot: { id: string; coordinate: { lat: number; lng: number } };
  stops: RouteStop[];
}

function computeCenter(stops: RouteStop[], depot: { lat: number; lng: number }): [number, number] {
  if (stops.length === 0) {
    return [depot.lat, depot.lng];
  }
  const lat = stops.reduce((sum, stop) => sum + stop.coordinate.lat, depot.lat) / (stops.length + 1);
  const lng = stops.reduce((sum, stop) => sum + stop.coordinate.lng, depot.lng) / (stops.length + 1);
  return [lat, lng];
}

function twoOptImprove(order: NodeId[], matrix: Map<string, number>): NodeId[] {
  if (order.length < 4) return order;
  const improved = [...order];
  let changed = true;

  const edgeCost = (from: NodeId, to: NodeId) => matrix.get(`${from}->${to}`) ?? Number.POSITIVE_INFINITY;

  while (changed) {
    changed = false;
    for (let i = 1; i < improved.length - 2; i++) {
      for (let k = i + 1; k < improved.length - 1; k++) {
        const a = improved[i - 1];
        const b = improved[i];
        const c = improved[k];
        const d = improved[k + 1];
        const current = edgeCost(a, b) + edgeCost(c, d);
        const swapped = edgeCost(a, c) + edgeCost(b, d);
        if (swapped < current) {
          const reversed = improved.slice(i, k + 1).reverse();
          improved.splice(i, k - i + 1, ...reversed);
          changed = true;
        }
      }
    }
  }

  return improved;
}

function buildHaversineCostMatrix(allNodes: GraphNode[]): Map<string, number> {
  const matrix = new Map<string, number>();
  for (const from of allNodes) {
    for (const to of allNodes) {
      if (from.id === to.id) continue;
      matrix.set(`${from.id}->${to.id}`, haversineMeters(from.coordinate, to.coordinate));
    }
  }
  return matrix;
}

function totalHaversineAlongOrder(order: NodeId[], nodeById: Map<NodeId, GraphNode>): number {
  let meters = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const a = nodeById.get(order[i]);
    const b = nodeById.get(order[i + 1]);
    if (!a || !b) continue;
    meters += haversineMeters(a.coordinate, b.coordinate);
  }
  return meters;
}

function totalMatrixSecondsAlongOrder(order: NodeId[], matrix: Map<string, number>): number {
  let sec = 0;
  for (let i = 0; i < order.length - 1; i++) {
    sec += matrix.get(`${order[i]}->${order[i + 1]}`) ?? 0;
  }
  return sec;
}

/**
 * Multi-stop ordering using greedy insertion + 2-opt.
 * Edge costs prefer Mapbox Matrix **driving-traffic** durations (seconds); otherwise haversine meters.
 */
export async function optimizeMultiStopRouteAsync({ depot, stops }: OptimizeInput): Promise<OptimizedRouteResult | null> {
  if (stops.length === 0) {
    return null;
  }

  const stopNodes: GraphNode[] = stops.map((stop) => ({
    id: stop.id,
    coordinate: stop.coordinate,
  }));

  const allNodes: GraphNode[] = [{ id: depot.id, coordinate: depot.coordinate }, ...stopNodes];
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  const mapboxMatrix = await fetchDrivingDurationMatrix(allNodes);
  const usedMapbox = Boolean(mapboxMatrix && mapboxMatrix.size > 0);
  const matrix = usedMapbox ? mapboxMatrix! : buildHaversineCostMatrix(allNodes);

  const unvisited = new Set(stopNodes.map((node) => node.id));
  const visitOrder: NodeId[] = [depot.id];
  let current = depot.id;

  while (unvisited.size > 0) {
    let bestNode: NodeId | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const candidate of unvisited) {
      const cost = matrix.get(`${current}->${candidate}`) ?? Number.POSITIVE_INFINITY;
      if (cost < bestCost) {
        bestCost = cost;
        bestNode = candidate;
      }
    }
    if (!bestNode) return null;
    visitOrder.push(bestNode);
    unvisited.delete(bestNode);
    current = bestNode;
  }

  visitOrder.push(depot.id);
  const improvedOrder = twoOptImprove(visitOrder, matrix);

  const totalDistanceMeters = totalHaversineAlongOrder(improvedOrder, nodeById);

  let estimatedDurationMinutes: number;
  if (usedMapbox) {
    const travelSec = totalMatrixSecondsAlongOrder(improvedOrder, matrix);
    const travelMin = travelSec / 60;
    const stopCount = improvedOrder.filter((id) => id !== depot.id).length;
    estimatedDurationMinutes = Math.max(1, Math.round(travelMin + stopCount * STOP_HANDLING_MINUTES));
  } else {
    estimatedDurationMinutes = estimateDurationMinutes(totalDistanceMeters, stops.length);
  }

  const orderedStops = improvedOrder
    .filter((nodeId) => nodeId !== depot.id)
    .map((nodeId) => stops.find((stop) => stop.id === nodeId)!)
    .filter(Boolean);

  return {
    orderedStops,
    totalDistanceMeters,
    estimatedDurationMinutes,
    routeCenter: computeCenter(orderedStops, depot.coordinate),
    usedMapboxTraffic: usedMapbox,
  };
}
