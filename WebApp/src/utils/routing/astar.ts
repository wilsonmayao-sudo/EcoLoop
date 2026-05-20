import { haversineMeters } from "./geo";
import type { AStarResult, Graph, NodeId, NodeLookup } from "./types";

type SearchNodeId = string;

interface QueueEntry<T> {
  value: T;
  priority: number;
  score: number;
  order: number;
}

class MinPriorityQueue<T> {
  private heap: QueueEntry<T>[] = [];
  private nextOrder = 0;

  enqueue(value: T, priority: number, score: number) {
    this.heap.push({ value, priority, score, order: this.nextOrder++ });
    this.bubbleUp(this.heap.length - 1);
  }

  dequeue(): QueueEntry<T> | undefined {
    if (this.heap.length === 0) return undefined;
    const min = this.heap[0];
    const end = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = end;
      this.sinkDown(0);
    }
    return min;
  }

  get size(): number {
    return this.heap.length;
  }

  private isHigherPriority(a: QueueEntry<T>, b: QueueEntry<T>) {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.order < b.order;
  }

  private bubbleUp(index: number) {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (!this.isHigherPriority(this.heap[child], this.heap[parent])) break;
      [this.heap[parent], this.heap[child]] = [this.heap[child], this.heap[parent]];
      child = parent;
    }
  }

  private sinkDown(index: number) {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;

      if (left < this.heap.length && this.isHigherPriority(this.heap[left], this.heap[best])) {
        best = left;
      }
      if (right < this.heap.length && this.isHigherPriority(this.heap[right], this.heap[best])) {
        best = right;
      }
      if (best === parent) break;
      [this.heap[parent], this.heap[best]] = [this.heap[best], this.heap[parent]];
      parent = best;
    }
  }
}

function reconstructPath<T extends SearchNodeId>(cameFrom: Map<T, T>, current: T): T[] {
  const path = [current];
  let cursor = current;
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor)!;
    path.unshift(cursor);
  }
  return path;
}

export interface AStarSearchOptions<T extends SearchNodeId> {
  start: T;
  isGoal: (node: T) => boolean;
  getNeighbors: (node: T) => Array<{ to: T; cost: number }>;
  heuristic?: (node: T) => number;
  heuristicWeight?: number;
  maxIterations?: number;
}

export function runAStarSearch<T extends SearchNodeId>({
  start,
  isGoal,
  getNeighbors,
  heuristic = () => 0,
  heuristicWeight = 1,
  maxIterations = 100000,
}: AStarSearchOptions<T>): AStarResult | null {
  const openSet = new MinPriorityQueue<T>();
  const cameFrom = new Map<T, T>();
  const gScore = new Map<T, number>();
  const closed = new Set<T>();
  let iterations = 0;

  gScore.set(start, 0);
  openSet.enqueue(start, heuristic(start) * heuristicWeight, 0);

  while (openSet.size > 0 && iterations < maxIterations) {
    iterations += 1;
    const entry = openSet.dequeue()!;
    const current = entry.value;
    const knownScore = gScore.get(current) ?? Number.POSITIVE_INFINITY;

    if (entry.score > knownScore) continue;
    if (closed.has(current)) continue;

    if (isGoal(current)) {
      return { path: reconstructPath(cameFrom, current), cost: knownScore, visitedCount: closed.size };
    }

    closed.add(current);

    for (const edge of getNeighbors(current)) {
      if (!Number.isFinite(edge.cost) || edge.cost < 0 || closed.has(edge.to)) continue;
      const tentativeG = knownScore + edge.cost;
      if (tentativeG < (gScore.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        cameFrom.set(edge.to, current);
        gScore.set(edge.to, tentativeG);
        openSet.enqueue(edge.to, tentativeG + heuristic(edge.to) * heuristicWeight, tentativeG);
      }
    }
  }

  return null;
}

export function runAStar(
  graph: Graph,
  nodes: NodeLookup,
  start: NodeId,
  goal: NodeId,
  options: { heuristicWeight?: number; maxIterations?: number } = {},
): AStarResult | null {
  if (!nodes.has(start) || !nodes.has(goal)) {
    return null;
  }

  const heuristicCache = new Map<NodeId, number>();
  const heuristic = (nodeId: NodeId) => {
    const cached = heuristicCache.get(nodeId);
    if (cached != null) return cached;
    const value = haversineMeters(nodes.get(nodeId)!.coordinate, nodes.get(goal)!.coordinate);
    heuristicCache.set(nodeId, value);
    return value;
  };

  return runAStarSearch({
    start,
    isGoal: (node) => node === goal,
    getNeighbors: (node) => graph.get(node) ?? [],
    heuristic,
    heuristicWeight: options.heuristicWeight,
    maxIterations: options.maxIterations,
  });
}

