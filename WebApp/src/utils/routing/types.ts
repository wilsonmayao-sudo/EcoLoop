export type NodeId = string;

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface GraphNode {
  id: NodeId;
  coordinate: Coordinate;
}

export interface GraphEdge {
  to: NodeId;
  cost: number;
  distanceMeters?: number;
  durationSeconds?: number;
}

export type Graph = Map<NodeId, GraphEdge[]>;
export type NodeLookup = Map<NodeId, GraphNode>;

export interface RouteStop {
  id: string;
  location: string;
  coordinate: Coordinate;
}

export interface AStarResult {
  path: NodeId[];
  cost: number;
  visitedCount?: number;
}

export type OptimizationMethod = "astar-state" | "insertion-2opt-oropt";
export type OptimizationCostSource = "local-estimate" | "mapbox-traffic";

export interface OptimizedRouteResult {
  orderedStops: RouteStop[];
  /** Sum of estimated road leg distances along the final stop order (meters). */
  totalDistanceMeters: number;
  totalTravelSeconds: number;
  estimatedDurationMinutes: number;
  routeCenter: [number, number];
  /** True when edge costs came from Mapbox Matrix (driving-traffic durations). */
  usedMapboxTraffic?: boolean;
  optimizationMethod: OptimizationMethod;
  costSource: OptimizationCostSource;
}

