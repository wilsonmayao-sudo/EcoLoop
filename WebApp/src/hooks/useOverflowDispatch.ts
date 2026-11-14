import { useCallback, useMemo, useRef } from "react";
import {
  useLiveData,
  isBinActive,
  normalizeStatus,
  type DriverRecord,
  type OverflowBinEntry,
  type OverflowEventRecord,
  type RouteRecord,
  type VehicleRecord,
  type VehicleLocationRecord,
} from "./useLiveData";
import { getConfiguredLandfill } from "../utils/systemSettings";
import { fetchStreetRouteWithFeedback, isValidLngLat, type LngLat } from "../services/streetRouteService";
import { supabase } from "../services/supabaseClient";
import {
  evaluateCandidateEligibility,
  evaluateMultiCriteriaReassignment,
  evaluateNearestTruckBaseline,
  isValidCoordinate,
  SWMO_LANDFILL_DISPOSAL_SITE,
  type CandidateVehicle,
  type ReassignmentResult,
  type TruckStopAssignment,
  type UncollectedStop,
} from "../utils/routing/dynamicReassignment";

/** Truck fleet status derived from overflow + route state. */
export type FleetOverflowStatus = "IN_PROGRESS" | "FULL" | "ASSISTING_OVERFLOW" | "IDLE";

/** Bin pickup status from overflow perspective. */
export type BinOverflowStatus = "COLLECTED" | "ACTIVE_QUEUE" | "OVERFLOW_TRANSFER";

export interface FleetStatusEntry {
  vehicle: VehicleRecord;
  driver: DriverRecord | null;
  route: RouteRecord | null;
  overflowStatus: FleetOverflowStatus;
  loadPercent: number;
  routeName: string;
}

export interface OverflowLogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: "signal" | "dispatch" | "accept" | "decline" | "complete";
}

function isMissingRpcError(error: any) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const combined = `${String(error.message ?? "")} ${String(error.details ?? "")}`.toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    combined.includes("could not find the function") ||
    (combined.includes("function") && combined.includes("does not exist"))
  );
}

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function latestVehicleLocation(
  vehicleId: string | number,
  driverId: string | number | null | undefined,
  locations: VehicleLocationRecord[],
) {
  const byVehicle = locations.find((loc) => loc.vehicle_id != null && String(loc.vehicle_id) === String(vehicleId));
  if (byVehicle) return byVehicle;
  if (driverId != null) {
    return locations.find((loc) => loc.driver_id != null && String(loc.driver_id) === String(driverId)) ?? null;
  }
  return null;
}

function isSameLocalDay(isoTimestamp?: string | null, todayRef = new Date()) {
  if (!isoTimestamp) return false;
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === todayRef.getFullYear() &&
    date.getMonth() === todayRef.getMonth() &&
    date.getDate() === todayRef.getDate()
  );
}

function attachMetaToOverflowBins(bins: OverflowBinEntry[], meta: Record<string, any>): OverflowBinEntry[] {
  if (bins.length === 0) return bins;
  return bins.map((b, idx) => (idx === 0 ? { ...b, _meta: meta } : b));
}

function toOverflowBinEntries(stops: UncollectedStop[]): OverflowBinEntry[] {
  return stops.map((stop, idx) => ({
    bin_id: stop.binId,
    stop_order: stop.stopOrder ?? idx + 1,
    lat: stop.coordinate.lat,
    lng: stop.coordinate.lng,
    location: stop.location,
    capacity_percent: stop.capacityPercent ?? null,
  }));
}

export function useOverflowDispatch() {
  const data = useLiveData();
  const {
    vehicles,
    drivers,
    routeStops,
    deliveries,
    overflowEvents,
    vehicleLocations,
    bins,
    operationsConfig,
    driverById,
    routeById,
    vehicleById,
    createOverflowEvent,
    updateOverflowEvent,
    updateVehicle,
    createNotification,
    refreshLiveProgress,
  } = data;

  const acceptingEventIdsRef = useRef<Set<string>>(new Set());

  /** Resolve driver linked to a vehicle using vehicle.driver_id or drivers.assigned_vehicle_id. */
  const resolveDriverForVehicle = useCallback(
    (vehicle: VehicleRecord): DriverRecord | null => {
      if (vehicle.driver_id != null) {
        const direct = driverById.get(String(vehicle.driver_id));
        if (direct) return direct;
      }
      const candidates = drivers.filter(
        (d) => d.assigned_vehicle_id != null && String(d.assigned_vehicle_id) === String(vehicle.id),
      );
      if (candidates.length === 0) return null;
      const nonSuspended = candidates.filter((d) => {
        const s = normalizeStatus(d.status);
        return s !== "inactive" && s !== "suspended";
      });
      const pool = nonSuspended.length > 0 ? nonSuspended : candidates;
      return (
        pool.find((d) => normalizeStatus(d.status) !== "offline") ??
        pool[0] ??
        null
      );
    },
    [driverById, drivers],
  );

  /** Determine the overflow status badge for a vehicle. */
  const getVehicleOverflowStatus = useCallback(
    (vehicleId: string | number): FleetOverflowStatus => {
      const vid = String(vehicleId);
      const vehicle = vehicleById.get(vid);
      if (!vehicle) return "IDLE";

      const asFull = overflowEvents.find(
        (e) => String(e.source_vehicle_id) === vid && (e.status === "pending" || e.status === "dispatched"),
      );
      if (asFull) return "FULL";

      const asAssist = overflowEvents.find(
        (e) =>
          String(e.target_vehicle_id) === vid &&
          (e.status === "accepted" || e.status === "dispatched"),
      );
      if (asAssist) return "ASSISTING_OVERFLOW";

      const vStatus = normalizeStatus(vehicle.status);
      if (vStatus === "active" || vStatus === "on_route" || vehicle.route_id) return "IN_PROGRESS";

      return "IDLE";
    },
    [overflowEvents, vehicleById],
  );

  /** Build fleet status list for all active vehicles. */
  const fleetStatusList = useMemo((): FleetStatusEntry[] => {
    return vehicles
      .filter((vehicle) => vehicle.is_active !== false)
      .map((vehicle) => {
        const driver = resolveDriverForVehicle(vehicle);
        const route = vehicle.route_id ? routeById.get(String(vehicle.route_id)) ?? null : null;
        const overflowStatus = getVehicleOverflowStatus(vehicle.id);

        let loadPercent =
          typeof vehicle.load_percent === "number" && Number.isFinite(vehicle.load_percent) && vehicle.load_percent >= 0
            ? vehicle.load_percent
            : 0;
        const routeId = vehicle.route_id;
        if (loadPercent === 0 && routeId) {
          const routeDels = deliveries.filter((d) => String(d.route_id) === String(routeId));
          const total = routeDels.length;
          const completed = routeDels.filter((d) => normalizeStatus(d.status) === "completed").length;
          loadPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
        }
        if (overflowStatus === "FULL") loadPercent = 100;

        return {
          vehicle,
          driver,
          route,
          overflowStatus,
          loadPercent,
          routeName: route?.name ?? "Unassigned",
        };
      });
  }, [vehicles, resolveDriverForVehicle, routeById, deliveries, getVehicleOverflowStatus]);

  /** Determine bin display status for the overflow map. */
  const getBinOverflowStatus = useCallback(
    (binId: string | number): BinOverflowStatus => {
      const bid = String(binId);
      const inOverflow = overflowEvents.find(
        (e) =>
          (e.status === "dispatched" || e.status === "accepted" || e.status === "pending") &&
          e.overflow_bins?.some((ob) => String(ob.bin_id) === bid),
      );
      if (inOverflow) return "OVERFLOW_TRANSFER";

      const delivery = deliveries.find((d) => String(d.bin_id) === bid && normalizeStatus(d.status) === "completed");
      if (delivery) return "COLLECTED";

      return "ACTIVE_QUEUE";
    },
    [overflowEvents, deliveries],
  );

  /** Construct candidate vehicle representations with strict GPS, driver, overflow-lock, and capacity state. */
  const buildCandidateVehicles = useCallback(
    (sourceVehicleId: string | number, ignoreEventId?: string): CandidateVehicle[] => {
      const nowMs = Date.now();
      const maxOfflineSec = operationsConfig?.driverOfflineSeconds ?? 90;

      // Track open overflow assignments so a truck cannot concurrently assist two events
      const busyTargetVehicleIds = new Set<string>();
      const busyTargetDriverIds = new Set<string>();
      const busySourceVehicleIds = new Set<string>();
      overflowEvents.forEach((ev) => {
        if (ignoreEventId && ev.id === ignoreEventId) return;
        const statusNorm = normalizeStatus(ev.status);
        if (statusNorm !== "pending" && statusNorm !== "dispatched" && statusNorm !== "accepted") return;
        if (ev.source_vehicle_id != null) busySourceVehicleIds.add(String(ev.source_vehicle_id));
        if (statusNorm === "dispatched" || statusNorm === "accepted") {
          if (ev.target_vehicle_id != null) busyTargetVehicleIds.add(String(ev.target_vehicle_id));
          if (ev.target_driver_id != null) busyTargetDriverIds.add(String(ev.target_driver_id));
        }
      });

      return vehicles
        .filter((v) => String(v.id) !== String(sourceVehicleId))
        .map((v) => {
          const driver = resolveDriverForVehicle(v);
          const loc = latestVehicleLocation(v.id, driver?.id, vehicleLocations);
          const rawLat = finiteNumber(loc?.latitude ?? v.latitude);
          const rawLng = finiteNumber(loc?.longitude ?? v.longitude);
          const candidateCoord =
            rawLat != null && rawLng != null ? { lat: rawLat, lng: rawLng } : null;
          const currentLocation = isValidCoordinate(candidateCoord) ? candidateCoord : null;

          const gpsTimestamp = loc?.updated_at ?? loc?.recorded_at ?? v.last_seen_at ?? driver?.last_seen_at ?? null;
          const gpsMs = gpsTimestamp ? new Date(gpsTimestamp).getTime() : NaN;
          const gpsAgeSeconds = Number.isFinite(gpsMs) ? Math.max(0, (nowMs - gpsMs) / 1000) : Infinity;
          const driverIsOfflineStatus = driver != null && normalizeStatus(driver.status) === "offline";
          const isGpsFresh =
            currentLocation != null &&
            Number.isFinite(gpsAgeSeconds) &&
            gpsAgeSeconds <= maxOfflineSec &&
            !driverIsOfflineStatus;

          // Resolve active route id for capacity progress + remaining stops
          const activeRouteId =
            v.route_id ??
            (driver?.id != null
              ? data.routes.find(
                  (r) =>
                    String(r.driver_id) === String(driver.id) &&
                    ["active", "pending", "planned"].includes(normalizeStatus(r.status)),
                )?.id ?? null
              : null);

          let currentLoadPercent: number | null = null;
          let loadSource: CandidateVehicle["loadSource"] = "unverified";

          if (typeof v.load_percent === "number" && Number.isFinite(v.load_percent) && v.load_percent >= 0) {
            currentLoadPercent = Math.max(0, Math.min(100, v.load_percent));
            loadSource = "driver_reported";
          } else if (activeRouteId != null) {
            const routeDeliveries = deliveries.filter((d) => String(d.route_id) === String(activeRouteId));
            if (routeDeliveries.length > 0) {
              const completed = routeDeliveries.filter((d) => normalizeStatus(d.status) === "completed").length;
              currentLoadPercent = Math.round((completed / routeDeliveries.length) * 100);
              loadSource = "route_progress_estimated";
            } else {
              currentLoadPercent = null;
              loadSource = "unverified";
            }
          } else {
            // Vehicle is confirmed idle with no active route
            const hasOpenDriverDeliveries =
              driver?.id != null &&
              deliveries.some(
                (d) =>
                  String(d.driver_id) === String(driver.id) &&
                  !["completed", "cancelled"].includes(normalizeStatus(d.status)),
              );
            if (!hasOpenDriverDeliveries) {
              currentLoadPercent = 0;
              loadSource = "route_progress_estimated";
            }
          }

          // Only include uncollected active stops remaining on candidate's route
          const completedBinSet = activeRouteId
            ? new Set(
                deliveries
                  .filter(
                    (d) =>
                      String(d.route_id) === String(activeRouteId) &&
                      ["completed", "cancelled"].includes(normalizeStatus(d.status)),
                  )
                  .map((d) => String(d.bin_id)),
              )
            : new Set<string>();

          const stopsOnRoute = activeRouteId
            ? routeStops
                .filter((s) => String(s.route_id) === String(activeRouteId) && !completedBinSet.has(String(s.bin_id)))
                .map((s) => {
                  const bin = s.bins ?? bins.find((b) => String(b.id) === String(s.bin_id));
                  return { lat: Number(bin?.latitude ?? 0), lng: Number(bin?.longitude ?? 0) };
                })
                .filter((c) => isValidCoordinate(c))
            : [];

          const hasActiveOverflowAssignment =
            busySourceVehicleIds.has(String(v.id)) ||
            busyTargetVehicleIds.has(String(v.id)) ||
            (driver?.id != null && busyTargetDriverIds.has(String(driver.id)));

          return {
            id: String(v.id),
            label: v.label || v.code || v.truck_code || `Truck #${v.id}`,
            driverId: driver?.id != null ? String(driver.id) : null,
            driverName: driver?.name ?? "Unassigned Driver",
            driverStatus: driver?.status ?? null,
            isActive: v.is_active !== false,
            currentLocation,
            currentLoadPercent,
            loadSource,
            status: v.status,
            activeStops: stopsOnRoute,
            capacityLiters: finiteNumber(v.capacity_liters),
            capacityKg: finiteNumber(v.capacity_kg),
            gpsTimestamp,
            gpsAgeSeconds,
            isGpsFresh,
            maxOfflineSeconds: maxOfflineSec,
            hasActiveOverflowAssignment,
          };
        });
    },
    [
      bins,
      data.routes,
      deliveries,
      operationsConfig?.driverOfflineSeconds,
      overflowEvents,
      resolveDriverForVehicle,
      routeStops,
      vehicleLocations,
      vehicles,
    ],
  );

  /** Calculate street-following route distance & duration via Mapbox Directions through assigned stops to SWMO Landfill. */
  const syncAssistingRouteWithMapbox = useCallback(
    async (
      routeId: string,
      targetVehicleId: string | null,
      targetDriverId: string | null,
      overflowBins: OverflowBinEntry[],
    ) => {
      const landfill = getConfiguredLandfill();
      const waypoints: LngLat[] = [];

      const truckLoc =
        targetVehicleId != null
          ? latestVehicleLocation(targetVehicleId, targetDriverId, vehicleLocations)
          : null;
      const targetVehicle = targetVehicleId ? vehicleById.get(String(targetVehicleId)) : null;
      const startLat = finiteNumber(truckLoc?.latitude ?? targetVehicle?.latitude);
      const startLng = finiteNumber(truckLoc?.longitude ?? targetVehicle?.longitude);
      if (startLat != null && startLng != null && isValidLngLat(startLat, startLng)) {
        waypoints.push([startLng, startLat]);
      }

      // Include any existing open stops already on the assisting route + the overflow bins
      const existingRouteStops = routeStops
        .filter((rs) => String(rs.route_id) === String(routeId))
        .sort((a, b) => a.stop_order - b.stop_order);

      const seenBinIds = new Set<string>();
      for (const rs of existingRouteStops) {
        const bin = rs.bins ?? bins.find((b) => String(b.id) === String(rs.bin_id));
        if (bin && isValidLngLat(bin.latitude, bin.longitude)) {
          waypoints.push([Number(bin.longitude), Number(bin.latitude)]);
          seenBinIds.add(String(rs.bin_id));
        }
      }
      for (const ob of overflowBins) {
        if (seenBinIds.has(String(ob.bin_id))) continue;
        if (isValidLngLat(ob.lat, ob.lng)) {
          waypoints.push([Number(ob.lng), Number(ob.lat)]);
        }
      }

      if (isValidLngLat(landfill.lat, landfill.lng)) {
        waypoints.push([landfill.lng, landfill.lat]);
      }

      if (waypoints.length < 2) return null;

      const streetResp = await fetchStreetRouteWithFeedback(`overflow-route-${routeId}`, waypoints);
      if (!streetResp.result) return null;

      const distanceKm = Math.round((streetResp.result.distanceMeters / 1000) * 100) / 100;
      const durationMinutes = Math.max(1, Math.round(streetResp.result.durationSeconds / 60));

      await supabase
        .from("routes")
        .update({
          distance_km: distanceKm,
          duration_minutes: durationMinutes,
          optimization_method: "dynamic-reassignment+mapbox",
          cost_source: streetResp.result.source,
        })
        .eq("id", routeId);

      return {
        distanceKm,
        durationMinutes,
        source: streetResp.result.source,
        coordinates: streetResp.result.coordinates,
      };
    },
    [bins, routeStops, vehicleById, vehicleLocations],
  );

  /** Baseline: Nearest eligible truck (kept only for benchmark/comparison UI option). */
  const findNearestAvailableTruck = useCallback(
    (sourceVehicleId: string | number, uncollectedStops: UncollectedStop[] = []): { vehicle: VehicleRecord; driver: DriverRecord; distanceKm: number } | null => {
      const candidates = buildCandidateVehicles(sourceVehicleId);
      const landfill = getConfiguredLandfill();
      const disposalSite = {
        name: landfill.name || SWMO_LANDFILL_DISPOSAL_SITE.name,
        coordinate: { lat: landfill.lat, lng: landfill.lng },
      };
      const res = evaluateNearestTruckBaseline(candidates, uncollectedStops, disposalSite);
      const sel = res.selectedCandidate;
      if (!sel) return null;
      const veh = vehicleById.get(String(sel.vehicleId));
      const drv = veh ? resolveDriverForVehicle(veh) : null;
      if (!veh || !drv) return null;
      return {
        vehicle: veh,
        driver: drv,
        distanceKm: sel.distanceToStopsKm,
      };
    },
    [buildCandidateVehicles, resolveDriverForVehicle, vehicleById],
  );

  /** Proposed: Custom Multi-Criteria Dynamic Reassignment Engine with Multi-Truck Split. */
  const findMultiCriteriaOptimalTruck = useCallback(
    (sourceVehicleId: string | number, uncollectedStops: UncollectedStop[], ignoreEventId?: string): ReassignmentResult => {
      const candidates = buildCandidateVehicles(sourceVehicleId, ignoreEventId);
      const landfill = getConfiguredLandfill();
      const disposalSite = {
        name: landfill.name || SWMO_LANDFILL_DISPOSAL_SITE.name,
        coordinate: { lat: landfill.lat, lng: landfill.lng },
      };
      return evaluateMultiCriteriaReassignment(candidates, uncollectedStops, disposalSite);
    },
    [buildCandidateVehicles],
  );

  /** Update driver-reported truck capacity percentage. */
  const updateVehicleLoadPercent = useCallback(
    async (vehicleId: string | number, loadPercent: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(loadPercent)));
      try {
        await updateVehicle(String(vehicleId), { load_percent: clamped });
      } catch (err) {
        console.warn("updateVehicleLoadPercent note:", err);
      }
    },
    [updateVehicle],
  );

  /** Signal truck full: runs Custom Dynamic Reassignment Engine, handles single or multi-truck splits, records metadata, alerts fleet. */
  const signalTruckFull = useCallback(
    async (
      vehicleId: string | number,
      driverId: string | number,
      routeId: string,
      algorithm: "multi-criteria" | "nearest-baseline" = "multi-criteria",
    ) => {
      const normalizedVehicleId = String(vehicleId ?? "").trim();
      if (!normalizedVehicleId || normalizedVehicleId === "null" || normalizedVehicleId === "undefined") {
        throw new Error("Source vehicle assignment is required to signal truck overflow.");
      }

      const stops = routeStops
        .filter((s) => String(s.route_id) === String(routeId))
        .sort((a, b) => a.stop_order - b.stop_order);
      const completedBinIds = new Set(
        deliveries
          .filter(
            (d) =>
              String(d.route_id) === String(routeId) &&
              ["completed", "cancelled"].includes(normalizeStatus(d.status)),
          )
          .map((d) => String(d.bin_id)),
      );

      const uncollectedStops = stops.filter((s) => {
        if (completedBinIds.has(String(s.bin_id))) return false;
        const bin = s.bins ?? bins.find((b) => String(b.id) === String(s.bin_id));
        return bin ? isBinActive(bin) : true;
      });
      const allOverflowBins: OverflowBinEntry[] = uncollectedStops.map((stop) => {
        const bin = stop.bins ?? bins.find((b) => String(b.id) === String(stop.bin_id));
        return {
          bin_id: stop.bin_id,
          stop_order: stop.stop_order,
          lat: Number(bin?.latitude ?? 0),
          lng: Number(bin?.longitude ?? 0),
          location: bin?.location ?? "Unknown",
          capacity_percent: bin?.capacity_percent ?? null,
        };
      });

      if (allOverflowBins.length === 0) return null;

      const algoStops: UncollectedStop[] = allOverflowBins.map((ob, idx) => ({
        id: `stop-${ob.bin_id}`,
        binId: ob.bin_id,
        coordinate: { lat: ob.lat, lng: ob.lng },
        stopOrder: ob.stop_order ?? idx + 1,
        location: ob.location,
        capacityPercent: ob.capacity_percent ?? null,
      }));

      const candidates = buildCandidateVehicles(vehicleId);
      const landfill = getConfiguredLandfill();
      const disposalSite = {
        name: landfill.name || SWMO_LANDFILL_DISPOSAL_SITE.name,
        coordinate: { lat: landfill.lat, lng: landfill.lng },
      };

      const algorithmResult: ReassignmentResult =
        algorithm === "multi-criteria"
          ? evaluateMultiCriteriaReassignment(candidates, algoStops, disposalSite)
          : evaluateNearestTruckBaseline(candidates, algoStops, disposalSite);

      const createdEvents: Partial<OverflowEventRecord>[] = [];
      const nowIso = new Date().toISOString();

      if (algorithmResult.assignments.length > 0) {
        const totalSplits = algorithmResult.assignments.length;
        for (let idx = 0; idx < totalSplits; idx++) {
          const assign = algorithmResult.assignments[idx];
          const assignedVehicle = vehicleById.get(String(assign.vehicleId));
          const resolvedDriver = assign.driverId
            ? driverById.get(String(assign.driverId)) ?? null
            : assignedVehicle
              ? resolveDriverForVehicle(assignedVehicle)
              : null;
          const targetDriverId = resolvedDriver?.id ?? assign.driverId ?? null;
          const subsetBins = toOverflowBinEntries(assign.assignedStops);

          const meta = {
            algorithm,
            decision: algorithmResult.message,
            isMultiTruck: algorithmResult.isMultiTruck,
            splitIndex: idx + 1,
            splitCount: totalSplits,
            processingTimeMs: algorithmResult.processingTimeMs,
            additionalDistanceKm: assign.additionalDistanceKm,
            totalAdditionalDistanceKm: algorithmResult.totalAdditionalDistanceKm,
            projectedLoadPercent: assign.projectedLoadPercent,
            limitingFactor: assign.limitingFactor,
            capacityValidated: algorithmResult.capacityValidated,
            capacityValidationNote: algorithmResult.capacityValidationNote,
            evaluations: algorithmResult.evaluations,
            disposalSite: algorithmResult.disposalSite,
          };

          const eventPayload: Partial<OverflowEventRecord> = {
            source_vehicle_id: normalizedVehicleId,
            source_driver_id: driverId,
            source_route_id: routeId,
            target_vehicle_id: assign.vehicleId,
            target_driver_id: targetDriverId,
            status: targetDriverId ? "dispatched" : "pending",
            overflow_bins: attachMetaToOverflowBins(subsetBins, meta),
            bins_count: subsetBins.length,
            distance_km: assign.distanceToStopsKm,
            reassignment_metadata: meta,
            created_at: nowIso,
          };

          await createOverflowEvent(eventPayload);
          createdEvents.push(eventPayload);
        }

        if (algorithmResult.unassignedStops.length > 0) {
          const leftoverBins = toOverflowBinEntries(algorithmResult.unassignedStops);
          const leftoverMeta = {
            algorithm,
            decision: `Unassigned overflow remainder (${leftoverBins.length} stops exceed remaining fleet capacity)`,
            isMultiTruck: true,
            capacityValidated: algorithmResult.capacityValidated,
            capacityValidationNote: algorithmResult.capacityValidationNote,
            evaluations: algorithmResult.evaluations,
            disposalSite: algorithmResult.disposalSite,
          };
          const pendingRemainder: Partial<OverflowEventRecord> = {
            source_vehicle_id: normalizedVehicleId,
            source_driver_id: driverId,
            source_route_id: routeId,
            target_vehicle_id: null,
            target_driver_id: null,
            status: "pending",
            overflow_bins: attachMetaToOverflowBins(leftoverBins, leftoverMeta),
            bins_count: leftoverBins.length,
            distance_km: null,
            reassignment_metadata: leftoverMeta,
            created_at: nowIso,
          };
          await createOverflowEvent(pendingRemainder);
          createdEvents.push(pendingRemainder);
        }
      } else {
        // No eligible truck found — record pending event for manual dispatcher review
        const meta = {
          algorithm,
          decision: algorithmResult.message,
          isMultiTruck: false,
          capacityValidated: algorithmResult.capacityValidated,
          capacityValidationNote: algorithmResult.capacityValidationNote,
          evaluations: algorithmResult.evaluations,
          disposalSite: algorithmResult.disposalSite,
        };
        const pendingEvent: Partial<OverflowEventRecord> = {
          source_vehicle_id: normalizedVehicleId,
          source_driver_id: driverId,
          source_route_id: routeId,
          target_vehicle_id: null,
          target_driver_id: null,
          status: "pending",
          overflow_bins: attachMetaToOverflowBins(allOverflowBins, meta),
          bins_count: allOverflowBins.length,
          distance_km: null,
          reassignment_metadata: meta,
          created_at: nowIso,
        };
        await createOverflowEvent(pendingEvent);
        createdEvents.push(pendingEvent);
      }

      await updateVehicle(String(vehicleId), { status: "full", load_percent: 100 });

      const sourceDriver = driverById.get(String(driverId));
      const sourceVehicle = vehicleById.get(String(vehicleId));
      const route = routeById.get(String(routeId));

      await createNotification({
        role: "dispatcher" as const,
        title: "Truck Capacity Full (100%)",
        message: `${sourceVehicle?.label ?? `Truck ${vehicleId}`} (${sourceDriver?.name ?? "Driver"}) signaled FULL on ${route?.name ?? "route"}. ${algorithmResult.message}`,
        type: "warning",
        category: "truck",
        source_table: "overflow_events",
        read: false,
        created_at: new Date().toISOString(),
      });

      const primaryEvent = createdEvents[0];
      const primaryAssign: TruckStopAssignment | null = algorithmResult.assignments[0] ?? null;

      return {
        event: primaryEvent,
        events: createdEvents,
        assignments: algorithmResult.assignments,
        nearest: primaryAssign
          ? {
              vehicle: vehicleById.get(String(primaryAssign.vehicleId)) ?? ({ id: primaryAssign.vehicleId, label: primaryAssign.label } as any),
              driver: primaryAssign.driverId
                ? driverById.get(String(primaryAssign.driverId)) ?? ({ id: primaryAssign.driverId, name: primaryAssign.driverName } as any)
                : ({ name: primaryAssign.driverName } as any),
              distanceKm: primaryAssign.distanceToStopsKm,
            }
          : null,
        algorithmResult,
      };
    },
    [
      bins,
      buildCandidateVehicles,
      createNotification,
      createOverflowEvent,
      deliveries,
      driverById,
      resolveDriverForVehicle,
      routeById,
      routeStops,
      updateVehicle,
      vehicleById,
    ],
  );

  /** Accept overflow dispatch atomically via RPC and sync assisting truck street route via Mapbox. */
  const acceptOverflow = useCallback(
    async (eventId: string) => {
      if (acceptingEventIdsRef.current.has(eventId)) return;
      const event = overflowEvents.find((e) => e.id === eventId);
      if (!event) return;

      if (event.status === "accepted") {
        console.warn("Overflow event is already accepted.");
        return;
      }

      const targetVehicleId = event.target_vehicle_id ? String(event.target_vehicle_id) : null;
      const resolvedTargetVehicle = targetVehicleId ? vehicleById.get(targetVehicleId) : null;
      const targetDriver =
        event.target_driver_id != null
          ? driverById.get(String(event.target_driver_id)) ?? null
          : resolvedTargetVehicle
            ? resolveDriverForVehicle(resolvedTargetVehicle)
            : null;
      const targetDriverId =
        event.target_driver_id != null
          ? String(event.target_driver_id)
          : targetDriver?.id != null
            ? String(targetDriver.id)
            : null;

      if (!targetDriverId) {
        throw new Error("Assign a relief truck with an active driver before accepting overflow.");
      }

      acceptingEventIdsRef.current.add(eventId);
      try {
        let rpcSucceeded = false;
        let shouldFallbackToClient = false;
        let targetRouteId: string | null = null;

        const { data: rpcResult, error: rpcError } = await supabase.rpc("accept_overflow_event", {
          p_event_id: eventId,
          p_target_driver_id: targetDriverId,
          p_target_vehicle_id: targetVehicleId,
        });

        if (!rpcError && (rpcResult as any)?.success) {
          rpcSucceeded = true;
          targetRouteId = (rpcResult as any).target_route_id ? String((rpcResult as any).target_route_id) : null;
        } else if (!rpcError && rpcResult && (rpcResult as any).success === false) {
          throw new Error(String((rpcResult as any).error || "Unable to accept overflow event."));
        } else if (rpcError) {
          if (isMissingRpcError(rpcError)) {
            shouldFallbackToClient = true;
            console.warn("RPC accept_overflow_event fallback:", rpcError.message);
          } else {
            throw new Error(rpcError.message || "Unable to accept overflow event.");
          }
        } else {
          shouldFallbackToClient = true;
        }

        // Coordinated client-side fallback ONLY if RPC is not deployed
        if (!rpcSucceeded && shouldFallbackToClient) {
          const now = new Date().toISOString();

          const { data: activeRoutes } = await supabase
            .from("routes")
            .select("id")
            .eq("driver_id", targetDriverId)
            .in("status", ["active", "pending", "planned"])
            .order("created_at", { ascending: false })
            .limit(1);

          if (activeRoutes && activeRoutes.length > 0) {
            targetRouteId = String(activeRoutes[0].id);
          } else {
            const { data: newRoute, error: newRouteErr } = await supabase
              .from("routes")
              .insert({
                name: "Overflow Assistance Route",
                status: "active",
                driver_id: targetDriverId,
                vehicle_id: targetVehicleId,
                generated_at: now,
                assignment_updated_at: now,
                started_at: now,
              })
              .select("id")
              .single();
            if (newRouteErr) throw newRouteErr;
            if (newRoute) {
              targetRouteId = String(newRoute.id);
            }
          }

          const binIds = (event.overflow_bins ?? []).map((b) => b.bin_id).filter(Boolean);
          if (binIds.length > 0 && targetRouteId) {
            let deliveryUpdateQuery = supabase
              .from("deliveries")
              .update({
                driver_id: targetDriverId,
                route_id: targetRouteId,
                status: "assigned",
                updated_at: now,
              })
              .in("bin_id", binIds);
            if (event.source_route_id) {
              deliveryUpdateQuery = deliveryUpdateQuery.eq("route_id", event.source_route_id);
            } else {
              deliveryUpdateQuery = deliveryUpdateQuery.in("status", ["overflow_uncollected", "pending", "assigned"]);
            }
            const { data: updatedRows, error: delivErr } = await deliveryUpdateQuery.select("bin_id");
            if (delivErr) {
              if (String(delivErr.code ?? "") === "23505") {
                const { error: upsertErr } = await supabase.from("deliveries").upsert(
                  binIds.map((binId) => ({
                    route_id: targetRouteId,
                    bin_id: binId,
                    driver_id: targetDriverId,
                    status: "assigned",
                    updated_at: now,
                  })),
                  { onConflict: "route_id,bin_id" },
                );
                if (upsertErr) throw upsertErr;
              } else {
                throw delivErr;
              }
            } else {
              const updatedSet = new Set((updatedRows ?? []).map((r: any) => String(r.bin_id)));
              const missingBinIds = binIds.filter((bid) => !updatedSet.has(String(bid)));
              if (missingBinIds.length > 0) {
                const { error: upsertMissingErr } = await supabase.from("deliveries").upsert(
                  missingBinIds.map((binId) => ({
                    route_id: targetRouteId,
                    bin_id: binId,
                    driver_id: targetDriverId,
                    status: "assigned",
                    updated_at: now,
                  })),
                  { onConflict: "route_id,bin_id" },
                );
                if (upsertMissingErr) throw upsertMissingErr;
              }
            }

            const { data: existingStops } = await supabase
              .from("route_stops")
              .select("bin_id, stop_order")
              .eq("route_id", targetRouteId);

            const existingBinSet = new Set((existingStops ?? []).map((s: any) => String(s.bin_id)));
            const maxOrder = (existingStops ?? []).reduce((max, s) => Math.max(max, Number(s.stop_order) || 0), 0);
            const newRouteStops = (event.overflow_bins ?? [])
              .filter((b) => b?.bin_id != null && !existingBinSet.has(String(b.bin_id)))
              .map((b, idx) => ({
                route_id: targetRouteId,
                bin_id: b.bin_id,
                stop_order: maxOrder + idx + 1,
              }));

            if (newRouteStops.length > 0) {
              await supabase.from("route_stops").insert(newRouteStops);
            }

            if (event.source_route_id) {
              await supabase
                .from("route_stops")
                .delete()
                .eq("route_id", event.source_route_id)
                .in("bin_id", binIds);
            }
          }

          await updateOverflowEvent(eventId, {
            status: "accepted",
            accepted_at: now,
            target_driver_id: targetDriverId,
            target_vehicle_id: targetVehicleId,
          });
        }

        // Recalculate assisting truck street route including configured SWMO Landfill via Mapbox Directions
        if (targetRouteId) {
          try {
            await syncAssistingRouteWithMapbox(
              targetRouteId,
              targetVehicleId,
              targetDriverId,
              event.overflow_bins ?? [],
            );
          } catch (routeSyncErr) {
            console.warn("Mapbox route sync note:", routeSyncErr);
          }
        }

        await refreshLiveProgress();

        const targetVehicle = targetVehicleId ? vehicleById.get(targetVehicleId) : null;
        await createNotification({
          role: "dispatcher" as const,
          title: "Overflow Accepted",
          message: `${targetDriver?.name ?? "Driver"} (${targetVehicle?.label ?? "Truck"}) ACCEPTED overflow dispatch of ${event.bins_count} bins.`,
          type: "success",
          category: "truck",
          source_table: "overflow_events",
          source_id: eventId,
          read: false,
          created_at: new Date().toISOString(),
        });
      } finally {
        acceptingEventIdsRef.current.delete(eventId);
      }
    },
    [
      createNotification,
      driverById,
      overflowEvents,
      refreshLiveProgress,
      resolveDriverForVehicle,
      syncAssistingRouteWithMapbox,
      updateOverflowEvent,
      vehicleById,
    ],
  );

  /** Decline overflow dispatch. */
  const declineOverflow = useCallback(
    async (eventId: string) => {
      await updateOverflowEvent(eventId, { status: "declined" });

      const event = overflowEvents.find((e) => e.id === eventId);
      if (event) {
        const targetDriver = event.target_driver_id ? driverById.get(String(event.target_driver_id)) : null;
        await createNotification({
          role: "dispatcher" as const,
          title: "Overflow Declined",
          message: `${targetDriver?.name ?? "Driver"} declined overflow dispatch of ${event.bins_count} bins. Reassignment needed.`,
          type: "warning",
          category: "truck",
          source_table: "overflow_events",
          source_id: eventId,
          read: false,
          created_at: new Date().toISOString(),
        });
      }
    },
    [createNotification, driverById, overflowEvents, updateOverflowEvent],
  );

  /** Complete overflow event. */
  const completeOverflow = useCallback(
    async (eventId: string) => {
      await updateOverflowEvent(eventId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
    },
    [updateOverflowEvent],
  );

  /**
   * Reassign a pending/declined overflow event:
   * - If `targetVehicleId` is omitted or `"AUTO"`, runs Custom Dynamic Reassignment Engine (supporting multi-truck split).
   * - If a specific `targetVehicleId` is selected, validates eligibility (online/fresh GPS, active driver, not busy) and capacity first.
   */
  const reassignOverflow = useCallback(
    async (eventId: string, targetVehicleId?: string) => {
      const event = overflowEvents.find((e) => e.id === eventId);
      if (!event) throw new Error("Overflow event not found.");
      if (event.status === "accepted" || event.status === "completed") {
        throw new Error(`Cannot reassign an overflow event that is already ${event.status}.`);
      }

      const eventBins = event.overflow_bins ?? [];
      if (eventBins.length === 0) {
        throw new Error("Overflow event has no remaining uncollected stops.");
      }

      const algoStops: UncollectedStop[] = eventBins.map((ob, idx) => {
        const linkedBin = bins.find((b) => String(b.id) === String(ob.bin_id));
        return {
          id: `stop-${ob.bin_id}`,
          binId: ob.bin_id,
          coordinate: {
            lat: finiteNumber(ob.lat ?? linkedBin?.latitude) ?? 0,
            lng: finiteNumber(ob.lng ?? linkedBin?.longitude) ?? 0,
          },
          stopOrder: ob.stop_order ?? idx + 1,
          location: ob.location || linkedBin?.location || "Collection Stop",
          capacityPercent: ob.capacity_percent ?? linkedBin?.capacity_percent ?? null,
        };
      });

      const sourceVehicleId = event.source_vehicle_id != null ? String(event.source_vehicle_id) : "";
      const candidates = buildCandidateVehicles(sourceVehicleId, eventId);
      const landfill = getConfiguredLandfill();
      const disposalSite = {
        name: landfill.name || SWMO_LANDFILL_DISPOSAL_SITE.name,
        coordinate: { lat: landfill.lat, lng: landfill.lng },
      };

      const isAuto = !targetVehicleId || targetVehicleId === "AUTO";
      const scopedCandidates = isAuto
        ? candidates
        : candidates.filter((c) => c.id === String(targetVehicleId));

      if (!isAuto && scopedCandidates.length === 0) {
        if (String(targetVehicleId) === sourceVehicleId) {
          throw new Error("Relief truck must be different from the full truck.");
        }
        throw new Error("Selected relief truck was not found.");
      }

      if (!isAuto) {
        const elig = evaluateCandidateEligibility(scopedCandidates[0]);
        if (!elig.eligible) {
          throw new Error(`Cannot assign ${scopedCandidates[0].label}: ${elig.reason}`);
        }
      }

      const algoRes = evaluateMultiCriteriaReassignment(scopedCandidates, algoStops, disposalSite);
      if (algoRes.assignments.length === 0) {
        const evalEntry = algoRes.evaluations[0];
        throw new Error(
          evalEntry?.ineligibleReason ||
            algoRes.message ||
            "No eligible truck with sufficient remaining capacity was found.",
        );
      }

      if (!isAuto && algoRes.unassignedStops.length > 0) {
        const assignedCount = algoRes.assignments[0]?.stopsCount ?? 0;
        throw new Error(
          `${scopedCandidates[0].label} only has capacity for ${assignedCount} of ${algoStops.length} stops (${algoRes.assignments[0]?.remainingCapacityPercent ?? 0}% remaining). Use Auto-Assign Optimal to distribute across multiple trucks.`,
        );
      }

      const primary = algoRes.assignments[0];
      const primaryVeh = vehicleById.get(String(primary.vehicleId));
      const primaryDriver = primaryVeh ? resolveDriverForVehicle(primaryVeh) : null;
      const primaryDriverId = primaryDriver?.id ?? primary.driverId;

      if (!primaryDriverId) {
        throw new Error(`Selected truck ${primary.label} has no active driver assigned.`);
      }

      const primaryBins = toOverflowBinEntries(primary.assignedStops);
      const primaryMeta = {
        algorithm: "multi-criteria",
        decision: algoRes.message,
        isMultiTruck: algoRes.isMultiTruck,
        splitIndex: 1,
        splitCount: algoRes.assignments.length,
        processingTimeMs: algoRes.processingTimeMs,
        additionalDistanceKm: primary.additionalDistanceKm,
        totalAdditionalDistanceKm: algoRes.totalAdditionalDistanceKm,
        projectedLoadPercent: primary.projectedLoadPercent,
        limitingFactor: primary.limitingFactor,
        capacityValidated: algoRes.capacityValidated,
        capacityValidationNote: algoRes.capacityValidationNote,
        evaluations: algoRes.evaluations,
        disposalSite: algoRes.disposalSite,
      };

      await updateOverflowEvent(eventId, {
        target_vehicle_id: String(primary.vehicleId),
        target_driver_id: String(primaryDriverId),
        status: "dispatched",
        overflow_bins: attachMetaToOverflowBins(primaryBins, primaryMeta),
        bins_count: primaryBins.length,
        distance_km: primary.distanceToStopsKm,
        reassignment_metadata: primaryMeta,
      });

      // Create follow-up dispatched events for additional trucks in a multi-truck split
      const nowIso = new Date().toISOString();
      for (let idx = 1; idx < algoRes.assignments.length; idx++) {
        const extra = algoRes.assignments[idx];
        const extraVeh = vehicleById.get(String(extra.vehicleId));
        const extraDriver = extraVeh ? resolveDriverForVehicle(extraVeh) : null;
        const extraDriverId = extraDriver?.id ?? extra.driverId;
        const extraBins = toOverflowBinEntries(extra.assignedStops);
        const extraMeta = {
          ...primaryMeta,
          splitIndex: idx + 1,
          additionalDistanceKm: extra.additionalDistanceKm,
          projectedLoadPercent: extra.projectedLoadPercent,
          limitingFactor: extra.limitingFactor,
        };
        await createOverflowEvent({
          source_vehicle_id: event.source_vehicle_id,
          source_driver_id: event.source_driver_id,
          source_route_id: event.source_route_id,
          target_vehicle_id: String(extra.vehicleId),
          target_driver_id: extraDriverId ? String(extraDriverId) : null,
          status: extraDriverId ? "dispatched" : "pending",
          overflow_bins: attachMetaToOverflowBins(extraBins, extraMeta),
          bins_count: extraBins.length,
          distance_km: extra.distanceToStopsKm,
          reassignment_metadata: extraMeta,
          created_at: nowIso,
        });
      }

      if (algoRes.unassignedStops.length > 0) {
        const leftoverBins = toOverflowBinEntries(algoRes.unassignedStops);
        await createOverflowEvent({
          source_vehicle_id: event.source_vehicle_id,
          source_driver_id: event.source_driver_id,
          source_route_id: event.source_route_id,
          target_vehicle_id: null,
          target_driver_id: null,
          status: "pending",
          overflow_bins: leftoverBins,
          bins_count: leftoverBins.length,
          distance_km: null,
          created_at: nowIso,
        });
      }

      await createNotification({
        role: "dispatcher" as const,
        title: isAuto ? "Overflow Dynamically Reassigned" : "Overflow Relief Reassigned",
        message: algoRes.message,
        type: "info",
        category: "truck",
        source_table: "overflow_events",
        source_id: eventId,
        read: false,
        created_at: new Date().toISOString(),
      });

      return algoRes;
    },
    [
      bins,
      buildCandidateVehicles,
      createNotification,
      createOverflowEvent,
      overflowEvents,
      resolveDriverForVehicle,
      updateOverflowEvent,
      vehicleById,
    ],
  );

  /** Build today's overflow event log for the live operations feed. */
  const overflowLog = useMemo((): OverflowLogEntry[] => {
    const today = new Date();
    const entries: OverflowLogEntry[] = [];

    for (const event of overflowEvents) {
      if (
        !isSameLocalDay(event.created_at, today) &&
        !isSameLocalDay(event.accepted_at, today) &&
        !isSameLocalDay(event.completed_at, today)
      ) {
        continue;
      }

      const sourceVehicle = event.source_vehicle_id ? vehicleById.get(String(event.source_vehicle_id)) : null;
      const targetVehicle = event.target_vehicle_id ? vehicleById.get(String(event.target_vehicle_id)) : null;
      const targetDriver = event.target_driver_id ? driverById.get(String(event.target_driver_id)) : null;
      const route = event.source_route_id ? routeById.get(String(event.source_route_id)) : null;

      const time = new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      if (isSameLocalDay(event.created_at, today)) {
        entries.push({
          id: `${event.id}-signal`,
          timestamp: event.created_at,
          message: `${time} — ${sourceVehicle?.label ?? `Truck ${event.source_vehicle_id}`} signaled FULL at ${route?.name ?? "route"}.`,
          type: "signal",
        });

        if (event.target_vehicle_id && (event.status === "dispatched" || event.status === "accepted" || event.status === "completed")) {
          const dispatchIso = new Date(new Date(event.created_at).getTime() + 60_000).toISOString();
          const dispatchTime = new Date(dispatchIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const splitNote = event.reassignment_metadata?.isMultiTruck
            ? ` (Split ${event.reassignment_metadata.splitIndex ?? 1}/${event.reassignment_metadata.splitCount ?? 2})`
            : "";
          entries.push({
            id: `${event.id}-dispatch`,
            timestamp: dispatchIso,
            message: `${dispatchTime} — System routed ${event.bins_count} remaining bins${splitNote} to ${targetVehicle?.label ?? `Truck ${event.target_vehicle_id}`} (${event.distance_km ?? "?"} km away).`,
            type: "dispatch",
          });
        }

        if (event.status === "declined") {
          entries.push({
            id: `${event.id}-decline`,
            timestamp: event.created_at,
            message: `${time} — ${targetDriver?.name ?? "Driver"} DECLINED overflow dispatch.`,
            type: "decline",
          });
        }
      }

      if (event.status === "accepted" && event.accepted_at && isSameLocalDay(event.accepted_at, today)) {
        const acceptTime = new Date(event.accepted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        entries.push({
          id: `${event.id}-accept`,
          timestamp: event.accepted_at,
          message: `${acceptTime} — ${targetDriver?.name ?? "Driver"} ACCEPTED overflow dispatch.`,
          type: "accept",
        });
      }

      if (event.status === "completed" && event.completed_at && isSameLocalDay(event.completed_at, today)) {
        const completeTime = new Date(event.completed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        entries.push({
          id: `${event.id}-complete`,
          timestamp: event.completed_at,
          message: `${completeTime} — Overflow collection completed by ${targetDriver?.name ?? "Dispatcher"}.`,
          type: "complete",
        });
      }
    }

    return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [driverById, overflowEvents, routeById, vehicleById]);

  return {
    ...data,
    fleetStatusList,
    overflowLog,
    getVehicleOverflowStatus,
    getBinOverflowStatus,
    findNearestAvailableTruck,
    findMultiCriteriaOptimalTruck,
    buildCandidateVehicles,
    updateVehicleLoadPercent,
    signalTruckFull,
    acceptOverflow,
    declineOverflow,
    completeOverflow,
    reassignOverflow,
  };
}
