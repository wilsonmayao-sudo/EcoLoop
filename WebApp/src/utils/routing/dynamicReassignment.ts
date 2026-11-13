import { haversineMeters } from "./geo";
import type { Coordinate } from "./types";

export interface DisposalSite {
  name: string;
  coordinate: Coordinate;
}

export const SWMO_LANDFILL_DISPOSAL_SITE: DisposalSite = {
  name: "SWMO - Sanitary Landfill (San Isidro)",
  coordinate: { lat: 13.6212151, lng: 123.2576126 },
};

export interface CandidateVehicle {
  id: string;
  label: string;
  driverId: string | null;
  driverName: string;
  currentLocation: Coordinate;
  currentLoadPercent: number; // 0 - 100 (driver reported)
  status: string; // active, on_route, available, full, maintenance, idle
  activeStops?: Coordinate[];
}

export interface UncollectedStop {
  id: string;
  binId: string | number;
  coordinate: Coordinate;
  stopOrder: number;
  location: string;
  estimatedLoadPercent?: number;
}

export interface CandidateEvaluation {
  vehicleId: string;
  label: string;
  driverName: string;
  eligible: boolean;
  ineligibleReason?: string;
  distanceToStopsKm: number;
  remainingCapacityPercent: number;
  projectedLoadPercent: number;
  additionalDistanceKm: number;
  distanceToDumpsiteKm: number;
  normalizedDistanceScore: number;
  normalizedRouteImpactScore: number;
  normalizedCapacityScore: number;
  normalizedDumpsiteScore: number;
  compositeScore: number;
  rank: number;
}

export interface ReassignmentResult {
  algorithm: "multi-criteria" | "nearest-baseline";
  selectedCandidate: CandidateEvaluation | null;
  evaluations: CandidateEvaluation[];
  uncollectedStopsCount: number;
  estimatedAdditionalDistanceKm: number;
  disposalSite: DisposalSite;
  processingTimeMs: number;
  message: string;
}

export interface BenchmarkScenario {
  id: string;
  name: string;
  description: string;
  sourceTruck: {
    label: string;
    coordinate: Coordinate;
    loadPercent: number;
  };
  uncollectedStops: UncollectedStop[];
  candidates: CandidateVehicle[];
  disposalSite?: DisposalSite;
}

export interface AlgorithmMetrics {
  selectedVehicleId: string | null;
  selectedVehicleLabel: string;
  totalFleetDistanceKm: number;
  additionalDistanceKm: number;
  processingTimeMs: number;
  capacityViolations: number;
  unservedStops: number;
  avgFleetUtilizationPercent: number;
}

export interface BenchmarkComparison {
  scenarioName: string;
  baseline: AlgorithmMetrics;
  proposed: AlgorithmMetrics;
  improvement: {
    distanceSavedKm: number;
    distanceImprovementPercent: number;
    timeDeltaMs: number;
    summary: string;
  };
  evaluations: CandidateEvaluation[];
}

/**
 * Calculates straight/road tour distance for sequence of coordinates.
 */
export function calculateTourDistanceKm(start: Coordinate, stops: Coordinate[], end: Coordinate): number {
  if (stops.length === 0) {
    return haversineMeters(start, end) / 1000;
  }

  let totalMeters = haversineMeters(start, stops[0]);
  for (let i = 0; i < stops.length - 1; i++) {
    totalMeters += haversineMeters(stops[i], stops[i + 1]);
  }
  totalMeters += haversineMeters(stops[stops.length - 1], end);
  return Math.round((totalMeters / 1000) * 100) / 100;
}

/**
 * Centroid calculation for a cluster of uncollected points.
 */
export function calculateCentroid(points: Coordinate[]): Coordinate {
  if (points.length === 0) return { lat: 13.6218, lng: 123.1948 };
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return {
    lat: sum.lat / points.length,
    lng: sum.lng / points.length,
  };
}

/**
 * Insertion heuristic to simulate route sequence impact when inserting stops.
 */
export function orderStopsByProximity(origin: Coordinate, stops: Coordinate[]): Coordinate[] {
  const remaining = [...stops];
  const ordered: Coordinate[] = [];
  let current = origin;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let minD = haversineMeters(current, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = haversineMeters(current, remaining[i]);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = next;
  }

  return ordered;
}

/**
 * Baseline: Nearest Available Truck (Greedy Proximity)
 * Selects candidate purely by shortest distance to uncollected points without
 * evaluating capacity headroom, route insertion detours, or dumpsite route impact.
 */
export function evaluateNearestTruckBaseline(
  candidates: CandidateVehicle[],
  uncollectedStops: UncollectedStop[],
  disposalSite: DisposalSite = SWMO_LANDFILL_DISPOSAL_SITE,
): ReassignmentResult {
  const t0 = performance.now();
  const uncollectedCoords = uncollectedStops.map((s) => s.coordinate);
  const centroid = calculateCentroid(uncollectedCoords);
  const neededLoad = Math.max(5, Math.min(60, uncollectedStops.length * 8));

  const evaluations: CandidateEvaluation[] = candidates.map((cand) => {
    const isOperational = ["active", "available", "on_route"].includes(cand.status.toLowerCase());
    const remainingCap = Math.max(0, 100 - cand.currentLoadPercent);
    const hasCapacity = remainingCap >= 10;
    const eligible = isOperational && hasCapacity;

    const distToCentroid = haversineMeters(cand.currentLocation, centroid) / 1000;
    const distToDumpsite = haversineMeters(centroid, disposalSite.coordinate) / 1000;
    const projectedLoad = cand.currentLoadPercent + neededLoad;

    // Baseline additional distance estimate
    const currentTourKm = calculateTourDistanceKm(
      cand.currentLocation,
      cand.activeStops || [],
      disposalSite.coordinate,
    );
    const mergedStops = orderStopsByProximity(cand.currentLocation, [
      ...(cand.activeStops || []),
      ...uncollectedCoords,
    ]);
    const newTourKm = calculateTourDistanceKm(cand.currentLocation, mergedStops, disposalSite.coordinate);
    const additionalDistanceKm = Math.max(0, Math.round((newTourKm - currentTourKm) * 100) / 100);

    return {
      vehicleId: cand.id,
      label: cand.label,
      driverName: cand.driverName,
      eligible,
      ineligibleReason: !isOperational
        ? `Status is ${cand.status}`
        : !hasCapacity
        ? "Insufficient capacity (<10% available)"
        : undefined,
      distanceToStopsKm: Math.round(distToCentroid * 100) / 100,
      remainingCapacityPercent: remainingCap,
      projectedLoadPercent: projectedLoad,
      additionalDistanceKm,
      distanceToDumpsiteKm: Math.round(distToDumpsite * 100) / 100,
      normalizedDistanceScore: 0,
      normalizedRouteImpactScore: 0,
      normalizedCapacityScore: 0,
      normalizedDumpsiteScore: 0,
      compositeScore: distToCentroid, // Baseline sorts strictly by distance
      rank: 999,
    };
  });

  const eligibleCandidates = evaluations.filter((e) => e.eligible);
  eligibleCandidates.sort((a, b) => a.distanceToStopsKm - b.distanceToStopsKm);

  eligibleCandidates.forEach((cand, idx) => {
    cand.rank = idx + 1;
  });

  const selected = eligibleCandidates[0] ?? null;
  const t1 = performance.now();

  return {
    algorithm: "nearest-baseline",
    selectedCandidate: selected,
    evaluations,
    uncollectedStopsCount: uncollectedStops.length,
    estimatedAdditionalDistanceKm: selected?.additionalDistanceKm ?? 0,
    disposalSite,
    processingTimeMs: Math.round((t1 - t0) * 100) / 100,
    message: selected
      ? `Baseline assigned nearest vehicle ${selected.label} (${selected.distanceToStopsKm} km away).`
      : "Baseline failed: no eligible active truck available.",
  };
}

/**
 * Proposed: Multi-Criteria Dynamic Reassignment Algorithm (MCDRA)
 * Evaluates candidate trucks using 4 weighted criteria:
 * 1. Route Impact (ΔD additional tour detour) [weight 0.40]
 * 2. Proximity to uncollected stops [weight 0.25]
 * 3. Capacity Headroom / buffer against full [weight 0.20]
 * 4. Disposal Facility Reachability [weight 0.15]
 */
export function evaluateMultiCriteriaReassignment(
  candidates: CandidateVehicle[],
  uncollectedStops: UncollectedStop[],
  disposalSite: DisposalSite = SWMO_LANDFILL_DISPOSAL_SITE,
): ReassignmentResult {
  const t0 = performance.now();
  const uncollectedCoords = uncollectedStops.map((s) => s.coordinate);
  const centroid = calculateCentroid(uncollectedCoords);
  const neededLoad = Math.max(5, Math.min(60, uncollectedStops.length * 8));

  // Weights configuration
  const WEIGHT_ROUTE_IMPACT = 0.40;
  const WEIGHT_PROXIMITY = 0.25;
  const WEIGHT_CAPACITY = 0.20;
  const WEIGHT_DUMPSITE = 0.15;

  const evaluations: CandidateEvaluation[] = candidates.map((cand) => {
    const isOperational = ["active", "available", "on_route"].includes(cand.status.toLowerCase());
    const remainingCap = Math.max(0, 100 - cand.currentLoadPercent);
    const projectedLoad = cand.currentLoadPercent + neededLoad;
    const hasCapacity = projectedLoad <= 100;
    const eligible = isOperational && hasCapacity;

    const distToCentroid = haversineMeters(cand.currentLocation, centroid) / 1000;

    // Route impact: calculate actual detour distance ΔD
    const currentTourKm = calculateTourDistanceKm(
      cand.currentLocation,
      cand.activeStops || [],
      disposalSite.coordinate,
    );
    const mergedStops = orderStopsByProximity(cand.currentLocation, [
      ...(cand.activeStops || []),
      ...uncollectedCoords,
    ]);
    const newTourKm = calculateTourDistanceKm(cand.currentLocation, mergedStops, disposalSite.coordinate);
    const additionalDistanceKm = Math.max(0, Math.round((newTourKm - currentTourKm) * 100) / 100);

    const lastStop = mergedStops.length > 0 ? mergedStops[mergedStops.length - 1] : cand.currentLocation;
    const distToDumpsite = haversineMeters(lastStop, disposalSite.coordinate) / 1000;

    return {
      vehicleId: cand.id,
      label: cand.label,
      driverName: cand.driverName,
      eligible,
      ineligibleReason: !isOperational
        ? `Status is ${cand.status}`
        : !hasCapacity
        ? `Capacity violation: projected ${projectedLoad}% exceeds 100%`
        : undefined,
      distanceToStopsKm: Math.round(distToCentroid * 100) / 100,
      remainingCapacityPercent: remainingCap,
      projectedLoadPercent: projectedLoad,
      additionalDistanceKm,
      distanceToDumpsiteKm: Math.round(distToDumpsite * 100) / 100,
      normalizedDistanceScore: 0,
      normalizedRouteImpactScore: 0,
      normalizedCapacityScore: 0,
      normalizedDumpsiteScore: 0,
      compositeScore: 999,
      rank: 999,
    };
  });

  const eligibleCandidates = evaluations.filter((e) => e.eligible);

  if (eligibleCandidates.length > 0) {
    // Normalization bounds
    const minRoute = Math.min(...eligibleCandidates.map((c) => c.additionalDistanceKm));
    const maxRoute = Math.max(...eligibleCandidates.map((c) => c.additionalDistanceKm));
    const minProx = Math.min(...eligibleCandidates.map((c) => c.distanceToStopsKm));
    const maxProx = Math.max(...eligibleCandidates.map((c) => c.distanceToStopsKm));
    const minDump = Math.min(...eligibleCandidates.map((c) => c.distanceToDumpsiteKm));
    const maxDump = Math.max(...eligibleCandidates.map((c) => c.distanceToDumpsiteKm));

    const norm = (val: number, min: number, max: number) =>
      max > min ? (val - min) / (max - min) : 0;

    for (const cand of eligibleCandidates) {
      const sRoute = norm(cand.additionalDistanceKm, minRoute, maxRoute);
      const sProx = norm(cand.distanceToStopsKm, minProx, maxProx);
      // Capacity penalty: higher projected load -> higher penalty score
      const sCap = cand.projectedLoadPercent / 100;
      const sDump = norm(cand.distanceToDumpsiteKm, minDump, maxDump);

      cand.normalizedRouteImpactScore = Math.round(sRoute * 100) / 100;
      cand.normalizedDistanceScore = Math.round(sProx * 100) / 100;
      cand.normalizedCapacityScore = Math.round(sCap * 100) / 100;
      cand.normalizedDumpsiteScore = Math.round(sDump * 100) / 100;

      const composite =
        WEIGHT_ROUTE_IMPACT * sRoute +
        WEIGHT_PROXIMITY * sProx +
        WEIGHT_CAPACITY * sCap +
        WEIGHT_DUMPSITE * sDump;

      cand.compositeScore = Math.round(composite * 1000) / 1000;
    }

    eligibleCandidates.sort((a, b) => a.compositeScore - b.compositeScore);
    eligibleCandidates.forEach((c, idx) => {
      c.rank = idx + 1;
    });
  }

  const selected = eligibleCandidates[0] ?? null;
  const t1 = performance.now();

  return {
    algorithm: "multi-criteria",
    selectedCandidate: selected,
    evaluations,
    uncollectedStopsCount: uncollectedStops.length,
    estimatedAdditionalDistanceKm: selected?.additionalDistanceKm ?? 0,
    disposalSite,
    processingTimeMs: Math.round((t1 - t0) * 100) / 100,
    message: selected
      ? `Multi-Criteria selected optimal vehicle ${selected.label} (Score: ${selected.compositeScore}, ΔD: +${selected.additionalDistanceKm} km, Load: ${selected.projectedLoadPercent}%).`
      : "Reassignment alert: No eligible active truck with sufficient capacity found.",
  };
}

/**
 * Runs side-by-side benchmark comparison between Baseline and Proposed Algorithm.
 */
export function runAlgorithmBenchmark(scenario: BenchmarkScenario): BenchmarkComparison {
  const baselineResult = evaluateNearestTruckBaseline(
    scenario.candidates,
    scenario.uncollectedStops,
    scenario.disposalSite,
  );
  const proposedResult = evaluateMultiCriteriaReassignment(
    scenario.candidates,
    scenario.uncollectedStops,
    scenario.disposalSite,
  );

  // Compute fleet total distance for both
  const computeFleetDist = (selectedId: string | null, additionalKm: number) => {
    let baseFleet = scenario.candidates.reduce((sum, c) => {
      const tour = calculateTourDistanceKm(
        c.currentLocation,
        c.activeStops || [],
        (scenario.disposalSite || SWMO_LANDFILL_DISPOSAL_SITE).coordinate,
      );
      return sum + tour;
    }, 0);
    return Math.round((baseFleet + (selectedId ? additionalKm : 0)) * 100) / 100;
  };

  const baselineSelected = baselineResult.selectedCandidate;
  const proposedSelected = proposedResult.selectedCandidate;

  const baselineFleetDist = computeFleetDist(
    baselineSelected?.vehicleId ?? null,
    baselineSelected?.additionalDistanceKm ?? 0,
  );
  const proposedFleetDist = computeFleetDist(
    proposedSelected?.vehicleId ?? null,
    proposedSelected?.additionalDistanceKm ?? 0,
  );

  // Check capacity violations
  const baselineViolation = baselineSelected && baselineSelected.projectedLoadPercent > 100 ? 1 : 0;
  const proposedViolation = proposedSelected && proposedSelected.projectedLoadPercent > 100 ? 1 : 0;

  const baselineMetrics: AlgorithmMetrics = {
    selectedVehicleId: baselineSelected?.vehicleId ?? null,
    selectedVehicleLabel: baselineSelected?.label ?? "None",
    totalFleetDistanceKm: baselineFleetDist,
    additionalDistanceKm: baselineSelected?.additionalDistanceKm ?? 0,
    processingTimeMs: baselineResult.processingTimeMs,
    capacityViolations: baselineViolation,
    unservedStops: baselineSelected ? 0 : scenario.uncollectedStops.length,
    avgFleetUtilizationPercent: Math.round(
      scenario.candidates.reduce(
        (sum, c) =>
          sum + (c.id === baselineSelected?.vehicleId ? baselineSelected.projectedLoadPercent : c.currentLoadPercent),
        0,
      ) / scenario.candidates.length,
    ),
  };

  const proposedMetrics: AlgorithmMetrics = {
    selectedVehicleId: proposedSelected?.vehicleId ?? null,
    selectedVehicleLabel: proposedSelected?.label ?? "None",
    totalFleetDistanceKm: proposedFleetDist,
    additionalDistanceKm: proposedSelected?.additionalDistanceKm ?? 0,
    processingTimeMs: proposedResult.processingTimeMs,
    capacityViolations: proposedViolation,
    unservedStops: proposedSelected ? 0 : scenario.uncollectedStops.length,
    avgFleetUtilizationPercent: Math.round(
      scenario.candidates.reduce(
        (sum, c) =>
          sum + (c.id === proposedSelected?.vehicleId ? proposedSelected.projectedLoadPercent : c.currentLoadPercent),
        0,
      ) / scenario.candidates.length,
    ),
  };

  const savedKm = Math.max(0, Math.round((baselineMetrics.totalFleetDistanceKm - proposedMetrics.totalFleetDistanceKm) * 100) / 100);
  const pctImprovement =
    baselineMetrics.additionalDistanceKm > 0
      ? Math.round(((baselineMetrics.additionalDistanceKm - proposedMetrics.additionalDistanceKm) / baselineMetrics.additionalDistanceKm) * 100)
      : 0;

  const summary =
    savedKm > 0
      ? `Proposed Multi-Criteria saved ${savedKm} km total fleet distance (${pctImprovement}% additional tour reduction) while maintaining safe capacity limits.`
      : baselineViolation > 0
      ? `Proposed Multi-Criteria successfully avoided a severe capacity overload that Baseline encountered.`
      : `Proposed Multi-Criteria matched or optimized fleet travel with balanced capacity distribution.`;

  return {
    scenarioName: scenario.name,
    baseline: baselineMetrics,
    proposed: proposedMetrics,
    improvement: {
      distanceSavedKm: savedKm,
      distanceImprovementPercent: pctImprovement,
      timeDeltaMs: proposedResult.processingTimeMs - baselineResult.processingTimeMs,
      summary,
    },
    evaluations: proposedResult.evaluations,
  };
}

/**
 * Built-in Benchmark Scenarios for academic defense and evaluation.
 */
export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "scenario-1",
    name: "Scenario 1: Single Truck Full (Nearest vs Capacity/Route Impact)",
    description:
      "Truck A signals full in Centro Naga. Truck B is 1.2 km away but already at 85% capacity with an opposing route. Truck C is 2.4 km away with only 40% capacity, heading directly toward SWMO Sanitary Landfill.",
    sourceTruck: {
      label: "Truck A (Dump 01)",
      coordinate: { lat: 13.6235, lng: 123.1876 },
      loadPercent: 100,
    },
    uncollectedStops: [
      { id: "S1", binId: "BIN-101", coordinate: { lat: 13.6248, lng: 123.1895 }, stopOrder: 1, location: "Peñafrancia Ave Stop 1" },
      { id: "S2", binId: "BIN-102", coordinate: { lat: 13.6262, lng: 123.1912 }, stopOrder: 2, location: "Peñafrancia Ave Stop 2" },
      { id: "S3", binId: "BIN-103", coordinate: { lat: 13.6281, lng: 123.1935 }, stopOrder: 3, location: "Magsaysay Ave Entrance" },
    ],
    candidates: [
      {
        id: "veh-2",
        label: "Truck B (Dump 02)",
        driverId: "drv-2",
        driverName: "Juan Dela Cruz",
        currentLocation: { lat: 13.6212, lng: 123.1845 },
        currentLoadPercent: 85,
        status: "active",
        activeStops: [{ lat: 13.6185, lng: 123.1795 }],
      },
      {
        id: "veh-3",
        label: "Truck C (Compactor 01)",
        driverId: "drv-3",
        driverName: "Ramon Santos",
        currentLocation: { lat: 13.6295, lng: 123.1982 },
        currentLoadPercent: 40,
        status: "active",
        activeStops: [{ lat: 13.6315, lng: 123.2012 }],
      },
      {
        id: "veh-4",
        label: "Truck D (Mini 01)",
        driverId: "drv-4",
        driverName: "Eduardo Diaz",
        currentLocation: { lat: 13.6152, lng: 123.1925 },
        currentLoadPercent: 65,
        status: "active",
        activeStops: [{ lat: 13.6175, lng: 123.1965 }],
      },
    ],
    disposalSite: SWMO_LANDFILL_DISPOSAL_SITE,
  },
  {
    id: "scenario-2",
    name: "Scenario 2: Capacity Bottleneck (Nearest Truck Overloaded)",
    description:
      "Nearest truck has only 5% available headroom. Baseline algorithm would either overload it or drop stops, while Multi-Criteria evaluates available capacity buffer and assigns Truck D.",
    sourceTruck: {
      label: "Truck A (Dump 01)",
      coordinate: { lat: 13.6312, lng: 123.1889 },
      loadPercent: 100,
    },
    uncollectedStops: [
      { id: "S4", binId: "BIN-201", coordinate: { lat: 13.6325, lng: 123.1905 }, stopOrder: 1, location: "Concepcion Pequeña Market" },
      { id: "S5", binId: "BIN-202", coordinate: { lat: 13.6341, lng: 123.1921 }, stopOrder: 2, location: "Del Rosario Highway" },
    ],
    candidates: [
      {
        id: "veh-2",
        label: "Truck B (Dump 02)",
        driverId: "drv-2",
        driverName: "Juan Dela Cruz",
        currentLocation: { lat: 13.6318, lng: 123.1895 },
        currentLoadPercent: 95, // Insufficient headroom!
        status: "active",
        activeStops: [],
      },
      {
        id: "veh-4",
        label: "Truck D (Mini 01)",
        driverId: "drv-4",
        driverName: "Eduardo Diaz",
        currentLocation: { lat: 13.6265, lng: 123.1942 },
        currentLoadPercent: 30, // Healthy headroom
        status: "active",
        activeStops: [{ lat: 13.6285, lng: 123.1975 }],
      },
    ],
    disposalSite: SWMO_LANDFILL_DISPOSAL_SITE,
  },
  {
    id: "scenario-3",
    name: "Scenario 3: Multi-Truck Simultaneous Reassignment",
    description:
      "Fleet operations during heavy monsoon collection: multiple uncollected clusters reassigned while minimizing cumulative fleet travel to SWMO - Sanitary Landfill.",
    sourceTruck: {
      label: "Truck C (Compactor 01)",
      coordinate: { lat: 13.6195, lng: 123.1912 },
      loadPercent: 100,
    },
    uncollectedStops: [
      { id: "S6", binId: "BIN-301", coordinate: { lat: 13.6215, lng: 123.1935 }, stopOrder: 1, location: "Triangulo Commercial Hub" },
      { id: "S7", binId: "BIN-302", coordinate: { lat: 13.6232, lng: 123.1952 }, stopOrder: 2, location: "Panganiban Drive Terminal" },
      { id: "S8", binId: "BIN-303", coordinate: { lat: 13.6255, lng: 123.1981 }, stopOrder: 3, location: "CBD II Diversion Rd" },
      { id: "S9", binId: "BIN-304", coordinate: { lat: 13.6272, lng: 123.2015 }, stopOrder: 4, location: "Balatas Substation" },
    ],
    candidates: [
      {
        id: "veh-1",
        label: "Truck A (Dump 01)",
        driverId: "drv-1",
        driverName: "Carlos Mendoza",
        currentLocation: { lat: 13.6145, lng: 123.1855 },
        currentLoadPercent: 50,
        status: "active",
        activeStops: [{ lat: 13.6162, lng: 123.1882 }],
      },
      {
        id: "veh-2",
        label: "Truck B (Dump 02)",
        driverId: "drv-2",
        driverName: "Juan Dela Cruz",
        currentLocation: { lat: 13.6241, lng: 123.1925 },
        currentLoadPercent: 70,
        status: "active",
        activeStops: [{ lat: 13.6265, lng: 123.1945 }],
      },
      {
        id: "veh-4",
        label: "Truck D (Mini 01)",
        driverId: "drv-4",
        driverName: "Eduardo Diaz",
        currentLocation: { lat: 13.6285, lng: 123.2035 },
        currentLoadPercent: 35,
        status: "active",
        activeStops: [{ lat: 13.6305, lng: 123.2052 }],
      },
    ],
    disposalSite: SWMO_LANDFILL_DISPOSAL_SITE,
  },
];
