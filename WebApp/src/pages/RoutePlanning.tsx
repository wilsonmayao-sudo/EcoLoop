import React, { useEffect, useMemo, useState } from "react";
import { Eye, MapPin, Plus, Trash2, WandSparkles, X } from "lucide-react";
import ConfirmModal from "../components/feedback/ConfirmModal";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import { formatDistanceKm, formatDurationMinutes } from "../utils/routing/geo";
import { optimizeMultiStopRouteAsync } from "../utils/routing/optimizeMultiStop";
import { clusterStopsByDepotSweep } from "../utils/routing/clusterStops";
import type { RouteStop } from "../utils/routing/types";
import TrafficRouteMapPreview from "../components/maps/TrafficRouteMapPreview";
import { isMapboxConfigured } from "../services/mapboxMatrix";
import { supabase } from "../services/supabaseClient";
import { formatDateOnly, getSetting, normalizeStatus, useLiveData } from "../hooks/useLiveData";

function labelRouteStatus(status: string) {
  const n = (status ?? "").toLowerCase();
  if (n === "planned" || n === "pending") return "Pending";
  if (n === "active") return "Active";
  if (n === "completed") return "Completed";
  return status;
}

function routeStatusBadgeClass(status: string) {
  const n = (status ?? "").toLowerCase();
  if (n === "active") return "bg-green-100 text-green-700";
  if (n === "completed") return "bg-gray-100 text-gray-700";
  if (n === "planned" || n === "pending") return "bg-blue-100 text-blue-700";
  return "bg-gray-100 text-gray-700";
}

function labelOptimizationSource(route: Route) {
  if (route.costSource === "mapbox-traffic" || route.optimizationUsedTraffic) return "Hybrid traffic";
  if (route.optimizationMethod === "astar-state") return "Local A*";
  if (route.optimizationMethod === "insertion-2opt-oropt") return "Local heuristic";
  return "Local optimizer";
}

async function notifyDriverRouteAssigned(params: {
  routeId: string;
  routeName: string;
  stopCount: number;
  driverAuthUserId: string | null | undefined;
}) {
  const { routeId, routeName, stopCount, driverAuthUserId } = params;
  if (!driverAuthUserId) return;
  try {
    const { error } = await supabase.from("notifications").insert({
      user_auth_id: driverAuthUserId,
      user_id: driverAuthUserId,
      title: "New route assigned",
      message: `Route "${routeName}" has ${stopCount} stop${stopCount === 1 ? "" : "s"} (Pending). Open EcoLoop to accept it when ready.`,
      type: "info",
      category: "route",
      source_table: "routes",
      source_id: routeId,
    });
    if (error) console.warn("[EcoLoop] notifyDriverRouteAssigned:", error.message);
  } catch (err: any) {
    console.warn("[EcoLoop] notifyDriverRouteAssigned:", err?.message ?? err);
  }
}

type PageType = "dashboard" | "route-planning" | "vehicle-monitoring" | "reports" | "bin-locations" | "notifications";

interface RoutePlanningProps {
  onNavigate?: (page: PageType) => void;
}

interface Route {
  id: string;
  name: string;
  status: "pending" | "active" | "completed" | string;
  stops: number;
  distance: string;
  duration: string;
  distanceKm?: number;
  durationMinutes?: number;
  truck: string;
  coordinates?: [number, number];
  optimizedStops?: string[];
  /** Set when route was optimized using Mapbox Matrix driving-traffic durations. */
  optimizationUsedTraffic?: boolean;
  optimizationMethod?: string;
  costSource?: string;
  generatedAt?: string;
  assignmentUpdatedAt?: string;
}

interface KnownBin {
  id: number;
  code: string;
  location: string;
  coordinates: [number, number];
}

interface Driver {
  id: string | number;
  name: string;
  status: "available" | "on-route";
  auth_user_id?: string | null;
}
const DEFAULT_DEPOT = { id: "DEPOT", latitude: 13.6218, longitude: 123.1948 };

export default function RoutePlanning({ onNavigate }: RoutePlanningProps) {
  const { settings } = useLiveData();
  const depotSetting = getSetting(settings, "depot", DEFAULT_DEPOT);
  const DEPOT = useMemo(
    () => ({ id: depotSetting.id ?? "DEPOT", coordinate: { lat: Number(depotSetting.latitude), lng: Number(depotSetting.longitude) } }),
    [depotSetting.id, depotSetting.latitude, depotSetting.longitude],
  );
  const [routes, setRoutes] = useState<Route[]>([]);
  const [knownBins, setKnownBins] = useState<KnownBin[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRouteDetails, setShowRouteDetails] = useState<Route | null>(null);
  const [showMapModal, setShowMapModal] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [routeToDelete, setRouteToDelete] = useState<string | null>(null);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newRoute, setNewRoute] = useState({ name: "", truck: "" });
  const [selectedBinIds, setSelectedBinIds] = useState<string[]>([]);

  const availableDrivers = drivers.filter((driver) => driver.status === "available");
  const driversById = useMemo(() => new Map(drivers.map((driver) => [String(driver.id), driver])), [drivers]);

  const syncFromSupabase = async () => {
    setIsLoading(true);
    try {
      const [{ data: binsData, error: binsError }, { data: driversData, error: driversError }, { data: routesData, error: routesError }] =
        await Promise.all([
          supabase.from("bins").select("id, code, location, latitude, longitude").order("id", { ascending: true }),
          supabase.from("drivers").select("id, name, status, auth_user_id").order("name", { ascending: true }),
          supabase.from("routes").select("id, name, status, distance_km, duration_minutes, driver_id, center_lat, center_lng, generated_at, assignment_updated_at, started_at, completed_at, optimization_method, cost_source, used_mapbox_traffic").order("created_at", { ascending: false }),
        ]);

      if (binsError) throw binsError;
      if (driversError) throw driversError;
      if (routesError) throw routesError;

      const mappedDrivers: Driver[] = (driversData ?? []).map((driver) => ({
        id: driver.id,
        name: driver.name,
        status: driver.status === "available" ? "available" : "on-route",
        auth_user_id: driver.auth_user_id ?? null,
      }));
      setDrivers(mappedDrivers);

      const mappedBins: KnownBin[] = (binsData ?? []).map((bin) => ({
        id: bin.id,
        code: bin.code ?? `BIN-${bin.id}`,
        location: bin.location,
        coordinates: [Number(bin.latitude), Number(bin.longitude)],
      }));
      setKnownBins(mappedBins);

      const routeIds = (routesData ?? []).map((route) => route.id);
      let stopMap = new Map<string, string[]>();
      if (routeIds.length > 0) {
        const { data: stopsData, error: stopsError } = await supabase
          .from("route_stops")
          .select("route_id, stop_order, bins(code)")
          .in("route_id", routeIds)
          .order("stop_order", { ascending: true });
        if (stopsError) throw stopsError;
        stopMap = (stopsData ?? []).reduce((acc, stop: any) => {
          const key = String(stop.route_id);
          const existing = acc.get(key) ?? [];
          existing.push(stop.bins?.code ?? `BIN-${stop.bin_id}`);
          acc.set(key, existing);
          return acc;
        }, new Map<string, string[]>());
      }

      setRoutes(
        (routesData ?? []).map((route) => {
          const driver = mappedDrivers.find((item) => String(item.id) === String(route.driver_id));
          const distanceKm = Number(route.distance_km ?? 0);
          const durationMinutes = Number(route.duration_minutes ?? 0);
          return {
            id: String(route.id),
            name: route.name,
            status: route.status,
            stops: stopMap.get(String(route.id))?.length ?? 0,
            distance: formatDistanceKm(distanceKm * 1000),
            duration: formatDurationMinutes(durationMinutes),
            distanceKm,
            durationMinutes,
            truck: driver?.name ?? "Unassigned",
            coordinates: [Number(route.center_lat ?? DEPOT.coordinate.lat), Number(route.center_lng ?? DEPOT.coordinate.lng)],
            optimizedStops: stopMap.get(String(route.id)) ?? [],
            optimizationUsedTraffic: Boolean(route.used_mapbox_traffic),
            optimizationMethod: route.optimization_method ?? undefined,
            costSource: route.cost_source ?? undefined,
            generatedAt: route.generated_at,
            assignmentUpdatedAt: route.assignment_updated_at,
          };
        }),
      );
      setOptimizationError(null);
    } catch (error: any) {
      setOptimizationError("Could not load route planning data. Please refresh and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    syncFromSupabase();
    const channel = supabase
      .channel("dispatcher-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "routes" }, () => syncFromSupabase())
      .on("postgres_changes", { event: "*", schema: "public", table: "route_stops" }, () => syncFromSupabase())
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => syncFromSupabase())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const buildRouteFromBins = async (routeName: string, selectedBins: KnownBin[], assignedDriver: string): Promise<Route | null> => {
    const routeStops: RouteStop[] = selectedBins.map((bin) => ({
      id: bin.code,
      location: bin.location,
      coordinate: { lat: bin.coordinates[0], lng: bin.coordinates[1] },
    }));
    const optimized = await optimizeMultiStopRouteAsync({ depot: DEPOT, stops: routeStops });
    if (!optimized) return null;
    const now = new Date().toLocaleString();
    const distanceKm = Number((optimized.totalDistanceMeters / 1000).toFixed(2));
    return {
      id: "",
      name: routeName,
      status: "pending",
      stops: optimized.orderedStops.length,
      distance: formatDistanceKm(optimized.totalDistanceMeters),
      duration: formatDurationMinutes(optimized.estimatedDurationMinutes),
      distanceKm,
      durationMinutes: optimized.estimatedDurationMinutes,
      truck: assignedDriver,
      coordinates: optimized.routeCenter,
      optimizedStops: optimized.orderedStops.map((stop) => stop.id),
      generatedAt: now,
      assignmentUpdatedAt: now,
      optimizationUsedTraffic: optimized.usedMapboxTraffic === true,
      optimizationMethod: optimized.optimizationMethod,
      costSource: optimized.costSource,
    };
  };

  const handleAutoGenerateRoutes = () => {
    if (availableDrivers.length === 0) {
      setOptimizationError("No available drivers. Add availability before auto-generating routes.");
      return;
    }

    const bucketedBins = clusterStopsByDepotSweep<KnownBin>(
      knownBins,
      DEPOT.coordinate,
      Math.min(availableDrivers.length, knownBins.length),
      (bin) => ({ lat: bin.coordinates[0], lng: bin.coordinates[1] }),
    );
    if (bucketedBins.length === 0) {
      setOptimizationError("No bins have valid coordinates for route generation.");
      return;
    }

    Promise.all(
      bucketedBins.map(async (bins, index) => {
        const driver = availableDrivers[index];
        const route = await buildRouteFromBins(`Auto Route ${index + 1}`, bins, driver.name);
        if (!route) throw new Error("Failed to optimize generated route.");

        const { data: createdRoute, error: createRouteError } = await supabase
          .from("routes")
          .insert({
            name: route.name,
            status: route.status,
            distance_km: route.distanceKm ?? Number(route.distance.replace(" km", "")),
            duration_minutes: route.durationMinutes ?? 1,
            driver_id: driver.id,
            center_lat: route.coordinates?.[0] ?? DEPOT.coordinate.lat,
            center_lng: route.coordinates?.[1] ?? DEPOT.coordinate.lng,
            generated_at: new Date().toISOString(),
            assignment_updated_at: new Date().toISOString(),
            optimization_method: route.optimizationMethod,
            cost_source: route.costSource,
            used_mapbox_traffic: route.optimizationUsedTraffic === true,
          })
          .select("id")
          .single();
        if (createRouteError || !createdRoute) throw createRouteError ?? new Error("No route id returned.");
        const newRouteId = (createdRoute as { id: string }).id;

        const binsByCode = new Map<string, KnownBin>(knownBins.map((bin) => [bin.code, bin]));
        const routeStopsPayload = (route.optimizedStops ?? []).map((code, stopOrder) => ({
          route_id: newRouteId,
          bin_id: binsByCode.get(code)?.id,
          stop_order: stopOrder + 1,
        })).filter((stop) => Boolean(stop.bin_id));
        if (routeStopsPayload.length > 0) {
          const { error: stopsError } = await supabase.from("route_stops").insert(routeStopsPayload);
          if (stopsError) throw stopsError;
        }
        const deliveriesPayload = routeStopsPayload.map((stop) => ({
          route_id: newRouteId,
          bin_id: stop.bin_id,
          driver_id: driver.id,
          status: "assigned",
          eta: null,
        }));
        if (deliveriesPayload.length > 0) {
          const { error: deliveriesError } = await supabase.from("deliveries").insert(deliveriesPayload);
          if (deliveriesError) throw deliveriesError;
        }
        await notifyDriverRouteAssigned({
          routeId: newRouteId,
          routeName: route.name,
          stopCount: routeStopsPayload.length,
          driverAuthUserId: driver.auth_user_id,
        });
      }),
    )
      .then(() => setOptimizationError(null))
      .catch(() => setOptimizationError("Could not auto-generate routes. Check drivers and bins, then try again."));
  };

  const handleCreateRoute = async () => {
    if (newRoute.name && newRoute.truck) {
      const selectedBins = knownBins.filter((bin) => selectedBinIds.includes(String(bin.id)));
      if (selectedBins.length === 0) {
        setOptimizationError("Select at least one live bin for this route.");
        return;
      }
      const route = await buildRouteFromBins(newRoute.name, selectedBins, newRoute.truck);
      if (!route) {
        setOptimizationError("Unable to compute optimized route. Please try again.");
        return;
      }
      const selectedDriver = drivers.find((driver) => driver.name === newRoute.truck);
      if (!selectedDriver) {
        setOptimizationError("Please select a valid driver.");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("routes")
          .insert({
            name: route.name,
            status: route.status,
            distance_km: route.distanceKm ?? Number(route.distance.replace(" km", "")),
            duration_minutes: route.durationMinutes ?? 1,
            driver_id: selectedDriver.id,
            center_lat: route.coordinates?.[0] ?? DEPOT.coordinate.lat,
            center_lng: route.coordinates?.[1] ?? DEPOT.coordinate.lng,
            generated_at: new Date().toISOString(),
            assignment_updated_at: new Date().toISOString(),
            optimization_method: route.optimizationMethod,
            cost_source: route.costSource,
            used_mapbox_traffic: route.optimizationUsedTraffic === true,
          })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("No route id returned.");
        const routeId = (data as { id: string }).id;

        const binsByCode = new Map<string, KnownBin>(knownBins.map((bin) => [bin.code, bin]));
        const routeStopsPayload = (route.optimizedStops ?? []).map((code, stopOrder) => ({
          route_id: routeId,
          bin_id: binsByCode.get(code)?.id,
          stop_order: stopOrder + 1,
        })).filter((stop) => Boolean(stop.bin_id));
        if (routeStopsPayload.length > 0) {
          const { error: stopsError } = await supabase.from("route_stops").insert(routeStopsPayload);
          if (stopsError) throw stopsError;
          const deliveriesPayload = routeStopsPayload.map((stop) => ({
            route_id: routeId,
            bin_id: stop.bin_id,
            driver_id: selectedDriver.id,
            status: "assigned",
            eta: null,
          }));
          const { error: deliveriesError } = await supabase.from("deliveries").insert(deliveriesPayload);
          if (deliveriesError) throw deliveriesError;
          await notifyDriverRouteAssigned({
            routeId,
            routeName: route.name,
            stopCount: routeStopsPayload.length,
            driverAuthUserId: selectedDriver.auth_user_id,
          });
        }
        setNewRoute({ name: "", truck: "" });
        setSelectedBinIds([]);
        setOptimizationError(null);
        setShowCreateModal(false);
      } catch (error: any) {
        setOptimizationError("Could not create this route. Please check your selections and try again.");
      }
    }
  };

  const handleDriverAssignment = async (routeId: string, driverName: string) => {
    const nextDriver = drivers.find((driver) => driver.name === driverName);
    if (!nextDriver) return;
    const driverId = String(nextDriver.id);
    const { error } = await supabase
      .from("routes")
      .update({
        driver_id: driverId,
        assignment_updated_at: new Date().toISOString(),
        status: "pending",
        started_at: null,
        completed_at: null,
      })
      .eq("id", routeId);
    if (error) {
      setOptimizationError("Could not update the driver assignment. Please try again.");
      return;
    }
    const [{ error: delErr }, { error: stopsErr }] = await Promise.all([
      supabase.from("deliveries").update({ driver_id: driverId }).eq("route_id", routeId).neq("status", "completed"),
      supabase.from("route_stops").update({ driver_id: driverId }).eq("route_id", routeId),
    ]);
    if (delErr || stopsErr) {
      setOptimizationError("The driver was updated, but related stops may need a moment to refresh. Reload the page if counts look wrong.");
    }
    await notifyDriverRouteAssigned({
      routeId,
      routeName: routes.find((r) => r.id === routeId)?.name ?? "Route",
      stopCount: routes.find((r) => r.id === routeId)?.stops ?? 0,
      driverAuthUserId: nextDriver.auth_user_id,
    });
  };

  const handleDeleteRoute = (id: string) => {
    setRouteToDelete(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!routeToDelete) return;
    setOptimizationError(null);
    const { error } = await supabase.from("routes").delete().eq("id", routeToDelete);
    if (error) {
      setOptimizationError("Could not delete this route. Please try again.");
      throw error;
    }
    await syncFromSupabase();
  };

  const getStatusColor = (status: string) => routeStatusBadgeClass(status);

  return (
    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-gray-900">Route Planning</h2>
            <p className="text-gray-600">Naga City Waste Collection Management</p>
            {isMapboxConfigured() ? (
              <p className="text-xs text-emerald-700 mt-1">Live traffic is used when available to improve stop order on new routes.</p>
            ) : (
              <p className="text-xs text-gray-500 mt-1">New routes use standard road routing for stop order.</p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-gray-900">Today</div>
              <div className="text-xs text-gray-500">{formatDateOnly(new Date().toISOString())}</div>
            </div>
            {onNavigate && (
              <NotificationDropdown onViewAll={() => onNavigate("notifications")} />
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Total Routes</div>
            <div className="text-gray-900 mt-2">{routes.length}</div>
            <div className="text-green-500 text-sm mt-1">All saved routes</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Active Routes</div>
            <div className="text-gray-900 mt-2">{routes.filter((route) => normalizeStatus(route.status) === "active").length}</div>
            <div className="text-blue-500 text-sm mt-1">In progress</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Pending routes</div>
            <div className="text-gray-900 mt-2">
              {routes.filter((route) => ["pending", "planned"].includes(normalizeStatus(route.status))).length}
            </div>
            <div className="text-amber-500 text-sm mt-1">Awaiting driver accept</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Completed Today</div>
            <div className="text-gray-900 mt-2">{routes.filter((route) => normalizeStatus(route.status) === "completed").length}</div>
            <div className="text-green-500 text-sm mt-1">Completed routes</div>
          </div>
        </div>

        {/* Dispatcher Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={handleAutoGenerateRoutes}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <WandSparkles className="size-4" />
            Auto Generate Routes
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Plus className="size-4" />
            Create Route
          </button>
        </div>

        {/* Routes Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-gray-900">Current Routes</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Route ID</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Name</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Status</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Stops</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Distance</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Duration</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Assigned Driver</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {routes.map((route) => (
                  <tr key={route.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-900">{route.id}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{route.name}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs ${getStatusColor(route.status)}`}>
                        {labelRouteStatus(route.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{route.stops}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{route.distance}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{route.duration}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <select
                        value={route.truck}
                        onChange={(e) => void handleDriverAssignment(route.id, e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded-md bg-white"
                      >
                        <option value="Unassigned">Unassigned</option>
                        {drivers.map((driver) => (
                          <option key={driver.id} value={driver.name}>
                            {driver.name} {driver.status === "available" ? "(Available)" : "(On Route)"}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowRouteDetails(route)}
                          className="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                          title="View Route Details"
                        >
                          <Eye className="size-4" />
                        </button>
                        <button 
                          onClick={() => {
                            setSelectedRoute(route);
                            setShowMapModal(true);
                          }}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="View on Map"
                        >
                          <MapPin className="size-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteRoute(route.id)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete Route"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Route Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={() => setShowCreateModal(false)}>
            <div className="bg-white rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-gray-900 mb-4">Create New Route</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Route Name</label>
                  <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Enter route name" value={newRoute.name} onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Route Stops From Live Bins</label>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2 space-y-2">
                    {knownBins.map((bin) => (
                      <label key={bin.id} className="flex items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selectedBinIds.includes(String(bin.id))}
                          onChange={(event) => {
                            setSelectedBinIds((prev) =>
                              event.target.checked ? [...prev, String(bin.id)] : prev.filter((id) => id !== String(bin.id)),
                            );
                          }}
                        />
                        <span>{bin.code} - {bin.location}</span>
                      </label>
                    ))}
                    {!isLoading && knownBins.length === 0 && <p className="text-sm text-gray-500">No bin records available.</p>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Selected stops: {selectedBinIds.length}</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Assign Truck</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" value={newRoute.truck} onChange={(e) => setNewRoute({ ...newRoute, truck: e.target.value })}>
                    <option value="">Select driver</option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.name}>
                        {driver.name} {driver.status === "available" ? "(Available)" : "(On Route)"}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-gray-500">New routes are created as <span className="font-medium">Pending</span> until the driver accepts them in the mobile app.</p>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button type="button" onClick={() => void handleCreateRoute()} className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
                    Create Route
                  </button>
                </div>
                {optimizationError && <p className="text-sm text-red-600">{optimizationError}</p>}
                {isLoading && <p className="text-sm text-gray-500">Loading route data…</p>}
              </div>
            </div>
          </div>
        )}

        {/* Map Modal */}
        {showMapModal && selectedRoute && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={() => setShowMapModal(false)}>
            <div className="bg-white rounded-lg shadow-2xl w-[900px] h-[700px] flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div>
                  <h3 className="text-gray-900 mb-1">{selectedRoute.name}</h3>
                  <p className="text-sm text-gray-600">Route overview</p>
                </div>
                <button 
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" 
                  onClick={() => setShowMapModal(false)}
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Route Details */}
              <div className="flex items-center gap-6 px-6 py-4 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Status:</span>
                  <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(selectedRoute.status)}`}>
                    {labelRouteStatus(selectedRoute.status)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Stops:</span>
                  <span className="text-sm text-gray-900">{selectedRoute.stops}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Distance:</span>
                  <span className="text-sm text-gray-900">{selectedRoute.distance}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Duration:</span>
                  <span className="text-sm text-gray-900">{selectedRoute.duration}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${selectedRoute.optimizationUsedTraffic ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {labelOptimizationSource(selectedRoute)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Truck:</span>
                  <span className="text-sm text-gray-900">{selectedRoute.truck}</span>
                </div>
              </div>

              <div className="flex-1 relative min-h-0 bg-gray-100">
                <TrafficRouteMapPreview lat={selectedRoute.coordinates![0]} lng={selectedRoute.coordinates![1]} zoom={13} className="absolute inset-0 h-full w-full" />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
                <div className="text-sm text-gray-600">
                  <div>Planned stop sequence: {selectedRoute.optimizedStops && selectedRoute.optimizedStops.length > 0 ? selectedRoute.optimizedStops.join(" → ") : "—"}</div>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${selectedRoute.coordinates![0]},${selectedRoute.coordinates![1]}`;
                      window.open(mapsUrl, '_blank');
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    Open in Google Maps
                  </button>
                  <button 
                    onClick={() => setShowMapModal(false)} 
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Route Details Modal */}
        {showRouteDetails && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={() => setShowRouteDetails(null)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-900">Dispatcher Route Details</h3>
                <button onClick={() => setShowRouteDetails(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                  <X className="size-5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-500">Route</span><div className="text-gray-900">{showRouteDetails.id} - {showRouteDetails.name}</div></div>
                <div><span className="text-gray-500">Status</span><div className="text-gray-900">{labelRouteStatus(showRouteDetails.status)}</div></div>
                <div><span className="text-gray-500">Driver</span><div className="text-gray-900">{showRouteDetails.truck}</div></div>
                <div><span className="text-gray-500">Stops</span><div className="text-gray-900">{showRouteDetails.stops}</div></div>
                <div><span className="text-gray-500">Distance</span><div className="text-gray-900">{showRouteDetails.distance}</div></div>
                <div><span className="text-gray-500">Duration</span><div className="text-gray-900">{showRouteDetails.duration}</div></div>
                <div><span className="text-gray-500">Generated</span><div className="text-gray-900">{showRouteDetails.generatedAt ?? "Not recorded"}</div></div>
                <div><span className="text-gray-500">Last Assignment Update</span><div className="text-gray-900">{showRouteDetails.assignmentUpdatedAt ?? "Not recorded"}</div></div>
              </div>
              <div className="mt-4 text-sm">
                <span className="text-gray-500">Optimized Sequence</span>
                <div className="text-gray-900 mt-1">{showRouteDetails.optimizedStops?.join(" -> ") ?? "No stops available"}</div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <ConfirmModal
            isOpen={showDeleteConfirm}
            onClose={() => {
              setShowDeleteConfirm(false);
              setRouteToDelete(null);
            }}
            onConfirm={() => confirmDelete()}
            title="Delete Route"
            message="Are you sure you want to delete this route?"
            variant="danger"
            confirmText="Delete"
          />
        )}
      </div>
    </div>
  );
}