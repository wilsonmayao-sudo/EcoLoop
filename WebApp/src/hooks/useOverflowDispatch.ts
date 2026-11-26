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

function isRpcNotDeployedError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  const msg = String(err.message ?? "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    (msg.includes("function") && msg.includes("does not exist"))
  );
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
  const dispatchingEventIdsRef = useRef<Set<string>>(new Set());
  const signalingRouteIdsRef = useRef<Set<string>>(new Set());

  const normalizeIdString = (value: unknown): string | null => {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
    return trimmed;
  };

  /** Resolve driver linked to a vehicle using vehicle.driver_id, drivers.assigned_vehicle_id, or open routes. */
  const resolveDriverForVehicle = useCallback(
    (vehicle: VehicleRecord): DriverRecord | null => {
      if (vehicle.driver_id != null) {
        const direct = driverById.get(String(vehicle.driver_id));
        if (direct) return direct;
      }
      const vidStr = String(vehicle.id);
      const candidates = drivers.filter(
        (d) => d.assigned_vehicle_id != null && String(d.assigned_vehicle_id) === vidStr,
      );
      if (candidates.length > 0) {
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
      }

      const openRouteStatuses = new Set(["active", "pending", "planned"]);
      const matchingRoutes = data.routes
        .filter(
          (r) =>
            openRouteStatuses.has(normalizeStatus(r.status)) &&
            r.driver_id != null &&
            ((r.vehicle_id != null && String(r.vehicle_id) === vidStr) ||
              (vehicle.route_id != null && String(r.id) === String(vehicle.route_id))),
        )
        .sort((a, b) => {
          const aActive = normalizeStatus(a.status) === "active" ? 0 : 1;
          const bActive = normalizeStatus(b.status) === "active" ? 0 : 1;
          return aActive - bActive;
        });

      for (const route of matchingRoutes) {
        const routeDriver = driverById.get(String(route.driver_id));
        if (routeDriver) return routeDriver;
      }
      return null;
    },
    [data.routes, driverById, drivers],
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

  /** Signal truck full: runs Custom Dynamic Reassignment Engine and persists atomically via RPC. */
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

      const routeKey = normalizeIdString(routeId) ?? normalizedVehicleId;
      if (signalingRouteIdsRef.current.has(routeKey)) {
        throw new Error("Overflow dispatch is already being submitted for this truck.");
      }
      signalingRouteIdsRef.current.add(routeKey);

      try {
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

        const sourceDriver = driverById.get(String(driverId));
        const sourceVehicle = vehicleById.get(String(vehicleId));
        const route = routeById.get(String(routeId));
        const sourceLabels = {
          source_vehicle_label: sourceVehicle?.label || sourceVehicle?.code || sourceVehicle?.truck_code || `Truck ${vehicleId}`,
          source_driver_name: sourceDriver?.name ?? "Driver",
          source_route_name: route?.name ?? null,
        };

        const nowIso = new Date().toISOString();
        const createdEvents: Partial<OverflowEventRecord>[] = [];
        const rpcAssignments: Array<Record<string, any>> = [];
        let pendingBinsPayload: OverflowBinEntry[] = [];
        let pendingMetaPayload: Record<string, any> = {};

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
            const targetDriverId = normalizeIdString(resolvedDriver?.id ?? assign.driverId);
            const targetVehicleId = normalizeIdString(assign.vehicleId);
            const subsetBins = toOverflowBinEntries(assign.assignedStops);

            const meta = {
              ...sourceLabels,
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
              source_driver_id: normalizeIdString(driverId),
              source_driver_auth_user_id: sourceDriver?.auth_user_id ?? null,
              source_route_id: normalizeIdString(routeId),
              target_vehicle_id: targetVehicleId,
              target_driver_id: targetDriverId,
              target_driver_auth_user_id: resolvedDriver?.auth_user_id ?? null,
              status: targetDriverId ? "dispatched" : "pending",
              overflow_bins: attachMetaToOverflowBins(subsetBins, meta),
              bins_count: subsetBins.length,
              distance_km: assign.distanceToStopsKm,
              reassignment_metadata: meta,
              dispatched_at: targetDriverId ? nowIso : null,
              created_at: nowIso,
            };
            createdEvents.push(eventPayload);
            rpcAssignments.push({
              target_vehicle_id: targetVehicleId,
              target_driver_id: targetDriverId,
              overflow_bins: eventPayload.overflow_bins,
              bins_count: subsetBins.length,
              distance_km: assign.distanceToStopsKm,
              reassignment_metadata: meta,
            });
          }

          if (algorithmResult.unassignedStops.length > 0) {
            const leftoverBins = toOverflowBinEntries(algorithmResult.unassignedStops);
            pendingMetaPayload = {
              ...sourceLabels,
              algorithm,
              decision: `Unassigned overflow remainder (${leftoverBins.length} stops exceed remaining fleet capacity)`,
              isMultiTruck: true,
              capacityValidated: algorithmResult.capacityValidated,
              capacityValidationNote: algorithmResult.capacityValidationNote,
              evaluations: algorithmResult.evaluations,
              disposalSite: algorithmResult.disposalSite,
            };
            pendingBinsPayload = attachMetaToOverflowBins(leftoverBins, pendingMetaPayload);
            createdEvents.push({
              source_vehicle_id: normalizedVehicleId,
              source_driver_id: normalizeIdString(driverId),
              source_route_id: normalizeIdString(routeId),
              target_vehicle_id: null,
              target_driver_id: null,
              status: "pending",
              overflow_bins: pendingBinsPayload,
              bins_count: leftoverBins.length,
              distance_km: null,
              reassignment_metadata: pendingMetaPayload,
              created_at: nowIso,
            });
          }
        } else {
          pendingMetaPayload = {
            ...sourceLabels,
            algorithm,
            decision: algorithmResult.message,
            isMultiTruck: false,
            capacityValidated: algorithmResult.capacityValidated,
            capacityValidationNote: algorithmResult.capacityValidationNote,
            evaluations: algorithmResult.evaluations,
            disposalSite: algorithmResult.disposalSite,
          };
          pendingBinsPayload = attachMetaToOverflowBins(allOverflowBins, pendingMetaPayload);
          createdEvents.push({
            source_vehicle_id: normalizedVehicleId,
            source_driver_id: normalizeIdString(driverId),
            source_route_id: normalizeIdString(routeId),
            target_vehicle_id: null,
            target_driver_id: null,
            status: "pending",
            overflow_bins: pendingBinsPayload,
            bins_count: allOverflowBins.length,
            distance_km: null,
            reassignment_metadata: pendingMetaPayload,
            created_at: nowIso,
          });
        }

        const { data: rpcResult, error: rpcError } = await supabase.rpc("create_overflow_dispatch", {
          p_source_vehicle_id: normalizedVehicleId,
          p_source_driver_id: normalizeIdString(driverId),
          p_source_route_id: normalizeIdString(routeId),
          p_assignments: rpcAssignments,
          p_pending_bins: pendingBinsPayload,
          p_pending_metadata: pendingMetaPayload,
          p_mark_deliveries_overflow: false,
        });

        if (!rpcError && rpcResult?.success === true) {
          await refreshLiveProgress();
        } else if (rpcError && isRpcNotDeployedError(rpcError)) {
          for (const ev of createdEvents) {
            await createOverflowEvent(ev);
            if (ev.status === "dispatched" && ev.target_driver_auth_user_id) {
              try {
                await createNotification({
                  user_auth_id: ev.target_driver_auth_user_id,
                  user_id: ev.target_driver_auth_user_id,
                  title: "Overflow Assistance Assigned",
                  message: `${sourceLabels.source_vehicle_label} requested assistance on ${sourceLabels.source_route_name ?? "route"} (${ev.bins_count} stop${ev.bins_count === 1 ? "" : "s"}).`,
                  type: "warning",
                  category: "assignment",
                  source_table: "overflow_events",
                  read: false,
                  created_at: nowIso,
                });
              } catch (notifErr) {
                console.warn("Assisting driver notification fallback note:", notifErr);
              }
            }
          }
          await updateVehicle(String(vehicleId), { status: "full", load_percent: 100 });
          await createNotification({
            role: "dispatcher" as const,
            title: "Truck Capacity Full (100%)",
            message: `${sourceLabels.source_vehicle_label} (${sourceLabels.source_driver_name}) signaled FULL on ${route?.name ?? "route"}. ${algorithmResult.message}`,
            type: "warning",
            category: "assignment",
            source_table: "overflow_events",
            read: false,
            created_at: new Date().toISOString(),
          });
        } else {
          throw new Error(
            String((rpcResult as any)?.error || rpcError?.message || "Unable to create overflow dispatch."),
          );
        }

        const primaryEvent = createdEvents[0];
        const primaryAssign: TruckStopAssignment | null = algorithmResult.assignments[0] ?? null;

        return {
          event: primaryEvent,
          events: createdEvents,
          assignments: algorithmResult.assignments,
          idempotent: Boolean((rpcResult as any)?.idempotent),
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
      } finally {
        signalingRouteIdsRef.current.delete(routeKey);
      }
    },
    [
      bins,
      buildCandidateVehicles,
      createNotification,
      createOverflowEvent,
      deliveries,
      driverById,
      refreshLiveProgress,
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
        let targetRouteId: string | null = null;

        const { data: rpcResult, error: rpcError } = await supabase.rpc("accept_overflow_event", {
          p_event_id: eventId,
          p_target_driver_id: targetDriverId,
          p_target_vehicle_id: targetVehicleId,
        });

        if (rpcError) {
          throw new Error(rpcError.message || "Unable to accept overflow event via transactional RPC.");
        }

        if (!rpcResult || (rpcResult as any).success !== true) {
          throw new Error(String((rpcResult as any)?.error || "Unable to accept overflow event."));
        }

        targetRouteId = (rpcResult as any).target_route_id
          ? String((rpcResult as any).target_route_id)
          : (rpcResult as any).route_id
            ? String((rpcResult as any).route_id)
            : null;

        if (!targetRouteId) {
          throw new Error("Overflow acceptance did not return a valid route ID.");
        }

        // Recalculate assisting truck street route including configured SWMO Landfill via Mapbox Directions
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

        await refreshLiveProgress();

        if ((rpcResult as any)?.dispatcher_notified !== true) {
          const targetVehicle = targetVehicleId ? vehicleById.get(targetVehicleId) : null;
          await createNotification({
            role: "dispatcher" as const,
            title: "Overflow Accepted",
            message: `${targetDriver?.name ?? "Driver"} (${targetVehicle?.label ?? "Truck"}) ACCEPTED overflow dispatch of ${event.bins_count} bins.`,
            type: "success",
            category: "assignment",
            source_table: "overflow_events",
            source_id: eventId,
            read: false,
            created_at: new Date().toISOString(),
          });
        }
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
      vehicleById,
    ],
  );

  /** Decline overflow dispatch atomically via RPC (with safe fallback). */
  const declineOverflow = useCallback(
    async (eventId: string) => {
      const { data: rpcResult, error: rpcError } = await supabase.rpc("decline_overflow_event", {
        p_event_id: eventId,
      });

      if (!rpcError && (rpcResult as any)?.success === true) {
        await refreshLiveProgress();
        return;
      }

      if (rpcError && !isRpcNotDeployedError(rpcError)) {
        throw new Error(rpcError.message || "Unable to decline overflow dispatch.");
      }
      if (rpcResult && (rpcResult as any).success === false) {
        throw new Error(String((rpcResult as any).error || "Unable to decline overflow dispatch."));
      }

      await updateOverflowEvent(eventId, { status: "declined" });

      const event = overflowEvents.find((e) => e.id === eventId);
      if (event) {
        const targetDriver = event.target_driver_id ? driverById.get(String(event.target_driver_id)) : null;
        await createNotification({
          role: "dispatcher" as const,
          title: "Overflow Declined",
          message: `${targetDriver?.name ?? "Driver"} declined overflow dispatch of ${event.bins_count} bins. Reassignment needed.`,
          type: "warning",
          category: "assignment",
          source_table: "overflow_events",
          source_id: eventId,
          read: false,
          created_at: new Date().toISOString(),
        });
      }
    },
    [createNotification, driverById, overflowEvents, refreshLiveProgress, updateOverflowEvent],
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
   * Reassign a pending/declined/dispatched overflow event atomically via `dispatch_overflow_event`:
   * - If `targetVehicleId` is omitted or `"AUTO"`, runs Custom Dynamic Reassignment Engine (supporting multi-truck split).
   * - If a specific `targetVehicleId` is selected, validates structural eligibility and capacity, allowing dispatch even when the assisting driver's app is closed.
   */
  const reassignOverflow = useCallback(
    async (eventId: string, targetVehicleId?: string) => {
      if (dispatchingEventIdsRef.current.has(eventId)) {
        throw new Error("This overflow dispatch is already being assigned.");
      }

      const event = overflowEvents.find((e) => e.id === eventId);
      if (!event) throw new Error("Overflow event not found.");
      if (event.status === "accepted" || event.status === "completed" || event.status === "cancelled") {
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

      let algoRes: ReassignmentResult;
      if (isAuto) {
        algoRes = evaluateMultiCriteriaReassignment(scopedCandidates, algoStops, disposalSite);
        if (algoRes.assignments.length === 0) {
          const evalEntry = algoRes.evaluations[0];
          throw new Error(
            evalEntry?.ineligibleReason ||
              algoRes.message ||
              "No eligible truck with sufficient remaining capacity was found.",
          );
        }
      } else {
        const selectedCand = scopedCandidates[0];
        if (selectedCand.isActive === false) {
          throw new Error(`Cannot assign ${selectedCand.label}: Vehicle is inactive`);
        }
        const vStatus = normalizeStatus(selectedCand.status);
        if (["full", "maintenance", "inactive", "out_of_service", "suspended", "assisting_overflow", "unloading"].includes(vStatus)) {
          throw new Error(`Cannot assign ${selectedCand.label}: Status is ${selectedCand.status}`);
        }
        if (selectedCand.hasActiveOverflowAssignment) {
          throw new Error(`Cannot assign ${selectedCand.label}: Already assisting another active overflow event`);
        }
        if (!selectedCand.driverId) {
          throw new Error(`Cannot assign ${selectedCand.label}: No assigned active driver`);
        }
        const dStatus = normalizeStatus(selectedCand.driverStatus);
        if (["inactive", "suspended", "full"].includes(dStatus)) {
          throw new Error(`Cannot assign ${selectedCand.label}: Assigned driver is ${selectedCand.driverStatus}`);
        }
        if (event.source_driver_id != null && String(event.source_driver_id) === String(selectedCand.driverId)) {
          throw new Error("Cannot assign the requesting driver to their own overflow event.");
        }

        // For manual dispatcher selection, allow assigning even if driver's app is closed (GPS stale/offline or load unverified)
        const manualCandidate: CandidateVehicle = {
          ...selectedCand,
          driverStatus: dStatus === "offline" ? "available" : selectedCand.driverStatus,
          status: vStatus === "offline" ? "available" : selectedCand.status,
          currentLocation: selectedCand.currentLocation ?? disposalSite.coordinate,
          currentLoadPercent:
            selectedCand.currentLoadPercent != null && selectedCand.loadSource !== "unverified"
              ? selectedCand.currentLoadPercent
              : 0,
          loadSource:
            selectedCand.loadSource && selectedCand.loadSource !== "unverified"
              ? selectedCand.loadSource
              : "route_progress_estimated",
          isGpsFresh: true,
        };

        algoRes = evaluateMultiCriteriaReassignment([manualCandidate], algoStops, disposalSite);
        if (algoRes.assignments.length === 0) {
          const evalEntry = algoRes.evaluations[0];
          throw new Error(
            evalEntry?.ineligibleReason ||
              algoRes.message ||
              "Selected relief truck does not have sufficient capacity.",
          );
        }
        if (algoRes.unassignedStops.length > 0) {
          const assignedCount = algoRes.assignments[0]?.stopsCount ?? 0;
          throw new Error(
            `${selectedCand.label} only has capacity for ${assignedCount} of ${algoStops.length} stops (${algoRes.assignments[0]?.remainingCapacityPercent ?? 0}% remaining). Use Auto-Assign Optimal to distribute across multiple trucks.`,
          );
        }
        if (!selectedCand.currentLocation) {
          algoRes = {
            ...algoRes,
            assignments: algoRes.assignments.map((a) => ({
              ...a,
              distanceToStopsKm: null as any,
              additionalDistanceKm: 0,
            })),
            message: `Manual dispatcher assignment to ${selectedCand.label} (${selectedCand.driverName}). Pending live GPS sync when driver opens app.`,
          };
        }
      }

      const primary = algoRes.assignments[0];
      const primaryVeh = vehicleById.get(String(primary.vehicleId));
      const primaryDriver = primaryVeh ? resolveDriverForVehicle(primaryVeh) : null;
      const primaryDriverId = normalizeIdString(primaryDriver?.id ?? primary.driverId);
      const primaryVehicleId = normalizeIdString(primary.vehicleId);

      if (!primaryDriverId || !primaryVehicleId) {
        throw new Error(`Selected truck ${primary.label} has no active driver assigned.`);
      }

      const sourceVeh = event.source_vehicle_id != null ? vehicleById.get(String(event.source_vehicle_id)) : null;
      const sourceDrv = event.source_driver_id != null ? driverById.get(String(event.source_driver_id)) : null;
      const sourceRoute = event.source_route_id != null ? routeById.get(String(event.source_route_id)) : null;
      const sourceLabels = {
        source_vehicle_label: sourceVeh?.label || sourceVeh?.code || sourceVeh?.truck_code || `Truck ${event.source_vehicle_id}`,
        source_driver_name: sourceDrv?.name ?? "Driver",
        source_route_name: sourceRoute?.name ?? null,
      };

      const primaryBins = toOverflowBinEntries(primary.assignedStops);
      const primaryMeta = {
        ...sourceLabels,
        algorithm: "multi-criteria",
        manualAssignment: !isAuto,
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

      const extraSplits: Array<Record<string, any>> = [];
      for (let idx = 1; idx < algoRes.assignments.length; idx++) {
        const extra = algoRes.assignments[idx];
        const extraVeh = vehicleById.get(String(extra.vehicleId));
        const extraDriver = extraVeh ? resolveDriverForVehicle(extraVeh) : null;
        const extraDriverId = normalizeIdString(extraDriver?.id ?? extra.driverId);
        const extraVehicleId = normalizeIdString(extra.vehicleId);
        const extraBins = toOverflowBinEntries(extra.assignedStops);
        const extraMeta = {
          ...primaryMeta,
          splitIndex: idx + 1,
          additionalDistanceKm: extra.additionalDistanceKm,
          projectedLoadPercent: extra.projectedLoadPercent,
          limitingFactor: extra.limitingFactor,
        };
        extraSplits.push({
          target_vehicle_id: extraVehicleId,
          target_driver_id: extraDriverId,
          overflow_bins: attachMetaToOverflowBins(extraBins, extraMeta),
          bins_count: extraBins.length,
          distance_km: extra.distanceToStopsKm,
          reassignment_metadata: extraMeta,
        });
      }

      if (algoRes.unassignedStops.length > 0) {
        const leftoverBins = toOverflowBinEntries(algoRes.unassignedStops);
        extraSplits.push({
          target_vehicle_id: null,
          target_driver_id: null,
          overflow_bins: leftoverBins,
          bins_count: leftoverBins.length,
          distance_km: null,
          reassignment_metadata: {
            ...sourceLabels,
            algorithm: "multi-criteria",
            decision: `Unassigned overflow remainder (${leftoverBins.length} stops)`,
          },
        });
      }

      dispatchingEventIdsRef.current.add(eventId);
      try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc("dispatch_overflow_event", {
          p_event_id: eventId,
          p_target_vehicle_id: primaryVehicleId,
          p_target_driver_id: primaryDriverId,
          p_overflow_bins: attachMetaToOverflowBins(primaryBins, primaryMeta),
          p_distance_km: primary.distanceToStopsKm ?? null,
          p_reassignment_metadata: primaryMeta,
          p_extra_splits: extraSplits,
        });

        if (!rpcError && rpcResult?.success === true) {
          await refreshLiveProgress();
          return {
            ...algoRes,
            driverNotified: Boolean((rpcResult as any).driver_notified),
            idempotent: Boolean((rpcResult as any).idempotent),
          };
        }

        if (rpcError && !isRpcNotDeployedError(rpcError)) {
          throw new Error(rpcError.message || "Unable to persist overflow assignment.");
        }
        if (rpcResult && (rpcResult as any).success === false) {
          throw new Error(String((rpcResult as any).error || "Unable to persist overflow assignment."));
        }

        // Safe fallback only when RPC migration is not yet applied
        const nowIso = new Date().toISOString();
        await updateOverflowEvent(eventId, {
          target_vehicle_id: primaryVehicleId,
          target_driver_id: primaryDriverId,
          target_driver_auth_user_id: primaryDriver?.auth_user_id ?? null,
          status: "dispatched",
          dispatched_at: nowIso,
          overflow_bins: attachMetaToOverflowBins(primaryBins, primaryMeta),
          bins_count: primaryBins.length,
          distance_km: primary.distanceToStopsKm ?? null,
          reassignment_metadata: primaryMeta,
        });

        let driverNotified = false;
        if (primaryDriver?.auth_user_id) {
          try {
            await createNotification({
              user_auth_id: primaryDriver.auth_user_id,
              user_id: primaryDriver.auth_user_id,
              title: "Overflow Assistance Assigned",
              message: `${sourceLabels.source_vehicle_label} requested assistance${sourceLabels.source_route_name ? ` on ${sourceLabels.source_route_name}` : ""} (${primaryBins.length} stop${primaryBins.length === 1 ? "" : "s"}).`,
              type: "warning",
              category: "assignment",
              source_table: "overflow_events",
              source_id: eventId,
              read: false,
              created_at: nowIso,
            });
            driverNotified = true;
            await updateOverflowEvent(eventId, { driver_notified_at: nowIso });
          } catch (notifErr) {
            console.warn("Driver notification fallback note:", notifErr);
          }
        }

        for (const split of extraSplits) {
          const splitDriver = split.target_driver_id ? driverById.get(String(split.target_driver_id)) : null;
          await createOverflowEvent({
            source_vehicle_id: event.source_vehicle_id,
            source_driver_id: event.source_driver_id,
            source_route_id: event.source_route_id,
            target_vehicle_id: split.target_vehicle_id,
            target_driver_id: split.target_driver_id,
            target_driver_auth_user_id: splitDriver?.auth_user_id ?? null,
            status: split.target_driver_id ? "dispatched" : "pending",
            overflow_bins: split.overflow_bins,
            bins_count: split.bins_count,
            distance_km: split.distance_km,
            reassignment_metadata: split.reassignment_metadata,
            dispatched_at: split.target_driver_id ? nowIso : null,
            created_at: nowIso,
          });
          if (splitDriver?.auth_user_id) {
            try {
              await createNotification({
                user_auth_id: splitDriver.auth_user_id,
                user_id: splitDriver.auth_user_id,
                title: "Overflow Assistance Assigned",
                message: `${sourceLabels.source_vehicle_label} requested assistance (${split.bins_count} stop${split.bins_count === 1 ? "" : "s"}).`,
                type: "warning",
                category: "assignment",
                source_table: "overflow_events",
                read: false,
                created_at: nowIso,
              });
            } catch {
              /* non-fatal */
            }
          }
        }

        await createNotification({
          role: "dispatcher" as const,
          title: isAuto ? "Overflow Dynamically Reassigned" : "Overflow Relief Reassigned",
          message: algoRes.message,
          type: "info",
          category: "assignment",
          source_table: "overflow_events",
          source_id: eventId,
          read: false,
          created_at: new Date().toISOString(),
        });

        return {
          ...algoRes,
          driverNotified,
          idempotent: false,
        };
      } finally {
        dispatchingEventIdsRef.current.delete(eventId);
      }
    },
    [
      bins,
      buildCandidateVehicles,
      createNotification,
      createOverflowEvent,
      driverById,
      overflowEvents,
      refreshLiveProgress,
      resolveDriverForVehicle,
      routeById,
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
          const dispatchIso = event.dispatched_at ?? new Date(new Date(event.created_at).getTime() + 60_000).toISOString();
          const dispatchTime = new Date(dispatchIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const splitNote = event.reassignment_metadata?.isMultiTruck
            ? ` (Split ${event.reassignment_metadata.splitIndex ?? 1}/${event.reassignment_metadata.splitCount ?? 2})`
            : "";
          entries.push({
            id: `${event.id}-dispatch`,
            timestamp: dispatchIso,
            message: `${dispatchTime} — ${event.driver_notified_at ? "Notified & routed" : "System routed"} ${event.bins_count} remaining bins${splitNote} to ${targetVehicle?.label ?? `Truck ${event.target_vehicle_id}`}${event.distance_km != null ? ` (${event.distance_km} km away)` : ""}.`,
            type: "dispatch",
          });
        }

        if (event.status === "declined") {
          const declineIso = event.declined_at ?? event.created_at;
          const declineTime = new Date(declineIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          entries.push({
            id: `${event.id}-decline`,
            timestamp: declineIso,
            message: `${declineTime} — ${targetDriver?.name ?? "Driver"} DECLINED overflow dispatch.`,
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
