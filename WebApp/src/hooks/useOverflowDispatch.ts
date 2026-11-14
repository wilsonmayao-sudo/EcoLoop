import { useCallback, useMemo } from "react";
import {
  useLiveData,
  isBinActive,
  normalizeStatus,
  type BinRecord,
  type DeliveryRecord,
  type DriverRecord,
  type OverflowBinEntry,
  type OverflowEventRecord,
  type RouteRecord,
  type RouteStopRecord,
  type VehicleRecord,
  type VehicleLocationRecord,
} from "./useLiveData";
import { haversineMeters } from "../utils/routing/geo";
import { getConfiguredLandfill } from "../utils/systemSettings";
import { supabase } from "../services/supabaseClient";
import {
  evaluateMultiCriteriaReassignment,
  evaluateNearestTruckBaseline,
  SWMO_LANDFILL_DISPOSAL_SITE,
  type CandidateVehicle,
  type UncollectedStop,
  type CandidateEvaluation,
  type ReassignmentResult,
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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function latestVehicleLocation(vehicleId: string | number, locations: VehicleLocationRecord[]) {
  return locations.find((loc) => String(loc.vehicle_id) === String(vehicleId)) ?? null;
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

export function useOverflowDispatch() {
  const data = useLiveData();
  const {
    vehicles,
    drivers,
    routes,
    routeStops,
    deliveries,
    overflowEvents,
    vehicleLocations,
    bins,
    driverById,
    routeById,
    vehicleById,
    createOverflowEvent,
    updateOverflowEvent,
    updateVehicle,
    createNotification,
    createNotifications,
  } = data;

  /** Map driver → vehicle */
  const vehicleByDriverId = useMemo(
    () =>
      new Map(
        drivers
          .filter((d) => d.assigned_vehicle_id != null)
          .map((d) => [String(d.id), vehicles.find((v) => String(v.id) === String(d.assigned_vehicle_id)) ?? null])
          .filter((entry): entry is [string, VehicleRecord] => entry[1] != null),
      ),
    [drivers, vehicles],
  );

  /** Determine the overflow status badge for a vehicle. */
  const getVehicleOverflowStatus = useCallback(
    (vehicleId: string | number): FleetOverflowStatus => {
      const vid = String(vehicleId);
      const vehicle = vehicleById.get(vid);
      if (!vehicle) return "IDLE";

      // Check if this vehicle signaled FULL
      const asFull = overflowEvents.find(
        (e) => String(e.source_vehicle_id) === vid && (e.status === "pending" || e.status === "dispatched"),
      );
      if (asFull) return "FULL";

      // Check if this vehicle is assisting overflow
      const asAssist = overflowEvents.find(
        (e) => String(e.target_vehicle_id) === vid && e.status === "accepted",
      );
      if (asAssist) return "ASSISTING_OVERFLOW";

      // Check if vehicle is on an active route
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
      const driver = vehicle.driver_id ? driverById.get(String(vehicle.driver_id)) ?? null : null;
      const route = vehicle.route_id ? routeById.get(String(vehicle.route_id)) ?? null : null;
      const overflowStatus = getVehicleOverflowStatus(vehicle.id);

      // Use driver-reported capacity if set; fallback to delivery calculation
      let loadPercent = typeof vehicle.load_percent === "number" && vehicle.load_percent >= 0 ? vehicle.load_percent : 0;
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
  }, [vehicles, driverById, routeById, deliveries, getVehicleOverflowStatus]);

  /** Determine bin display status for the overflow map. */
  const getBinOverflowStatus = useCallback(
    (binId: string | number): BinOverflowStatus => {
      const bid = String(binId);
      // Check if this bin is in an active overflow transfer
      const inOverflow = overflowEvents.find(
        (e) =>
          (e.status === "dispatched" || e.status === "accepted" || e.status === "pending") &&
          e.overflow_bins?.some((ob) => String(ob.bin_id) === bid),
      );
      if (inOverflow) return "OVERFLOW_TRANSFER";

      // Check if collected via deliveries
      const delivery = deliveries.find((d) => String(d.bin_id) === bid && normalizeStatus(d.status) === "completed");
      if (delivery) return "COLLECTED";

      return "ACTIVE_QUEUE";
    },
    [overflowEvents, deliveries],
  );

  /** Construct candidate vehicle representation for reassignment algorithms. */
  const buildCandidateVehicles = useCallback(
    (sourceVehicleId: string | number): CandidateVehicle[] => {
      return vehicles
        .filter((v) => v.is_active !== false && String(v.id) !== String(sourceVehicleId))
        .map((v) => {
          const loc = latestVehicleLocation(v.id, vehicleLocations);
          const lat = finiteNumber(loc?.latitude ?? v.latitude) ?? 13.6218;
          const lng = finiteNumber(loc?.longitude ?? v.longitude) ?? 123.1948;
          const driver = v.driver_id ? driverById.get(String(v.driver_id)) ?? null : null;
          const load = typeof v.load_percent === "number" && v.load_percent >= 0 ? v.load_percent : 0;

          const stopsOnRoute = v.route_id
            ? routeStops
                .filter((s) => String(s.route_id) === String(v.route_id))
                .map((s) => {
                  const bin = s.bins ?? bins.find((b) => String(b.id) === String(s.bin_id));
                  return { lat: Number(bin?.latitude ?? 0), lng: Number(bin?.longitude ?? 0) };
                })
                .filter((c) => c.lat !== 0 && c.lng !== 0)
            : [];

          return {
            id: String(v.id),
            label: v.label,
            driverId: v.driver_id ? String(v.driver_id) : null,
            driverName: driver?.name ?? "Assigned Driver",
            currentLocation: { lat, lng },
            currentLoadPercent: load,
            status: v.status,
            activeStops: stopsOnRoute,
          };
        });
    },
    [bins, driverById, routeStops, vehicleLocations, vehicles],
  );

  /** Baseline: Nearest active truck with remaining capacity. */
  const findNearestAvailableTruck = useCallback(
    (sourceVehicleId: string | number): { vehicle: VehicleRecord; driver: DriverRecord; distanceKm: number } | null => {
      const sourceVehicle = vehicleById.get(String(sourceVehicleId));
      if (!sourceVehicle) return null;

      const sourceLoc = latestVehicleLocation(sourceVehicle.id, vehicleLocations);
      const sourceLat = finiteNumber(sourceLoc?.latitude ?? sourceVehicle.latitude);
      const sourceLng = finiteNumber(sourceLoc?.longitude ?? sourceVehicle.longitude);
      if (sourceLat == null || sourceLng == null) return null;

      let best: { vehicle: VehicleRecord; driver: DriverRecord; distanceKm: number } | null = null;

      for (const vehicle of vehicles) {
        if (vehicle.is_active === false || String(vehicle.id) === String(sourceVehicleId)) continue;
        const vStatus = normalizeStatus(vehicle.status);
        if (!["active", "available", "on_route"].includes(vStatus)) continue;

        // Skip if already FULL or assisting
        const oStatus = getVehicleOverflowStatus(vehicle.id);
        if (oStatus === "FULL" || oStatus === "ASSISTING_OVERFLOW") continue;

        const driver = vehicle.driver_id ? driverById.get(String(vehicle.driver_id)) ?? null : null;
        if (!driver) continue;

        const loc = latestVehicleLocation(vehicle.id, vehicleLocations);
        const lat = finiteNumber(loc?.latitude ?? vehicle.latitude);
        const lng = finiteNumber(loc?.longitude ?? vehicle.longitude);
        if (lat == null || lng == null) continue;

        const distM = haversineMeters({ lat: sourceLat, lng: sourceLng }, { lat, lng });
        const distKm = distM / 1000;

        if (!best || distKm < best.distanceKm) {
          best = { vehicle, driver, distanceKm: Math.round(distKm * 10) / 10 };
        }
      }

      return best;
    },
    [driverById, getVehicleOverflowStatus, vehicleById, vehicleLocations, vehicles],
  );

  /** Proposed: Multi-Criteria Dynamic Reassignment Algorithm. */
  const findMultiCriteriaOptimalTruck = useCallback(
    (sourceVehicleId: string | number, uncollectedStops: UncollectedStop[]): ReassignmentResult => {
      const candidates = buildCandidateVehicles(sourceVehicleId);
      const landfill = getConfiguredLandfill();
      const disposalSite = {
        ...SWMO_LANDFILL_DISPOSAL_SITE,
        name: landfill.name,
        lat: landfill.lat,
        lng: landfill.lng,
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
        await supabase.from("vehicles").update({ load_percent: clamped }).eq("id", vehicleId);
      } catch (err) {
        console.warn("updateVehicleLoadPercent note:", err);
      }
    },
    [],
  );

  /** Signal truck full: runs dynamic reassignment algorithm, records decision matrix, alerts fleet. */
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

      // Gather uncollected bins on this route
      const stops = routeStops.filter((s) => String(s.route_id) === String(routeId));
      const completedBinIds = new Set(
        deliveries
          .filter((d) => String(d.route_id) === String(routeId) && normalizeStatus(d.status) === "completed")
          .map((d) => String(d.bin_id)),
      );

      const uncollectedStops = stops.filter((s) => {
        if (completedBinIds.has(String(s.bin_id))) return false;
        const bin = s.bins ?? bins.find((b) => String(b.id) === String(s.bin_id));
        return bin ? isBinActive(bin) : true;
      });
      const overflowBins: OverflowBinEntry[] = uncollectedStops.map((stop) => {
        const bin = stop.bins ?? bins.find((b) => String(b.id) === String(stop.bin_id));
        return {
          bin_id: stop.bin_id,
          stop_order: stop.stop_order,
          lat: Number(bin?.latitude ?? 0),
          lng: Number(bin?.longitude ?? 0),
          location: bin?.location ?? "Unknown",
        };
      });

      if (overflowBins.length === 0) return null;

      // Transform to algorithm stop interface
      const algoStops: UncollectedStop[] = overflowBins.map((ob, idx) => ({
        id: `stop-${ob.bin_id}`,
        binId: ob.bin_id,
        coordinate: { lat: ob.lat, lng: ob.lng },
        stopOrder: ob.stop_order ?? idx + 1,
        location: ob.location,
      }));

      // Run dynamic reassignment algorithm
      let targetVehicleId: string | number | null = null;
      let targetDriverId: string | number | null = null;
      let distanceKm: number | null = null;
      let reassignmentMeta: Record<string, any> = {};
      let algorithmResult: ReassignmentResult | null = null;

      if (algorithm === "multi-criteria") {
        algorithmResult = findMultiCriteriaOptimalTruck(vehicleId, algoStops);
        const sel = algorithmResult.selectedCandidate;
        if (sel) {
          targetVehicleId = sel.vehicleId;
          const candVehicle = vehicleById.get(String(sel.vehicleId));
          targetDriverId = candVehicle?.driver_id ?? null;
          distanceKm = sel.distanceToStopsKm;
        }
        reassignmentMeta = {
          algorithm: "multi-criteria",
          decision: algorithmResult.message,
          processingTimeMs: algorithmResult.processingTimeMs,
          additionalDistanceKm: algorithmResult.estimatedAdditionalDistanceKm,
          evaluations: algorithmResult.evaluations,
          disposalSite: algorithmResult.disposalSite,
        };
      } else {
        const nearest = findNearestAvailableTruck(vehicleId);
        if (nearest) {
          targetVehicleId = nearest.vehicle.id;
          targetDriverId = nearest.driver.id;
          distanceKm = nearest.distanceKm;
        }
        reassignmentMeta = {
          algorithm: "nearest-baseline",
          decision: nearest ? `Nearest truck ${nearest.vehicle.label}` : "None found",
          distanceKm,
        };
      }

      const event: Partial<OverflowEventRecord> = {
        source_vehicle_id: normalizedVehicleId,
        source_driver_id: driverId,
        source_route_id: routeId,
        target_vehicle_id: targetVehicleId,
        target_driver_id: targetDriverId,
        status: targetDriverId ? "dispatched" : "pending",
        overflow_bins: overflowBins,
        bins_count: overflowBins.length,
        distance_km: distanceKm,
        reassignment_metadata: reassignmentMeta,
        created_at: new Date().toISOString(),
      };

      await createOverflowEvent(event);

      // Update source vehicle status to full & 100% capacity
      await updateVehicle(String(vehicleId), { status: "full", load_percent: 100 });

      // Create notifications
      const sourceDriver = driverById.get(String(driverId));
      const sourceVehicle = vehicleById.get(String(vehicleId));
      const route = routeById.get(String(routeId));
      const targetVehicle = targetVehicleId ? vehicleById.get(String(targetVehicleId)) : null;

      const adminNotification = {
        role: "dispatcher" as const,
        title: "Truck Capacity Full (100%)",
        message: `${sourceVehicle?.label ?? `Truck ${vehicleId}`} (${sourceDriver?.name ?? "Driver"}) signaled FULL on ${route?.name ?? "route"}. ${overflowBins.length} bins dynamically reallocated.`,
        type: "warning",
        category: "truck",
        source_table: "overflow_events",
        read: false,
        created_at: new Date().toISOString(),
      };

      await createNotification(adminNotification);

      if (targetVehicle) {
        await createNotification({
          role: "dispatcher" as const,
          title: "Overflow Reassignment Dispatched",
          message: `Assigned ${overflowBins.length} remaining bin${overflowBins.length === 1 ? "" : "s"} to ${targetVehicle.label} using ${algorithm === "multi-criteria" ? "Optimal Route & Capacity" : "Nearest Available Truck"}.`,
          type: "info",
          category: "truck",
          source_table: "overflow_events",
          read: false,
          created_at: new Date().toISOString(),
        });
      }

      return {
        event,
        nearest: targetVehicleId
          ? {
              vehicle: targetVehicle ?? ({ id: targetVehicleId, label: `Truck ${targetVehicleId}` } as any),
              driver: targetDriverId ? driverById.get(String(targetDriverId)) ?? ({ id: targetDriverId, name: "Driver" } as any) : ({} as any),
              distanceKm: distanceKm ?? 0,
            }
          : null,
        algorithmResult,
      };
    },
    [
      bins,
      createNotification,
      createOverflowEvent,
      deliveries,
      driverById,
      findMultiCriteriaOptimalTruck,
      findNearestAvailableTruck,
      routeById,
      routeStops,
      updateVehicle,
      vehicleById,
    ],
  );

  /** Accept overflow dispatch. */
  const acceptOverflow = useCallback(
    async (eventId: string) => {
      const event = overflowEvents.find((e) => e.id === eventId);
      if (!event) return;

      if (event.status === "accepted") {
        console.warn("Overflow event is already accepted.");
        return;
      }

      const targetVehicleId = event.target_vehicle_id ? String(event.target_vehicle_id) : null;
      const resolvedTargetVehicle = targetVehicleId ? vehicleById.get(targetVehicleId) : null;
      const targetDriverId = event.target_driver_id
        ? String(event.target_driver_id)
        : resolvedTargetVehicle?.driver_id
          ? String(resolvedTargetVehicle.driver_id)
          : null;

      if (!targetDriverId) {
        throw new Error("Assign a relief truck with an active driver before accepting overflow.");
      }

      // 1. Try transactional RPC function first
      let rpcSucceeded = false;
      let shouldFallbackToClient = false;
      const { data: rpcResult, error: rpcError } = await supabase.rpc("accept_overflow_event", {
        p_event_id: eventId,
        p_target_driver_id: targetDriverId,
        p_target_vehicle_id: targetVehicleId,
      });

      if (!rpcError && (rpcResult as any)?.success) {
        rpcSucceeded = true;
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

      // 2. Coordinated client-side execution only if RPC is unavailable
      if (!rpcSucceeded && shouldFallbackToClient) {
        const now = new Date().toISOString();
        let targetRouteId: string | null = null;

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

      const targetVehicle = targetVehicleId ? vehicleById.get(targetVehicleId) : null;
      const targetDriver = driverById.get(targetDriverId) ?? null;

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
    },
    [createNotification, driverById, overflowEvents, updateOverflowEvent, vehicleById],
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
          message: `${targetDriver?.name ?? "Driver"} declined overflow dispatch of ${event.bins_count} bins. Manual reassignment needed.`,
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

  /** Manually assign or reassign a pending/declined overflow event to another relief truck. */
  const reassignOverflow = useCallback(
    async (eventId: string, targetVehicleId: string) => {
      const event = overflowEvents.find((e) => e.id === eventId);
      if (!event) throw new Error("Overflow event not found.");
      const targetVehicle = vehicleById.get(String(targetVehicleId));
      if (!targetVehicle) throw new Error("Selected relief truck was not found.");
      if (String(targetVehicle.id) === String(event.source_vehicle_id)) {
        throw new Error("Relief truck must be different from the full truck.");
      }

      const targetLoc = latestVehicleLocation(targetVehicle.id, vehicleLocations);
      const targetLat = finiteNumber(targetLoc?.latitude ?? targetVehicle.latitude);
      const targetLng = finiteNumber(targetLoc?.longitude ?? targetVehicle.longitude);
      const firstBin = (event.overflow_bins ?? []).find((b) => finiteNumber(b.lat) != null && finiteNumber(b.lng) != null);
      const sourceVehicle = event.source_vehicle_id != null ? vehicleById.get(String(event.source_vehicle_id)) : null;
      const sourceLoc = sourceVehicle ? latestVehicleLocation(sourceVehicle.id, vehicleLocations) : null;
      const refLat = finiteNumber(firstBin?.lat ?? sourceLoc?.latitude ?? sourceVehicle?.latitude);
      const refLng = finiteNumber(firstBin?.lng ?? sourceLoc?.longitude ?? sourceVehicle?.longitude);

      const distanceKm =
        targetLat != null && targetLng != null && refLat != null && refLng != null
          ? Math.round((haversineMeters({ lat: targetLat, lng: targetLng }, { lat: refLat, lng: refLng }) / 1000) * 10) / 10
          : event.distance_km ?? null;

      await updateOverflowEvent(eventId, {
        target_vehicle_id: String(targetVehicle.id),
        target_driver_id: targetVehicle.driver_id != null ? String(targetVehicle.driver_id) : null,
        status: "dispatched",
        distance_km: distanceKm,
      });

      const targetDriver = targetVehicle.driver_id != null ? driverById.get(String(targetVehicle.driver_id)) : null;
      await createNotification({
        role: "dispatcher" as const,
        title: "Overflow Manually Reassigned",
        message: `Assigned ${event.bins_count} remaining bin${event.bins_count === 1 ? "" : "s"} to ${targetVehicle.label}${targetDriver ? ` (${targetDriver.name})` : ""}.`,
        type: "info",
        category: "truck",
        source_table: "overflow_events",
        source_id: eventId,
        read: false,
        created_at: new Date().toISOString(),
      });
    },
    [createNotification, driverById, overflowEvents, updateOverflowEvent, vehicleById, vehicleLocations],
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
          entries.push({
            id: `${event.id}-dispatch`,
            timestamp: dispatchIso,
            message: `${dispatchTime} — System routed ${event.bins_count} remaining bins to ${targetVehicle?.label ?? `Truck ${event.target_vehicle_id}`} (${event.distance_km ?? "?"} km away).`,
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
