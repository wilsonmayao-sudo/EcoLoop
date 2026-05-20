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
}

export interface OptimizedRouteResult {
  orderedStops: RouteStop[];
  /** Sum of haversine leg distances along the final stop order (meters). */
  totalDistanceMeters: number;
  estimatedDurationMinutes: number;
  routeCenter: [number, number];
  /** True when edge costs came from Mapbox Matrix (driving-traffic durations). */
  usedMapboxTraffic?: boolean;
}

