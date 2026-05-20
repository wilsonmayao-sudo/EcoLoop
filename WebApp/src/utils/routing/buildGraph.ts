import { estimateLocalTravelCost, getTravelCost, type TravelCostMatrix } from "./costModel";
import type { Graph, GraphNode, NodeLookup } from "./types";

interface BuildGraphOptions {
  maxNeighbors?: number;
  costs?: TravelCostMatrix;
}

export function buildCompleteGraph(nodes: GraphNode[], costs?: TravelCostMatrix): { graph: Graph; nodeLookup: NodeLookup } {
  const graph: Graph = new Map();
  const nodeLookup: NodeLookup = new Map(nodes.map((node) => [node.id, node]));

  for (const source of nodes) {
    const edges = [];
    for (const target of nodes) {
      if (source.id === target.id) continue;
      const cost = costs?.get(`${source.id}->${target.id}`) ?? estimateLocalTravelCost(source.coordinate, target.coordinate);
      edges.push({ to: target.id, cost: cost.costSeconds, distanceMeters: cost.distanceMeters, durationSeconds: cost.costSeconds });
    }
    graph.set(source.id, edges);
  }

  return { graph, nodeLookup };
}

export function buildNearestNeighborGraph(nodes: GraphNode[], options: BuildGraphOptions = {}): { graph: Graph; nodeLookup: NodeLookup } {
  const graph: Graph = new Map();
  const nodeLookup: NodeLookup = new Map(nodes.map((node) => [node.id, node]));
  const maxNeighbors = Math.max(1, options.maxNeighbors ?? Math.min(8, nodes.length - 1));

  for (const source of nodes) {
    const rankedTargets = nodes
      .filter((target) => target.id !== source.id)
      .map((target) => ({
        target,
        cost: options.costs
          ? getTravelCost(options.costs, source.id, target.id)
          : estimateLocalTravelCost(source.coordinate, target.coordinate),
      }))
      .sort((a, b) => a.cost.distanceMeters - b.cost.distanceMeters)
      .slice(0, maxNeighbors);

    graph.set(
      source.id,
      rankedTargets.map(({ target, cost }) => ({
        to: target.id,
        cost: cost.costSeconds,
        distanceMeters: cost.distanceMeters,
        durationSeconds: cost.costSeconds,
      })),
    );
  }

  return { graph, nodeLookup };
}

