import { haversineMeters } from "./geo";
import type { AStarResult, Graph, NodeId, NodeLookup } from "./types";

class MinPriorityQueue<T> {
  private items: Array<{ value: T; priority: number }> = [];

  enqueue(value: T, priority: number) {
    this.items.push({ value, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }

  dequeue(): T | undefined {
    return this.items.shift()?.value;
  }

  get size(): number {
    return this.items.length;
  }
}

function reconstructPath(cameFrom: Map<NodeId, NodeId>, current: NodeId): NodeId[] {
  const path = [current];
  let cursor = current;
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor)!;
    path.unshift(cursor);
  }
  return path;
}

export function runAStar(
  graph: Graph,
  nodes: NodeLookup,
  start: NodeId,
  goal: NodeId,
): AStarResult | null {
  if (!nodes.has(start) || !nodes.has(goal)) {
    return null;
  }

  const openSet = new MinPriorityQueue<NodeId>();
  const cameFrom = new Map<NodeId, NodeId>();
  const gScore = new Map<NodeId, number>();
  const fScore = new Map<NodeId, number>();

  gScore.set(start, 0);
  fScore.set(start, haversineMeters(nodes.get(start)!.coordinate, nodes.get(goal)!.coordinate));
  openSet.enqueue(start, fScore.get(start)!);

  while (openSet.size > 0) {
    const current = openSet.dequeue()!;

    if (current === goal) {
      return { path: reconstructPath(cameFrom, current), cost: gScore.get(current)! };
    }

    const neighbors = graph.get(current) ?? [];
    for (const edge of neighbors) {
      const tentativeG = (gScore.get(current) ?? Number.POSITIVE_INFINITY) + edge.cost;
      if (tentativeG < (gScore.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        cameFrom.set(edge.to, current);
        gScore.set(edge.to, tentativeG);
        const heuristic = haversineMeters(nodes.get(edge.to)!.coordinate, nodes.get(goal)!.coordinate);
        const priority = tentativeG + heuristic;
        fScore.set(edge.to, priority);
        openSet.enqueue(edge.to, priority);
      }
    }
  }

  return null;
}

