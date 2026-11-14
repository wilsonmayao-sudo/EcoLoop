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

export type LoadSource = "driver_reported" | "route_progress_estimated" | "unverified";

export interface CandidateVehicle {
  id: string;
  label: string;
  driverId: string | null;
  driverName: string;
  driverStatus?: string | null;
  isActive?: boolean;
  currentLocation: Coordinate | null;
  currentLoadPercent: number | null; // 0 - 100
  loadSource?: LoadSource;
  status: string; // active, on_route, available, idle, full, maintenance, offline, inactive, unloading
  activeStops?: Coordinate[];
  capacityLiters?: number | null;
  capacityKg?: number | null;
  gpsTimestamp?: string | null;
  gpsAgeSeconds?: number | null;
  isGpsFresh?: boolean;
  maxOfflineSeconds?: number;
  hasActiveOverflowAssignment?: boolean;
}

export type CandidateVehicleInput = CandidateVehicle;

export interface UncollectedStop {
  id: string;
  binId: string | number;
  coordinate: Coordinate;
  stopOrder: number;
  location: string;
  capacityPercent?: number | null;
  estimatedVolumeLiters?: number | null;
  estimatedWeightKg?: number | null;
  estimatedLoadPercent?: number;
}

export type OverflowStopInput = UncollectedStop;

export interface StopDemandEstimate {
  volumeLiters: number;
  weightKg: number;
  percentOfTruck: number;
  limitingFactor: "volume" | "weight" | "percent";
}

export interface TruckStopAssignment {
  vehicleId: string;
  label: string;
  driverId: string | null;
  driverName: string;
  assignedStops: UncollectedStop[];
  assignedBinIds: Array<string | number>;
  stopsCount: number;
  distanceToStopsKm: number;
  additionalDistanceKm: number;
  distanceToDumpsiteKm: number;
  startingLoadPercent: number;
  addedLoadPercent: number;
  projectedLoadPercent: number;
  remainingCapacityPercent: number;
  addedVolumeLiters: number;
  addedWeightKg: number;
  limitingFactor: "volume" | "weight" | "percent";
  compositeScore: number;
  waypoints: Coordinate[];
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
  limitingFactor?: "volume" | "weight" | "percent";
  loadSource?: LoadSource;
}

export interface ReassignmentResult {
  algorithm: "multi-criteria" | "nearest-baseline";
  selectedCandidate: CandidateEvaluation | null;
  assignments: TruckStopAssignment[];
  isMultiTruck: boolean;
  unassignedStops: UncollectedStop[];
  evaluations: CandidateEvaluation[];
  uncollectedStopsCount: number;
  estimatedAdditionalDistanceKm: number;
  totalAdditionalDistanceKm: number;
  capacityValidated: boolean;
  capacityValidationNote: string | null;
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
  selectedVehiclesCount: number;
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

const DEFAULT_STOP_VOLUME_LITERS = 240;
const DEFAULT_STOP_WEIGHT_KG = 120;
const DEFAULT_STOP_LOAD_PERCENT = 8;
const DEFAULT_OFFLINE_THRESHOLD_SECONDS = 90;

const OPERATIONAL_VEHICLE_STATUSES = new Set(["active", "available", "on_route", "idle"]);
const EXCLUDED_VEHICLE_STATUSES = new Set([
  "full",
  "maintenance",
  "inactive",
  "offline",
  "unloading",
  "assisting_overflow",
  "out_of_service",
  "suspended",
]);
const EXCLUDED_DRIVER_STATUSES = new Set(["offline", "inactive", "suspended", "full", "on_break"]);

function normalizeStatusToken(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function isValidCoordinate(coord?: Coordinate | null): coord is Coordinate {
  if (!coord) return false;
  const lat = Number(coord.lat);
  const lng = Number(coord.lng);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6)
  );
}

/**
 * Estimates volume (L), weight (kg), and percentage load of one stop relative to a truck's specifications.
 * Never conflates volume (`capacity_liters`) with payload weight (`capacity_kg`): takes the binding limit.
 */
export function estimateStopDemand(
  stop: UncollectedStop,
  candidate?: Pick<CandidateVehicle, "capacityLiters" | "capacityKg">,
): StopDemandEstimate {
  const fillFraction =
    stop.capacityPercent != null && Number.isFinite(Number(stop.capacityPercent))
      ? Math.max(0.15, Math.min(1, Number(stop.capacityPercent) / 100))
      : 1;

  const volumeLiters =
    stop.estimatedVolumeLiters != null && Number(stop.estimatedVolumeLiters) > 0
      ? Number(stop.estimatedVolumeLiters)
      : Math.round(DEFAULT_STOP_VOLUME_LITERS * fillFraction);

  const weightKg =
    stop.estimatedWeightKg != null && Number(stop.estimatedWeightKg) > 0
      ? Number(stop.estimatedWeightKg)
      : Math.round(DEFAULT_STOP_WEIGHT_KG * fillFraction);

  if (stop.estimatedLoadPercent != null && Number(stop.estimatedLoadPercent) > 0) {
    return {
      volumeLiters,
      weightKg,
      percentOfTruck: Number(stop.estimatedLoadPercent),
      limitingFactor: "percent",
    };
  }

  const capLiters =
    candidate?.capacityLiters != null && Number(candidate.capacityLiters) > 0
      ? Number(candidate.capacityLiters)
      : null;
  const capKg =
    candidate?.capacityKg != null && Number(candidate.capacityKg) > 0
      ? Number(candidate.capacityKg)
      : null;

  const volPct = capLiters != null ? (volumeLiters / capLiters) * 100 : null;
  const weightPct = capKg != null ? (weightKg / capKg) * 100 : null;

  if (volPct != null || weightPct != null) {
    if ((weightPct ?? 0) >= (volPct ?? 0) && weightPct != null) {
      return {
        volumeLiters,
        weightKg,
        percentOfTruck: Math.max(1, Math.round(weightPct * 10) / 10),
        limitingFactor: "weight",
      };
    }
    return {
      volumeLiters,
      weightKg,
      percentOfTruck: Math.max(1, Math.round((volPct ?? DEFAULT_STOP_LOAD_PERCENT) * 10) / 10),
      limitingFactor: "volume",
    };
  }

  const pctFallback =
    stop.capacityPercent != null && Number.isFinite(Number(stop.capacityPercent))
      ? Math.max(2, Math.round(DEFAULT_STOP_LOAD_PERCENT * fillFraction * 10) / 10)
      : DEFAULT_STOP_LOAD_PERCENT;

  return {
    volumeLiters,
    weightKg,
    percentOfTruck: pctFallback,
    limitingFactor: "percent",
  };
}

function estimateTotalDemand(
  stops: UncollectedStop[],
  candidate?: Pick<CandidateVehicle, "capacityLiters" | "capacityKg">,
): {
  totalPercent: number;
  totalVolumeLiters: number;
  totalWeightKg: number;
  limitingFactor: "volume" | "weight" | "percent";
} {
  let totalPercent = 0;
  let totalVolumeLiters = 0;
  let totalWeightKg = 0;
  let volumeVotes = 0;
  let weightVotes = 0;

  for (const stop of stops) {
    const est = estimateStopDemand(stop, candidate);
    totalPercent += est.percentOfTruck;
    totalVolumeLiters += est.volumeLiters;
    totalWeightKg += est.weightKg;
    if (est.limitingFactor === "volume") volumeVotes++;
    if (est.limitingFactor === "weight") weightVotes++;
  }

  const limitingFactor: "volume" | "weight" | "percent" =
    weightVotes > volumeVotes ? "weight" : volumeVotes > 0 ? "volume" : "percent";

  return {
    totalPercent: Math.round(totalPercent * 10) / 10,
    totalVolumeLiters: Math.round(totalVolumeLiters),
    totalWeightKg: Math.round(totalWeightKg),
    limitingFactor,
  };
}

/**
 * Validates operational, driver, GPS freshness, overflow-lock, and capacity eligibility.
 */
export function evaluateCandidateEligibility(
  cand: CandidateVehicle,
): { eligible: boolean; reason?: string } {
  if (cand.isActive === false) {
    return { eligible: false, reason: "Vehicle is inactive" };
  }

  const vStatus = normalizeStatusToken(cand.status);
  if (EXCLUDED_VEHICLE_STATUSES.has(vStatus) || !OPERATIONAL_VEHICLE_STATUSES.has(vStatus)) {
    return { eligible: false, reason: `Status is ${cand.status || "unavailable"}` };
  }

  if (cand.hasActiveOverflowAssignment) {
    return { eligible: false, reason: "Already assisting another active overflow event" };
  }

  if (cand.driverId == null || String(cand.driverId).trim() === "") {
    return { eligible: false, reason: "No assigned active driver" };
  }

  if (cand.driverStatus && EXCLUDED_DRIVER_STATUSES.has(normalizeStatusToken(cand.driverStatus))) {
    return { eligible: false, reason: `Assigned driver is ${cand.driverStatus}` };
  }

  if (!isValidCoordinate(cand.currentLocation)) {
    return { eligible: false, reason: "Missing or invalid live GPS coordinates" };
  }

  const maxOfflineSeconds = cand.maxOfflineSeconds ?? DEFAULT_OFFLINE_THRESHOLD_SECONDS;
  if (cand.isGpsFresh === false) {
    return { eligible: false, reason: "Offline or stale GPS signal" };
  }
  if (typeof cand.gpsAgeSeconds === "number" && Number.isFinite(cand.gpsAgeSeconds)) {
    if (cand.gpsAgeSeconds > maxOfflineSeconds) {
      return {
        eligible: false,
        reason: `Stale GPS (${Math.round(cand.gpsAgeSeconds)}s > ${maxOfflineSeconds}s threshold)`,
      };
    }
  } else if (cand.gpsTimestamp) {
    const parsedMs = new Date(cand.gpsTimestamp).getTime();
    if (!Number.isFinite(parsedMs) || (Date.now() - parsedMs) / 1000 > maxOfflineSeconds) {
      return { eligible: false, reason: "Stale or unparseable GPS timestamp" };
    }
  }

  if (cand.currentLoadPercent == null || !Number.isFinite(cand.currentLoadPercent) || cand.loadSource === "unverified") {
    return { eligible: false, reason: "Current truck load unavailable (capacity unverified)" };
  }

  if (cand.currentLoadPercent >= 95) {
    return { eligible: false, reason: `Insufficient remaining capacity (${cand.currentLoadPercent}% full)` };
  }

  return { eligible: true };
}

/**
 * Calculates open-path tour distance from truck start -> ordered stops -> disposal site.
 */
export function calculateTourDistanceKm(start: Coordinate, stops: Coordinate[], end: Coordinate): number {
  if (stops.length === 0) {
    return Math.round((haversineMeters(start, end) / 1000) * 100) / 100;
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
 * Nearest-neighbor insertion heuristic to simulate route sequence impact.
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
 * Nearest-neighbor + bounded 2-opt tour refinement from `origin` through `stops` ending at `terminal`.
 */
export function orderCoordinatesWith2Opt(
  origin: Coordinate,
  stops: Coordinate[],
  terminal: Coordinate,
): Coordinate[] {
  const validStops = stops.filter((s) => isValidCoordinate(s));
  if (validStops.length <= 2) {
    return orderStopsByProximity(origin, validStops);
  }

  const route = orderStopsByProximity(origin, validStops);
  let improved = true;
  let passes = 0;

  while (improved && passes < 12) {
    improved = false;
    passes++;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const beforeA = i === 0 ? origin : route[i - 1];
        const afterB = j === route.length - 1 ? terminal : route[j + 1];
        const currentCost =
          haversineMeters(beforeA, route[i]) + haversineMeters(route[j], afterB);
        const swappedCost =
          haversineMeters(beforeA, route[j]) + haversineMeters(route[i], afterB);

        if (swappedCost + 1e-3 < currentCost) {
          const reversed = route.slice(i, j + 1).reverse();
          route.splice(i, j - i + 1, ...reversed);
          improved = true;
        }
      }
    }
  }

  return route;
}

function sequenceOverflowStops(
  origin: Coordinate,
  stops: UncollectedStop[],
  terminal: Coordinate,
): UncollectedStop[] {
  if (stops.length <= 1) return [...stops];
  const remaining = [...stops];
  const ordered: UncollectedStop[] = [];
  let current = origin;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const distFromCurrent = haversineMeters(current, remaining[i].coordinate);
      // Slight preference toward stops moving progressively closer to the landfill when equal distance
      const distToEnd = haversineMeters(remaining[i].coordinate, terminal);
      const score = distFromCurrent + distToEnd * 0.08;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    ordered.push(picked);
    current = picked.coordinate;
  }

  return ordered;
}

function summarizeCapacityValidation(candidates: CandidateVehicle[]): {
  capacityValidated: boolean;
  capacityValidationNote: string | null;
} {
  const validCandidates = candidates.filter((c) => c.currentLoadPercent != null);
  const allDriverReported =
    validCandidates.length > 0 &&
    validCandidates.every((c) => !c.loadSource || c.loadSource === "driver_reported");
  const hasEstimated = validCandidates.some((c) => c.loadSource === "route_progress_estimated");
  const hasUnverified = candidates.some((c) => c.currentLoadPercent == null || c.loadSource === "unverified");
  const missingSpecs = candidates.filter((c) => !(c.capacityLiters && c.capacityLiters > 0) && !(c.capacityKg && c.capacityKg > 0));

  if (allDriverReported && !hasUnverified && missingSpecs.length === 0) {
    return { capacityValidated: true, capacityValidationNote: null };
  }

  const notes: string[] = [];
  if (hasUnverified) {
    notes.push("trucks without verifiable load data were excluded");
  }
  if (hasEstimated) {
    notes.push("truck load estimated from active route completion where driver-reported load_percent was unavailable");
  }
  if (missingSpecs.length > 0) {
    notes.push("percentage stop load used where capacity_liters/capacity_kg were not set");
  }

  return {
    capacityValidated: !hasEstimated && !hasUnverified && missingSpecs.length === 0,
    capacityValidationNote: notes.length > 0 ? notes.join("; ") : null,
  };
}

function computeAdditionalDistanceForSubset(
  cand: CandidateVehicle,
  subset: UncollectedStop[],
  disposalCoord: Coordinate,
): {
  additionalDistanceKm: number;
  distanceToStopsKm: number;
  distanceToDumpsiteKm: number;
  waypoints: Coordinate[];
} {
  const origin = cand.currentLocation!;
  const subsetCoords = subset.map((s) => s.coordinate);
  const centroid = calculateCentroid(subsetCoords);
  const distanceToStopsKm = Math.round((haversineMeters(origin, centroid) / 1000) * 100) / 100;

  const currentTourKm = calculateTourDistanceKm(origin, cand.activeStops || [], disposalCoord);
  const mergedStops =
    subsetCoords.length <= 3
      ? orderStopsByProximity(origin, [...(cand.activeStops || []), ...subsetCoords])
      : orderCoordinatesWith2Opt(origin, [...(cand.activeStops || []), ...subsetCoords], disposalCoord);
  const newTourKm = calculateTourDistanceKm(origin, mergedStops, disposalCoord);
  const additionalDistanceKm = Math.max(0, Math.round((newTourKm - currentTourKm) * 100) / 100);
  const lastStop = mergedStops.length > 0 ? mergedStops[mergedStops.length - 1] : origin;
  const distanceToDumpsiteKm = Math.round((haversineMeters(lastStop, disposalCoord) / 1000) * 100) / 100;

  return {
    additionalDistanceKm,
    distanceToStopsKm,
    distanceToDumpsiteKm,
    waypoints: [origin, ...mergedStops, disposalCoord],
  };
}

/**
 * Multi-Truck Capacitated Stop Distribution
 * Distributes uncollected overflow stops across 1 or more eligible trucks so no truck exceeds remaining capacity
 * and total additional fleet detour + overload risk is minimized.
 */
function distributeStopsAcrossTrucks(
  eligibleInputs: Array<{ candidate: CandidateVehicle; evaluation: CandidateEvaluation }>,
  uncollectedStops: UncollectedStop[],
  disposalCoord: Coordinate,
): {
  assignments: TruckStopAssignment[];
  unassignedStops: UncollectedStop[];
} {
  if (eligibleInputs.length === 0 || uncollectedStops.length === 0) {
    return { assignments: [], unassignedStops: [...uncollectedStops] };
  }

  interface BucketState {
    candidate: CandidateVehicle;
    evaluation: CandidateEvaluation;
    assigned: UncollectedStop[];
    currentLoad: number;
    addedLoad: number;
    addedVolumeLiters: number;
    addedWeightKg: number;
  }

  const buckets: BucketState[] = eligibleInputs.map(({ candidate, evaluation }) => ({
    candidate,
    evaluation,
    assigned: [],
    currentLoad: candidate.currentLoadPercent ?? 100,
    addedLoad: 0,
    addedVolumeLiters: 0,
    addedWeightKg: 0,
  }));

  // Order stops from farthest-from-landfill / highest-order first so clusters pack cleanly toward landfill
  const remainingStops = [...uncollectedStops].sort((a, b) => a.stopOrder - b.stopOrder);
  const unassignedStops: UncollectedStop[] = [];

  for (const stop of remainingStops) {
    let bestBucketIdx = -1;
    let bestInsertionCost = Infinity;

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const stopEst = estimateStopDemand(stop, b.candidate);
      const nextProjected = b.currentLoad + b.addedLoad + stopEst.percentOfTruck;
      if (nextProjected > 100) continue;

      // Marginal additional distance caused by adding `stop` to bucket `b`
      const beforeKm =
        b.assigned.length === 0
          ? calculateTourDistanceKm(b.candidate.currentLocation!, b.candidate.activeStops || [], disposalCoord)
          : computeAdditionalDistanceForSubset(b.candidate, b.assigned, disposalCoord).additionalDistanceKm +
            calculateTourDistanceKm(b.candidate.currentLocation!, b.candidate.activeStops || [], disposalCoord);

      const nextSubset = [...b.assigned, stop];
      const afterStats = computeAdditionalDistanceForSubset(b.candidate, nextSubset, disposalCoord);
      const afterKm =
        calculateTourDistanceKm(b.candidate.currentLocation!, b.candidate.activeStops || [], disposalCoord) +
        afterStats.additionalDistanceKm;

      const marginalDeltaKm = Math.max(0, afterKm - beforeKm);
      const proximityKm = haversineMeters(b.candidate.currentLocation!, stop.coordinate) / 1000;
      const loadPenalty = (nextProjected / 100) * 1.4;
      const reuseBonus = b.assigned.length > 0 ? 0 : 0.65; // Small fixed coordination cost when activating a 2nd/3rd truck
      const totalCost = marginalDeltaKm * 1.0 + proximityKm * 0.35 + loadPenalty + reuseBonus;

      if (totalCost < bestInsertionCost) {
        bestInsertionCost = totalCost;
        bestBucketIdx = i;
      }
    }

    if (bestBucketIdx === -1) {
      unassignedStops.push(stop);
      continue;
    }

    const chosen = buckets[bestBucketIdx];
    const stopEst = estimateStopDemand(stop, chosen.candidate);
    chosen.assigned.push(stop);
    chosen.addedLoad = Math.round((chosen.addedLoad + stopEst.percentOfTruck) * 10) / 10;
    chosen.addedVolumeLiters += stopEst.volumeLiters;
    chosen.addedWeightKg += stopEst.weightKg;
  }

  const activeBuckets = buckets.filter((b) => b.assigned.length > 0);
  const assignments: TruckStopAssignment[] = activeBuckets.map((b) => {
    const orderedStops = sequenceOverflowStops(b.candidate.currentLocation!, b.assigned, disposalCoord);
    const routeStats = computeAdditionalDistanceForSubset(b.candidate, orderedStops, disposalCoord);
    const demand = estimateTotalDemand(orderedStops, b.candidate);
    const projectedLoad = Math.round((b.currentLoad + demand.totalPercent) * 10) / 10;

    return {
      vehicleId: b.candidate.id,
      label: b.candidate.label,
      driverId: b.candidate.driverId,
      driverName: b.candidate.driverName,
      assignedStops: orderedStops,
      assignedBinIds: orderedStops.map((s) => s.binId),
      stopsCount: orderedStops.length,
      distanceToStopsKm: routeStats.distanceToStopsKm,
      additionalDistanceKm: routeStats.additionalDistanceKm,
      distanceToDumpsiteKm: routeStats.distanceToDumpsiteKm,
      startingLoadPercent: b.currentLoad,
      addedLoadPercent: demand.totalPercent,
      projectedLoadPercent: projectedLoad,
      remainingCapacityPercent: Math.max(0, Math.round((100 - b.currentLoad) * 10) / 10),
      addedVolumeLiters: b.addedVolumeLiters,
      addedWeightKg: b.addedWeightKg,
      limitingFactor: demand.limitingFactor,
      compositeScore: b.evaluation.compositeScore,
      waypoints: routeStats.waypoints,
    };
  });

  assignments.sort((a, b) => a.compositeScore - b.compositeScore || b.stopsCount - a.stopsCount);

  return { assignments, unassignedStops };
}

/**
 * Baseline: Nearest Available Truck (Greedy Proximity)
 * Selects candidate purely by shortest distance to uncollected points without
 * evaluating full route insertion detours, multi-truck distribution, or dumpsite route impact.
 */
export function evaluateNearestTruckBaseline(
  candidates: CandidateVehicle[],
  uncollectedStops: UncollectedStop[],
  disposalSite: DisposalSite = SWMO_LANDFILL_DISPOSAL_SITE,
): ReassignmentResult {
  const t0 = performance.now();
  const uncollectedCoords = uncollectedStops.map((s) => s.coordinate);
  const centroid = calculateCentroid(uncollectedCoords);
  const capacitySummary = summarizeCapacityValidation(candidates);

  const evaluations: CandidateEvaluation[] = candidates.map((cand) => {
    const vStatus = normalizeStatusToken(cand.status);
    const isOperational = OPERATIONAL_VEHICLE_STATUSES.has(vStatus) && cand.isActive !== false;
    const hasCoords = isValidCoordinate(cand.currentLocation);
    const currentLoad = cand.currentLoadPercent ?? 0;
    const remainingCap = Math.max(0, 100 - currentLoad);
    const hasCapacity = remainingCap >= 10;
    const eligible = isOperational && hasCoords && hasCapacity && Boolean(cand.driverId);

    const demand = estimateTotalDemand(uncollectedStops, cand);
    const projectedLoad = Math.round((currentLoad + demand.totalPercent) * 10) / 10;

    if (!hasCoords) {
      return {
        vehicleId: cand.id,
        label: cand.label,
        driverName: cand.driverName,
        eligible: false,
        ineligibleReason: "Missing live GPS coordinates",
        distanceToStopsKm: 999,
        remainingCapacityPercent: remainingCap,
        projectedLoadPercent: projectedLoad,
        additionalDistanceKm: 0,
        distanceToDumpsiteKm: 0,
        normalizedDistanceScore: 0,
        normalizedRouteImpactScore: 0,
        normalizedCapacityScore: 0,
        normalizedDumpsiteScore: 0,
        compositeScore: 999,
        rank: 999,
        limitingFactor: demand.limitingFactor,
        loadSource: cand.loadSource,
      };
    }

    const origin = cand.currentLocation!;
    const distToCentroid = haversineMeters(origin, centroid) / 1000;
    const routeStats = computeAdditionalDistanceForSubset(cand, uncollectedStops, disposalSite.coordinate);

    return {
      vehicleId: cand.id,
      label: cand.label,
      driverName: cand.driverName,
      eligible,
      ineligibleReason: !isOperational
        ? `Status is ${cand.status}`
        : !cand.driverId
          ? "No assigned driver"
          : !hasCapacity
            ? "Insufficient capacity (<10% available)"
            : undefined,
      distanceToStopsKm: Math.round(distToCentroid * 100) / 100,
      remainingCapacityPercent: remainingCap,
      projectedLoadPercent: projectedLoad,
      additionalDistanceKm: routeStats.additionalDistanceKm,
      distanceToDumpsiteKm: routeStats.distanceToDumpsiteKm,
      normalizedDistanceScore: 0,
      normalizedRouteImpactScore: 0,
      normalizedCapacityScore: 0,
      normalizedDumpsiteScore: 0,
      compositeScore: Math.round(distToCentroid * 100) / 100,
      rank: 999,
      limitingFactor: demand.limitingFactor,
      loadSource: cand.loadSource,
    };
  });

  const eligibleCandidates = evaluations.filter((e) => e.eligible);
  eligibleCandidates.sort((a, b) => a.distanceToStopsKm - b.distanceToStopsKm);
  eligibleCandidates.forEach((cand, idx) => {
    cand.rank = idx + 1;
  });

  const selected = eligibleCandidates[0] ?? null;
  const selectedVehicle = selected ? candidates.find((c) => c.id === selected.vehicleId) ?? null : null;
  const assignments: TruckStopAssignment[] =
    selected && selectedVehicle && uncollectedStops.length > 0
      ? [
          {
            vehicleId: selected.vehicleId,
            label: selected.label,
            driverId: selectedVehicle.driverId,
            driverName: selected.driverName,
            assignedStops: uncollectedStops,
            assignedBinIds: uncollectedStops.map((s) => s.binId),
            stopsCount: uncollectedStops.length,
            distanceToStopsKm: selected.distanceToStopsKm,
            additionalDistanceKm: selected.additionalDistanceKm,
            distanceToDumpsiteKm: selected.distanceToDumpsiteKm,
            startingLoadPercent: selectedVehicle.currentLoadPercent ?? 0,
            addedLoadPercent: Math.round((selected.projectedLoadPercent - (selectedVehicle.currentLoadPercent ?? 0)) * 10) / 10,
            projectedLoadPercent: selected.projectedLoadPercent,
            remainingCapacityPercent: selected.remainingCapacityPercent,
            addedVolumeLiters: estimateTotalDemand(uncollectedStops, selectedVehicle).totalVolumeLiters,
            addedWeightKg: estimateTotalDemand(uncollectedStops, selectedVehicle).totalWeightKg,
            limitingFactor: selected.limitingFactor ?? "percent",
            compositeScore: selected.compositeScore,
            waypoints: computeAdditionalDistanceForSubset(selectedVehicle, uncollectedStops, disposalSite.coordinate).waypoints,
          },
        ]
      : [];

  const t1 = performance.now();

  return {
    algorithm: "nearest-baseline",
    selectedCandidate: selected,
    assignments,
    isMultiTruck: false,
    unassignedStops: selected ? [] : [...uncollectedStops],
    evaluations,
    uncollectedStopsCount: uncollectedStops.length,
    estimatedAdditionalDistanceKm: selected?.additionalDistanceKm ?? 0,
    totalAdditionalDistanceKm: selected?.additionalDistanceKm ?? 0,
    capacityValidated: capacitySummary.capacityValidated,
    capacityValidationNote: capacitySummary.capacityValidationNote,
    disposalSite,
    processingTimeMs: Math.round((t1 - t0) * 100) / 100,
    message: selected
      ? `Baseline assigned nearest vehicle ${selected.label} (${selected.distanceToStopsKm} km away).`
      : "Baseline failed: no eligible active truck available.",
  };
}

/**
 * Proposed: Multi-Criteria Dynamic Reassignment Engine (MCDRA + Multi-Truck Split)
 * Evaluates candidate eligibility, capacity headroom (volume & weight separated), approach proximity,
 * insertion route detour ΔD, and SWMO Landfill distance. Automatically distributes overflow stops across
 * multiple eligible trucks whenever single-truck assignment is infeasible or yields a worse detour/load balance.
 */
export function evaluateMultiCriteriaReassignment(
  candidates: CandidateVehicle[],
  uncollectedStops: UncollectedStop[],
  disposalSite: DisposalSite = SWMO_LANDFILL_DISPOSAL_SITE,
): ReassignmentResult {
  const t0 = performance.now();
  const WEIGHT_ROUTE_IMPACT = 0.40;
  const WEIGHT_PROXIMITY = 0.25;
  const WEIGHT_CAPACITY = 0.20;
  const WEIGHT_DUMPSITE = 0.15;

  const capacitySummary = summarizeCapacityValidation(candidates);
  const disposalCoord = isValidCoordinate(disposalSite.coordinate)
    ? disposalSite.coordinate
    : SWMO_LANDFILL_DISPOSAL_SITE.coordinate;

  const singleTruckCandidates: Array<{ candidate: CandidateVehicle; evaluation: CandidateEvaluation }> = [];
  const splitCapableCandidates: Array<{ candidate: CandidateVehicle; evaluation: CandidateEvaluation }> = [];

  const evaluations: CandidateEvaluation[] = candidates.map((cand) => {
    const elig = evaluateCandidateEligibility(cand);
    const currentLoad = cand.currentLoadPercent ?? 100;
    const remainingCap = Math.max(0, Math.round((100 - currentLoad) * 10) / 10);
    const demand = estimateTotalDemand(uncollectedStops, cand);
    const projectedLoad = Math.round((currentLoad + demand.totalPercent) * 10) / 10;

    if (!elig.eligible) {
      return {
        vehicleId: cand.id,
        label: cand.label,
        driverName: cand.driverName,
        eligible: false,
        ineligibleReason: elig.reason,
        distanceToStopsKm: 999,
        remainingCapacityPercent: remainingCap,
        projectedLoadPercent: projectedLoad,
        additionalDistanceKm: 0,
        distanceToDumpsiteKm: 0,
        normalizedDistanceScore: 0,
        normalizedRouteImpactScore: 0,
        normalizedCapacityScore: 0,
        normalizedDumpsiteScore: 0,
        compositeScore: 999,
        rank: 999,
        limitingFactor: demand.limitingFactor,
        loadSource: cand.loadSource,
      };
    }

    const routeStats = computeAdditionalDistanceForSubset(cand, uncollectedStops, disposalCoord);
    const minStopDemand = uncollectedStops.reduce(
      (min, s) => Math.min(min, estimateStopDemand(s, cand).percentOfTruck),
      Infinity,
    );
    const canFitAtLeastOneStop =
      uncollectedStops.length === 0 || currentLoad + (Number.isFinite(minStopDemand) ? minStopDemand : 0) <= 100;
    const canFitAllStops = projectedLoad <= 100;

    const evalItem: CandidateEvaluation = {
      vehicleId: cand.id,
      label: cand.label,
      driverName: cand.driverName,
      eligible: canFitAllStops,
      ineligibleReason: !canFitAtLeastOneStop
        ? `Insufficient remaining capacity (${currentLoad}% full)`
        : !canFitAllStops
          ? `Cannot fit all ${uncollectedStops.length} stops alone (projected ${projectedLoad}% > 100%; eligible for partial split)`
          : undefined,
      distanceToStopsKm: routeStats.distanceToStopsKm,
      remainingCapacityPercent: remainingCap,
      projectedLoadPercent: projectedLoad,
      additionalDistanceKm: routeStats.additionalDistanceKm,
      distanceToDumpsiteKm: routeStats.distanceToDumpsiteKm,
      normalizedDistanceScore: 0,
      normalizedRouteImpactScore: 0,
      normalizedCapacityScore: 0,
      normalizedDumpsiteScore: 0,
      compositeScore: 999,
      rank: 999,
      limitingFactor: demand.limitingFactor,
      loadSource: cand.loadSource,
    };

    if (canFitAllStops) {
      singleTruckCandidates.push({ candidate: cand, evaluation: evalItem });
    }
    if (canFitAtLeastOneStop) {
      splitCapableCandidates.push({ candidate: cand, evaluation: evalItem });
    }

    return evalItem;
  });

  // Score all trucks that can take at least 1 stop (for single-truck selection and split priority)
  if (splitCapableCandidates.length > 0) {
    const scorePool = singleTruckCandidates.length > 0 ? singleTruckCandidates : splitCapableCandidates;
    const minRoute = Math.min(...scorePool.map((c) => c.evaluation.additionalDistanceKm));
    const maxRoute = Math.max(...scorePool.map((c) => c.evaluation.additionalDistanceKm));
    const minProx = Math.min(...scorePool.map((c) => c.evaluation.distanceToStopsKm));
    const maxProx = Math.max(...scorePool.map((c) => c.evaluation.distanceToStopsKm));
    const minDump = Math.min(...scorePool.map((c) => c.evaluation.distanceToDumpsiteKm));
    const maxDump = Math.max(...scorePool.map((c) => c.evaluation.distanceToDumpsiteKm));

    const norm = (val: number, min: number, max: number) => (max > min ? (val - min) / (max - min) : 0);

    for (const item of splitCapableCandidates) {
      const ev = item.evaluation;
      const sRoute = norm(ev.additionalDistanceKm, minRoute, maxRoute);
      const sProx = norm(ev.distanceToStopsKm, minProx, maxProx);
      const effectiveLoadForScore = ev.eligible ? ev.projectedLoadPercent : item.candidate.currentLoadPercent ?? 100;
      const sCap = effectiveLoadForScore / 100;
      const sDump = norm(ev.distanceToDumpsiteKm, minDump, maxDump);

      ev.normalizedRouteImpactScore = Math.round(sRoute * 100) / 100;
      ev.normalizedDistanceScore = Math.round(sProx * 100) / 100;
      ev.normalizedCapacityScore = Math.round(sCap * 100) / 100;
      ev.normalizedDumpsiteScore = Math.round(sDump * 100) / 100;
      ev.compositeScore =
        Math.round(
          (WEIGHT_ROUTE_IMPACT * sRoute +
            WEIGHT_PROXIMITY * sProx +
            WEIGHT_CAPACITY * sCap +
            WEIGHT_DUMPSITE * sDump) *
            1000,
        ) / 1000;
    }

    singleTruckCandidates.sort((a, b) => a.evaluation.compositeScore - b.evaluation.compositeScore);
    singleTruckCandidates.forEach((item, idx) => {
      item.evaluation.rank = idx + 1;
    });
  }

  const bestSingle = singleTruckCandidates[0] ?? null;
  let assignments: TruckStopAssignment[] = [];
  let unassignedStops: UncollectedStop[] = [];
  let isMultiTruck = false;

  if (uncollectedStops.length > 0 && splitCapableCandidates.length > 0) {
    const canSplit = uncollectedStops.length >= 2 && splitCapableCandidates.length >= 2;
    const splitPlan = canSplit
      ? distributeStopsAcrossTrucks(splitCapableCandidates, uncollectedStops, disposalCoord)
      : null;

    if (!bestSingle) {
      // Case A: No single truck can hold all uncollected stops — multi-truck split is required
      if (splitPlan && splitPlan.assignments.length > 0) {
        assignments = splitPlan.assignments;
        unassignedStops = splitPlan.unassignedStops;
        isMultiTruck = assignments.length > 1;
        // Mark participating split trucks as eligible in evaluations
        let nextRank = 1;
        for (const a of assignments) {
          const ev = evaluations.find((e) => e.vehicleId === a.vehicleId);
          if (ev) {
            ev.eligible = true;
            ev.projectedLoadPercent = a.projectedLoadPercent;
            ev.additionalDistanceKm = a.additionalDistanceKm;
            ev.distanceToStopsKm = a.distanceToStopsKm;
            ev.distanceToDumpsiteKm = a.distanceToDumpsiteKm;
            ev.rank = nextRank++;
            ev.ineligibleReason = undefined;
          }
        }
      } else {
        // Only 1 partially-capable truck: assign as many stops as fit without exceeding 100%
        const partial = distributeStopsAcrossTrucks([splitCapableCandidates[0]], uncollectedStops, disposalCoord);
        assignments = partial.assignments;
        unassignedStops = partial.unassignedStops;
        if (assignments[0]) {
          const ev = evaluations.find((e) => e.vehicleId === assignments[0].vehicleId);
          if (ev) {
            ev.eligible = true;
            ev.projectedLoadPercent = assignments[0].projectedLoadPercent;
            ev.additionalDistanceKm = assignments[0].additionalDistanceKm;
            ev.rank = 1;
            ev.ineligibleReason = undefined;
          }
        }
      }
    } else {
      // Case B: Single truck fits all stops — check if multi-truck split materially improves route detour & balance
      const singleEval = bestSingle.evaluation;
      const singleCand = bestSingle.candidate;
      const minFeasibleSingleDetour = Math.min(
        ...singleTruckCandidates.map((item) => item.evaluation.additionalDistanceKm),
      );
      const splitTotalKm = splitPlan
        ? splitPlan.assignments.reduce((sum, a) => sum + a.additionalDistanceKm, 0)
        : Infinity;

      const splitSavesSubstantialDetour =
        splitPlan != null &&
        splitPlan.assignments.length > 1 &&
        splitPlan.unassignedStops.length === 0 &&
        uncollectedStops.length >= 4 &&
        (singleEval.projectedLoadPercent >= 90 ||
          (minFeasibleSingleDetour > 0.5 && splitTotalKm <= minFeasibleSingleDetour * 0.85));

      if (splitSavesSubstantialDetour && splitPlan) {
        assignments = splitPlan.assignments;
        unassignedStops = splitPlan.unassignedStops;
        isMultiTruck = assignments.length > 1;
        let nextRank = 1;
        for (const a of assignments) {
          const ev = evaluations.find((e) => e.vehicleId === a.vehicleId);
          if (ev) {
            ev.eligible = true;
            ev.projectedLoadPercent = a.projectedLoadPercent;
            ev.additionalDistanceKm = a.additionalDistanceKm;
            ev.distanceToStopsKm = a.distanceToStopsKm;
            ev.distanceToDumpsiteKm = a.distanceToDumpsiteKm;
            ev.rank = nextRank++;
            ev.ineligibleReason = undefined;
          }
        }
      } else {
        const orderedSingle = sequenceOverflowStops(singleCand.currentLocation!, uncollectedStops, disposalCoord);
        const demand = estimateTotalDemand(orderedSingle, singleCand);
        const stats = computeAdditionalDistanceForSubset(singleCand, orderedSingle, disposalCoord);
        assignments = [
          {
            vehicleId: singleCand.id,
            label: singleCand.label,
            driverId: singleCand.driverId,
            driverName: singleCand.driverName,
            assignedStops: orderedSingle,
            assignedBinIds: orderedSingle.map((s) => s.binId),
            stopsCount: orderedSingle.length,
            distanceToStopsKm: singleEval.distanceToStopsKm,
            additionalDistanceKm: singleEval.additionalDistanceKm,
            distanceToDumpsiteKm: singleEval.distanceToDumpsiteKm,
            startingLoadPercent: singleCand.currentLoadPercent ?? 0,
            addedLoadPercent: demand.totalPercent,
            projectedLoadPercent: singleEval.projectedLoadPercent,
            remainingCapacityPercent: singleEval.remainingCapacityPercent,
            addedVolumeLiters: demand.totalVolumeLiters,
            addedWeightKg: demand.totalWeightKg,
            limitingFactor: demand.limitingFactor,
            compositeScore: singleEval.compositeScore,
            waypoints: stats.waypoints,
          },
        ];
      }
    }
  } else if (uncollectedStops.length > 0) {
    unassignedStops = [...uncollectedStops];
  }

  const primaryAssignment = assignments[0] ?? null;
  const selected =
    bestSingle?.evaluation ??
    (primaryAssignment ? evaluations.find((e) => e.vehicleId === primaryAssignment.vehicleId) ?? null : null);

  const totalAdditionalDistanceKm =
    Math.round(assignments.reduce((sum, a) => sum + a.additionalDistanceKm, 0) * 100) / 100;

  let message: string;
  if (assignments.length === 0) {
    message = "Reassignment alert: No eligible online truck with verified driver, GPS, and capacity found.";
  } else if (isMultiTruck) {
    const summaryParts = assignments.map(
      (a) => `${a.label} (${a.stopsCount} stops, ${a.projectedLoadPercent}% load, +${a.additionalDistanceKm} km)`,
    );
    message = `Multi-Truck Split assigned ${uncollectedStops.length - unassignedStops.length}/${uncollectedStops.length} stops across ${assignments.length} trucks: ${summaryParts.join("; ")}.`;
  } else {
    const a = assignments[0];
    message = `Multi-Criteria selected ${a.label} (${a.stopsCount} stops, Score: ${a.compositeScore}, ΔD: +${a.additionalDistanceKm} km, Load: ${a.projectedLoadPercent}%).`;
    if (unassignedStops.length > 0) {
      message += ` ${unassignedStops.length} stop(s) remain unassigned due to fleet capacity limits.`;
    }
  }

  const t1 = performance.now();

  return {
    algorithm: "multi-criteria",
    selectedCandidate: selected,
    assignments,
    isMultiTruck,
    unassignedStops,
    evaluations,
    uncollectedStopsCount: uncollectedStops.length,
    estimatedAdditionalDistanceKm: primaryAssignment?.additionalDistanceKm ?? 0,
    totalAdditionalDistanceKm,
    capacityValidated: capacitySummary.capacityValidated,
    capacityValidationNote: capacitySummary.capacityValidationNote,
    disposalSite,
    processingTimeMs: Math.round((t1 - t0) * 100) / 100,
    message,
  };
}

/**
 * Runs side-by-side benchmark comparison between Baseline and Proposed Algorithm.
 */
export function runAlgorithmBenchmark(scenario: BenchmarkScenario): BenchmarkComparison {
  const disposal = scenario.disposalSite || SWMO_LANDFILL_DISPOSAL_SITE;
  const baselineResult = evaluateNearestTruckBaseline(
    scenario.candidates,
    scenario.uncollectedStops,
    disposal,
  );
  const proposedResult = evaluateMultiCriteriaReassignment(
    scenario.candidates,
    scenario.uncollectedStops,
    disposal,
  );

  const baseFleetKm = scenario.candidates.reduce((sum, c) => {
    if (!isValidCoordinate(c.currentLocation)) return sum;
    return sum + calculateTourDistanceKm(c.currentLocation, c.activeStops || [], disposal.coordinate);
  }, 0);

  const baselineSelected = baselineResult.selectedCandidate;
  const proposedSelected = proposedResult.selectedCandidate;

  const baselineFleetDist = Math.round((baseFleetKm + baselineResult.totalAdditionalDistanceKm) * 100) / 100;
  const proposedFleetDist = Math.round((baseFleetKm + proposedResult.totalAdditionalDistanceKm) * 100) / 100;

  const baselineViolation = baselineSelected && baselineSelected.projectedLoadPercent > 100 ? 1 : 0;
  const proposedViolation = proposedResult.assignments.filter((a) => a.projectedLoadPercent > 100).length;

  const assignmentByVehicleId = new Map(proposedResult.assignments.map((a) => [a.vehicleId, a]));

  const baselineMetrics: AlgorithmMetrics = {
    selectedVehicleId: baselineSelected?.vehicleId ?? null,
    selectedVehicleLabel: baselineSelected?.label ?? "None",
    selectedVehiclesCount: baselineSelected ? 1 : 0,
    totalFleetDistanceKm: baselineFleetDist,
    additionalDistanceKm: baselineResult.totalAdditionalDistanceKm,
    processingTimeMs: baselineResult.processingTimeMs,
    capacityViolations: baselineViolation,
    unservedStops: baselineResult.unassignedStops.length,
    avgFleetUtilizationPercent: Math.round(
      scenario.candidates.reduce(
        (sum, c) =>
          sum + (c.id === baselineSelected?.vehicleId ? baselineSelected.projectedLoadPercent : c.currentLoadPercent ?? 0),
        0,
      ) / scenario.candidates.length,
    ),
  };

  const proposedMetrics: AlgorithmMetrics = {
    selectedVehicleId: proposedSelected?.vehicleId ?? null,
    selectedVehicleLabel: proposedResult.isMultiTruck
      ? proposedResult.assignments.map((a) => a.label).join(" + ")
      : proposedSelected?.label ?? "None",
    selectedVehiclesCount: proposedResult.assignments.length,
    totalFleetDistanceKm: proposedFleetDist,
    additionalDistanceKm: proposedResult.totalAdditionalDistanceKm,
    processingTimeMs: proposedResult.processingTimeMs,
    capacityViolations: proposedViolation,
    unservedStops: proposedResult.unassignedStops.length,
    avgFleetUtilizationPercent: Math.round(
      scenario.candidates.reduce((sum, c) => {
        const assigned = assignmentByVehicleId.get(c.id);
        return sum + (assigned ? assigned.projectedLoadPercent : c.currentLoadPercent ?? 0);
      }, 0) / scenario.candidates.length,
    ),
  };

  const savedKm = Math.max(0, Math.round((baselineMetrics.totalFleetDistanceKm - proposedMetrics.totalFleetDistanceKm) * 100) / 100);
  const pctImprovement =
    baselineMetrics.additionalDistanceKm > 0
      ? Math.round(((baselineMetrics.additionalDistanceKm - proposedMetrics.additionalDistanceKm) / baselineMetrics.additionalDistanceKm) * 100)
      : 0;

  const summary =
    proposedResult.isMultiTruck && baselineViolation > 0
      ? `Proposed Multi-Criteria distributed overflow across ${proposedResult.assignments.length} trucks with 0 capacity violations, whereas Baseline overloaded or failed single-truck capacity.`
      : savedKm > 0
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
 * Built-in Benchmark Scenarios for operational defense and evaluation.
 */
export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "scenario-1",
    name: "Scenario 1: Single Truck Full (Nearest vs Capacity/Route Impact)",
    description:
      "Truck A signals full in Centro Naga. Truck B is 1.2 km away but already at 85% capacity with an opposing route. Truck C is 2.4 km away with only 40% capacity. Truck D is aligned along the route corridor toward SWMO Landfill.",
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
        currentLoadPercent: 95,
        status: "active",
        activeStops: [],
      },
      {
        id: "veh-4",
        label: "Truck D (Mini 01)",
        driverId: "drv-4",
        driverName: "Eduardo Diaz",
        currentLocation: { lat: 13.6265, lng: 123.1942 },
        currentLoadPercent: 30,
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
      "Fleet operations during heavy monsoon collection: multiple uncollected stops evaluated across candidate trucks while minimizing cumulative fleet travel to SWMO - Sanitary Landfill.",
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
  {
    id: "scenario-4",
    name: "Scenario 4: Multi-Truck Capacity Split (High-Volume Overflow)",
    description:
      "6 heavy stops require ~72% capacity, exceeding every individual truck's headroom (max 45%). Multi-Criteria distributes stops across Truck A and Truck D with zero capacity violations.",
    sourceTruck: {
      label: "Truck C (Compactor 01)",
      coordinate: { lat: 13.622, lng: 123.192 },
      loadPercent: 100,
    },
    uncollectedStops: [
      { id: "S10", binId: "BIN-401", coordinate: { lat: 13.621, lng: 123.188 }, stopOrder: 1, location: "Dinaga St Market", estimatedLoadPercent: 12 },
      { id: "S11", binId: "BIN-402", coordinate: { lat: 13.6225, lng: 123.1895 }, stopOrder: 2, location: "Elias Angeles Corner", estimatedLoadPercent: 12 },
      { id: "S12", binId: "BIN-403", coordinate: { lat: 13.624, lng: 123.191 }, stopOrder: 3, location: "J. Hernandez Ave", estimatedLoadPercent: 12 },
      { id: "S13", binId: "BIN-404", coordinate: { lat: 13.6295, lng: 123.2045 }, stopOrder: 4, location: "Dayangdang North", estimatedLoadPercent: 12 },
      { id: "S14", binId: "BIN-405", coordinate: { lat: 13.631, lng: 123.2065 }, stopOrder: 5, location: "Balatas Gate", estimatedLoadPercent: 12 },
      { id: "S15", binId: "BIN-406", coordinate: { lat: 13.6325, lng: 123.209 }, stopOrder: 6, location: "Cararayan Junction", estimatedLoadPercent: 12 },
    ],
    candidates: [
      {
        id: "veh-1",
        label: "Truck A (Dump 01)",
        driverId: "drv-1",
        driverName: "Carlos Mendoza",
        currentLocation: { lat: 13.6202, lng: 123.1872 },
        currentLoadPercent: 55, // 45% headroom -> fits 3 stops (36%)
        status: "active",
        activeStops: [{ lat: 13.6218, lng: 123.1901 }],
      },
      {
        id: "veh-4",
        label: "Truck D (Mini 01)",
        driverId: "drv-4",
        driverName: "Eduardo Diaz",
        currentLocation: { lat: 13.6288, lng: 123.2038 },
        currentLoadPercent: 60, // 40% headroom -> fits 3 stops (36%)
        status: "active",
        activeStops: [{ lat: 13.6315, lng: 123.208 }],
      },
    ],
    disposalSite: SWMO_LANDFILL_DISPOSAL_SITE,
  },
];
