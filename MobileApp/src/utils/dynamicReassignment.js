import { haversineMeters } from "./geoNav";

export const SWMO_LANDFILL_DISPOSAL_SITE = {
  name: "SWMO - Sanitary Landfill (San Isidro)",
  coordinate: { lat: 13.6212151, lng: 123.2576126 },
};

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

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function normalizeStatusToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function isValidCoordinate(coord) {
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
export function estimateStopDemand(stop, candidate) {
  const fillFraction =
    stop?.capacityPercent != null && Number.isFinite(Number(stop.capacityPercent))
      ? Math.max(0.15, Math.min(1, Number(stop.capacityPercent) / 100))
      : 1;

  const volumeLiters =
    stop?.estimatedVolumeLiters != null && Number(stop.estimatedVolumeLiters) > 0
      ? Number(stop.estimatedVolumeLiters)
      : Math.round(DEFAULT_STOP_VOLUME_LITERS * fillFraction);

  const weightKg =
    stop?.estimatedWeightKg != null && Number(stop.estimatedWeightKg) > 0
      ? Number(stop.estimatedWeightKg)
      : Math.round(DEFAULT_STOP_WEIGHT_KG * fillFraction);

  if (stop?.estimatedLoadPercent != null && Number(stop.estimatedLoadPercent) > 0) {
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
    stop?.capacityPercent != null && Number.isFinite(Number(stop.capacityPercent))
      ? Math.max(2, Math.round(DEFAULT_STOP_LOAD_PERCENT * fillFraction * 10) / 10)
      : DEFAULT_STOP_LOAD_PERCENT;

  return {
    volumeLiters,
    weightKg,
    percentOfTruck: pctFallback,
    limitingFactor: "percent",
  };
}

function estimateTotalDemand(stops, candidate) {
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

  const limitingFactor =
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
export function evaluateCandidateEligibility(cand) {
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

  if (
    cand.currentLoadPercent == null ||
    !Number.isFinite(cand.currentLoadPercent) ||
    cand.loadSource === "unverified"
  ) {
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
export function calculateTourDistanceKm(start, stops, end) {
  if (!stops || stops.length === 0) {
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
export function calculateCentroid(points) {
  if (!points || points.length === 0) return { lat: 13.6218, lng: 123.1948 };
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
export function orderStopsByProximity(origin, stops) {
  const remaining = [...stops];
  const ordered = [];
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
export function orderCoordinatesWith2Opt(origin, stops, terminal) {
  const validStops = (stops || []).filter((s) => isValidCoordinate(s));
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

function sequenceOverflowStops(origin, stops, terminal) {
  if (stops.length <= 1) return [...stops];
  const remaining = [...stops];
  const ordered = [];
  let current = origin;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const distFromCurrent = haversineMeters(current, remaining[i].coordinate);
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

function summarizeCapacityValidation(candidates) {
  const validCandidates = candidates.filter((c) => c.currentLoadPercent != null);
  const allDriverReported =
    validCandidates.length > 0 &&
    validCandidates.every((c) => !c.loadSource || c.loadSource === "driver_reported");
  const hasEstimated = validCandidates.some((c) => c.loadSource === "route_progress_estimated");
  const hasUnverified = candidates.some(
    (c) => c.currentLoadPercent == null || c.loadSource === "unverified",
  );
  const missingSpecs = candidates.filter(
    (c) => !(c.capacityLiters && c.capacityLiters > 0) && !(c.capacityKg && c.capacityKg > 0),
  );

  if (allDriverReported && !hasUnverified && missingSpecs.length === 0) {
    return { capacityValidated: true, capacityValidationNote: null };
  }

  const notes = [];
  if (hasUnverified) {
    notes.push("trucks without verifiable load data were excluded");
  }
  if (hasEstimated) {
    notes.push(
      "truck load estimated from active route completion where driver-reported load_percent was unavailable",
    );
  }
  if (missingSpecs.length > 0) {
    notes.push("percentage stop load used where capacity_liters/capacity_kg were not set");
  }

  return {
    capacityValidated: !hasEstimated && !hasUnverified && missingSpecs.length === 0,
    capacityValidationNote: notes.length > 0 ? notes.join("; ") : null,
  };
}

function computeAdditionalDistanceForSubset(cand, subset, disposalCoord) {
  const origin = cand.currentLocation;
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
  const distanceToDumpsiteKm =
    Math.round((haversineMeters(lastStop, disposalCoord) / 1000) * 100) / 100;

  return {
    additionalDistanceKm,
    distanceToStopsKm,
    distanceToDumpsiteKm,
    waypoints: [origin, ...mergedStops, disposalCoord],
  };
}

function distributeStopsAcrossTrucks(eligibleInputs, uncollectedStops, disposalCoord) {
  if (eligibleInputs.length === 0 || uncollectedStops.length === 0) {
    return { assignments: [], unassignedStops: [...uncollectedStops] };
  }

  const buckets = eligibleInputs.map(({ candidate, evaluation }) => ({
    candidate,
    evaluation,
    assigned: [],
    currentLoad: candidate.currentLoadPercent ?? 100,
    addedLoad: 0,
    addedVolumeLiters: 0,
    addedWeightKg: 0,
  }));

  const remainingStops = [...uncollectedStops].sort((a, b) => a.stopOrder - b.stopOrder);
  const unassignedStops = [];

  for (const stop of remainingStops) {
    let bestBucketIdx = -1;
    let bestInsertionCost = Infinity;

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const stopEst = estimateStopDemand(stop, b.candidate);
      const nextProjected = b.currentLoad + b.addedLoad + stopEst.percentOfTruck;
      if (nextProjected > 100) continue;

      const beforeKm =
        b.assigned.length === 0
          ? calculateTourDistanceKm(
              b.candidate.currentLocation,
              b.candidate.activeStops || [],
              disposalCoord,
            )
          : computeAdditionalDistanceForSubset(b.candidate, b.assigned, disposalCoord)
              .additionalDistanceKm +
            calculateTourDistanceKm(
              b.candidate.currentLocation,
              b.candidate.activeStops || [],
              disposalCoord,
            );

      const nextSubset = [...b.assigned, stop];
      const afterStats = computeAdditionalDistanceForSubset(b.candidate, nextSubset, disposalCoord);
      const afterKm =
        calculateTourDistanceKm(
          b.candidate.currentLocation,
          b.candidate.activeStops || [],
          disposalCoord,
        ) + afterStats.additionalDistanceKm;

      const marginalDeltaKm = Math.max(0, afterKm - beforeKm);
      const proximityKm = haversineMeters(b.candidate.currentLocation, stop.coordinate) / 1000;
      const loadPenalty = (nextProjected / 100) * 1.4;
      const reuseBonus = b.assigned.length > 0 ? 0 : 0.65;
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
  const assignments = activeBuckets.map((b) => {
    const orderedStops = sequenceOverflowStops(
      b.candidate.currentLocation,
      b.assigned,
      disposalCoord,
    );
    const routeStats = computeAdditionalDistanceForSubset(
      b.candidate,
      orderedStops,
      disposalCoord,
    );
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
 */
export function evaluateNearestTruckBaseline(
  candidates,
  uncollectedStops,
  disposalSite = SWMO_LANDFILL_DISPOSAL_SITE,
) {
  const t0 = nowMs();
  const uncollectedCoords = uncollectedStops.map((s) => s.coordinate);
  const centroid = calculateCentroid(uncollectedCoords);
  const capacitySummary = summarizeCapacityValidation(candidates);

  const evaluations = candidates.map((cand) => {
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

    const origin = cand.currentLocation;
    const distToCentroid = haversineMeters(origin, centroid) / 1000;
    const routeStats = computeAdditionalDistanceForSubset(
      cand,
      uncollectedStops,
      disposalSite.coordinate,
    );

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
  const selectedVehicle = selected
    ? candidates.find((c) => c.id === selected.vehicleId) ?? null
    : null;
  const assignments =
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
            addedLoadPercent:
              Math.round((selected.projectedLoadPercent - (selectedVehicle.currentLoadPercent ?? 0)) * 10) / 10,
            projectedLoadPercent: selected.projectedLoadPercent,
            remainingCapacityPercent: selected.remainingCapacityPercent,
            addedVolumeLiters: estimateTotalDemand(uncollectedStops, selectedVehicle).totalVolumeLiters,
            addedWeightKg: estimateTotalDemand(uncollectedStops, selectedVehicle).totalWeightKg,
            limitingFactor: selected.limitingFactor ?? "percent",
            compositeScore: selected.compositeScore,
            waypoints: computeAdditionalDistanceForSubset(
              selectedVehicle,
              uncollectedStops,
              disposalSite.coordinate,
            ).waypoints,
          },
        ]
      : [];

  const t1 = nowMs();

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
 */
export function evaluateMultiCriteriaReassignment(
  candidates,
  uncollectedStops,
  disposalSite = SWMO_LANDFILL_DISPOSAL_SITE,
) {
  const t0 = nowMs();
  const WEIGHT_ROUTE_IMPACT = 0.40;
  const WEIGHT_PROXIMITY = 0.25;
  const WEIGHT_CAPACITY = 0.20;
  const WEIGHT_DUMPSITE = 0.15;

  const capacitySummary = summarizeCapacityValidation(candidates);
  const disposalCoord = isValidCoordinate(disposalSite?.coordinate)
    ? disposalSite.coordinate
    : SWMO_LANDFILL_DISPOSAL_SITE.coordinate;

  const singleTruckCandidates = [];
  const splitCapableCandidates = [];

  const evaluations = candidates.map((cand) => {
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
      uncollectedStops.length === 0 ||
      currentLoad + (Number.isFinite(minStopDemand) ? minStopDemand : 0) <= 100;
    const canFitAllStops = projectedLoad <= 100;

    const evalItem = {
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

  if (splitCapableCandidates.length > 0) {
    const scorePool = singleTruckCandidates.length > 0 ? singleTruckCandidates : splitCapableCandidates;
    const minRoute = Math.min(...scorePool.map((c) => c.evaluation.additionalDistanceKm));
    const maxRoute = Math.max(...scorePool.map((c) => c.evaluation.additionalDistanceKm));
    const minProx = Math.min(...scorePool.map((c) => c.evaluation.distanceToStopsKm));
    const maxProx = Math.max(...scorePool.map((c) => c.evaluation.distanceToStopsKm));
    const minDump = Math.min(...scorePool.map((c) => c.evaluation.distanceToDumpsiteKm));
    const maxDump = Math.max(...scorePool.map((c) => c.evaluation.distanceToDumpsiteKm));

    const norm = (val, min, max) => (max > min ? (val - min) / (max - min) : 0);

    for (const item of splitCapableCandidates) {
      const ev = item.evaluation;
      const sRoute = norm(ev.additionalDistanceKm, minRoute, maxRoute);
      const sProx = norm(ev.distanceToStopsKm, minProx, maxProx);
      const effectiveLoadForScore = ev.eligible
        ? ev.projectedLoadPercent
        : item.candidate.currentLoadPercent ?? 100;
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
  let assignments = [];
  let unassignedStops = [];
  let isMultiTruck = false;

  if (uncollectedStops.length > 0 && splitCapableCandidates.length > 0) {
    const canSplit = uncollectedStops.length >= 2 && splitCapableCandidates.length >= 2;
    const splitPlan = canSplit
      ? distributeStopsAcrossTrucks(splitCapableCandidates, uncollectedStops, disposalCoord)
      : null;

    if (!bestSingle) {
      if (splitPlan && splitPlan.assignments.length > 0) {
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
        const partial = distributeStopsAcrossTrucks(
          [splitCapableCandidates[0]],
          uncollectedStops,
          disposalCoord,
        );
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
        const orderedSingle = sequenceOverflowStops(
          singleCand.currentLocation,
          uncollectedStops,
          disposalCoord,
        );
        const demand = estimateTotalDemand(orderedSingle, singleCand);
        const stats = computeAdditionalDistanceForSubset(
          singleCand,
          orderedSingle,
          disposalCoord,
        );
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
    (primaryAssignment
      ? evaluations.find((e) => e.vehicleId === primaryAssignment.vehicleId) ?? null
      : null);

  const totalAdditionalDistanceKm =
    Math.round(assignments.reduce((sum, a) => sum + a.additionalDistanceKm, 0) * 100) / 100;

  let message;
  if (assignments.length === 0) {
    message =
      "Reassignment alert: No eligible online truck with verified driver, GPS, and capacity found.";
  } else if (isMultiTruck) {
    const summaryParts = assignments.map(
      (a) =>
        `${a.label} (${a.stopsCount} stops, ${a.projectedLoadPercent}% load, +${a.additionalDistanceKm} km)`,
    );
    message = `Multi-Truck Split assigned ${uncollectedStops.length - unassignedStops.length}/${uncollectedStops.length} stops across ${assignments.length} trucks: ${summaryParts.join("; ")}.`;
  } else {
    const a = assignments[0];
    message = `Multi-Criteria selected ${a.label} (${a.stopsCount} stops, Score: ${a.compositeScore}, ΔD: +${a.additionalDistanceKm} km, Load: ${a.projectedLoadPercent}%).`;
    if (unassignedStops.length > 0) {
      message += ` ${unassignedStops.length} stop(s) remain unassigned due to fleet capacity limits.`;
    }
  }

  const t1 = nowMs();

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
