import { haversineMeters } from "./geo";
import type { Graph, GraphNode, NodeLookup } from "./types";

export function buildCompleteGraph(nodes: GraphNode[]): { graph: Graph; nodeLookup: NodeLookup } {
  const graph: Graph = new Map();
  const nodeLookup: NodeLookup = new Map(nodes.map((node) => [node.id, node]));

  for (const source of nodes) {
    const edges = [];
    for (const target of nodes) {
      if (source.id === target.id) continue;
      const distance = haversineMeters(source.coordinate, target.coordinate);
      edges.push({ to: target.id, cost: distance });
    }
    graph.set(source.id, edges);
  }

  return { graph, nodeLookup };
}

