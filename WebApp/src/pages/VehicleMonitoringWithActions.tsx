import { useEffect, useMemo, useState } from "react";
import { X, MapPin } from "lucide-react";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import RoleIndicator from "../components/layout/RoleIndicator";
import LiveFleetMap from "../components/maps/LiveFleetMap";
import {
  formatDateOnly,
  formatDateTime,
  getRouteProgress,
  relativeTime,
  useLiveData,
  type DriverRecord,
  type RouteRecord,
  type VehicleLocationRecord,
  type VehicleRecord,
} from "../hooks/useLiveData";

type PageType = "dashboard" | "route-planning" | "vehicle-monitoring" | "reports" | "bin-locations" | "notifications";

interface VehicleMonitoringWithActionsProps {
  onNavigate?: (page: PageType) => void;
}

const LIVE_LOCATION_STALE_MS = 30 * 1000;
const LIVE_LOCATION_DELAYED_MS = 10 * 1000;
const LIVE_LOCATION_MAX_FUTURE_SKEW_MS = 60 * 1000;

interface FleetMarker {
  key: string;
  label: string;
  driver: DriverRecord | null;
  vehicle: VehicleRecord | null;
  route: RouteRecord | null;
  status: string;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  accuracyM: number | null;
  lastUpdatedAt: string;
  delayed: boolean;
}

function finiteNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function locationUpdatedAt(location: VehicleLocationRecord) {
  return location.updated_at ?? location.recorded_at ?? null;
}

function normalizeStatusLabel(value?: string | null) {
  return (value ?? "unknown").replace(/_/g, " ");
}

function isDriverTrackable(status?: string | null) {
  const normalized = String(status ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return normalized === "active" || normalized === "available" || normalized === "on_route";
}

export default function VehicleMonitoringWithActions({ onNavigate }: VehicleMonitoringWithActionsProps) {
  const {
    deliveries,
    drivers,
    routes,
    vehicles,
    vehicleLocations,
    loading,
    error,
    refreshVehicleLocations,
  } = useLiveData();
  const [selectedMarker, setSelectedMarker] = useState<FleetMarker | null>(null);
  const [liveNow, setLiveNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setLiveNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshVehicleLocations();
    const timer = window.setInterval(() => void refreshVehicleLocations(), 10_000);
    return () => window.clearInterval(timer);
  }, [refreshVehicleLocations]);

  const vehicleStats = useMemo(
    () => ({
      total: vehicles.length,
      active: vehicles.filter((vehicle) => ["active", "available", "on_route"].includes(vehicle.status)).length,
      maintenance: vehicles.filter((vehicle) => vehicle.status === "maintenance").length,
      assigned: vehicles.filter((vehicle) => vehicle.route_id).length,
    }),
    [vehicles],
  );

  const liveFleetMarkers = useMemo(() => {
    const driverById = new Map(drivers.map((driver) => [String(driver.id), driver]));
    const routeById = new Map(routes.map((route) => [String(route.id), route]));
    const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle]));
    const driverByVehicleId = new Map(
      drivers
        .filter((driver) => driver.assigned_vehicle_id != null)
        .map((driver) => [String(driver.assigned_vehicle_id), driver]),
    );
    const activeRouteByDriverId = new Map<string, RouteRecord>();

    routes.forEach((route) => {
      const routeStatus = String(route.status ?? "").toLowerCase();
      if (route.driver_id == null || !["active", "pending", "planned"].includes(routeStatus)) return;
      const key = String(route.driver_id);
      const existing = activeRouteByDriverId.get(key);
      if (!existing || new Date(route.started_at ?? route.assignment_updated_at ?? route.created_at ?? 0).getTime() > new Date(existing.started_at ?? existing.assignment_updated_at ?? existing.created_at ?? 0).getTime()) {
        activeRouteByDriverId.set(key, route);
      }
    });

    const byOwner = new Map<string, FleetMarker>();

    vehicleLocations.forEach((location) => {
      const lat = finiteNumber(location.latitude);
      const lng = finiteNumber(location.longitude);
      const updatedAt = locationUpdatedAt(location);
      if (lat == null || lng == null || !updatedAt) return;

      const updatedMs = new Date(updatedAt).getTime();
      const locationAgeMs = liveNow - updatedMs;
      if (!Number.isFinite(updatedMs) || locationAgeMs > LIVE_LOCATION_STALE_MS || locationAgeMs < -LIVE_LOCATION_MAX_FUTURE_SKEW_MS) return;

      const vehicle = location.vehicle_id != null ? vehicleById.get(String(location.vehicle_id)) ?? null : null;
      const driver =
        (location.driver_id != null ? driverById.get(String(location.driver_id)) : null) ??
        (vehicle?.driver_id != null ? driverById.get(String(vehicle.driver_id)) : null) ??
        (location.vehicle_id != null ? driverByVehicleId.get(String(location.vehicle_id)) : null) ??
        null;
      if (!driver || !isDriverTrackable(driver.status)) return;
      const route =
        (location.route_id != null ? routeById.get(String(location.route_id)) : null) ??
        (driver?.id != null ? activeRouteByDriverId.get(String(driver.id)) : null) ??
        (vehicle?.route_id != null ? routeById.get(String(vehicle.route_id)) : null) ??
        null;

      const ownerKey = driver?.id != null ? `driver:${driver.id}` : vehicle?.id != null ? `vehicle:${vehicle.id}` : `location:${location.id ?? updatedAt}`;
      const marker: FleetMarker = {
        key: ownerKey,
        label: driver?.name ?? vehicle?.label ?? vehicle?.code ?? `Vehicle ${location.vehicle_id ?? ""}`.trim(),
        driver,
        vehicle,
        route,
        status: driver?.status ?? vehicle?.status ?? "unknown",
        latitude: lat,
        longitude: lng,
        speedKph: finiteNumber(location.speed_kph),
        accuracyM: finiteNumber(location.accuracy_m),
        lastUpdatedAt: updatedAt,
        delayed: locationAgeMs > LIVE_LOCATION_DELAYED_MS,
      };

      const existing = byOwner.get(ownerKey);
      if (!existing || updatedMs >= new Date(existing.lastUpdatedAt).getTime()) {
        byOwner.set(ownerKey, marker);
      }
    });

    return Array.from(byOwner.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [drivers, liveNow, routes, vehicleLocations, vehicles]);

  return (
    <>
      <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
        <div className="space-y-6">
          <RoleIndicator />
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-gray-900">Vehicle Monitoring</h2>
              <p className="text-gray-600">Naga City Waste Collection Management</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-sm text-gray-900">Today</div>
                <div className="text-xs text-gray-500">{formatDateOnly(new Date().toISOString())}</div>
              </div>
              {onNavigate && <NotificationDropdown onViewAll={() => onNavigate("notifications")} />}
            </div>
          </div>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-gray-600 text-sm">Fleet Records</div>
              <div className="text-gray-900 mt-2">{loading ? "..." : vehicleStats.total}</div>
              <div className="text-blue-500 text-sm mt-1">Registered fleet</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-gray-600 text-sm">Active</div>
              <div className="text-gray-900 mt-2">{loading ? "..." : vehicleStats.active}</div>
              <div className="text-green-500 text-sm mt-1">Available or on route</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-gray-600 text-sm">Assigned</div>
              <div className="text-gray-900 mt-2">{loading ? "..." : vehicleStats.assigned}</div>
              <div className="text-emerald-500 text-sm mt-1">Route linked</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-gray-600 text-sm">Maintenance</div>
              <div className="text-gray-900 mt-2">{loading ? "..." : vehicleStats.maintenance}</div>
              <div className="text-amber-500 text-sm mt-1">Scheduled or offline</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-gray-200 p-5">
              <MapPin className="size-5 text-emerald-600" />
              <h3 className="font-semibold text-gray-900">Live Fleet Map</h3>
            </div>
            <LiveFleetMap
              markers={liveFleetMarkers.map((marker) => ({
                key: marker.key,
                label: `${marker.label} · ${normalizeStatusLabel(marker.status)} · ${relativeTime(marker.lastUpdatedAt)}`,
                latitude: marker.latitude,
                longitude: marker.longitude,
                delayed: marker.delayed,
              }))}
              loading={loading}
              onMarkerClick={(key) => {
                const marker = liveFleetMarkers.find((item) => item.key === key);
                if (marker) setSelectedMarker(marker);
              }}
            />
          </div>

        </div>
      </div>

      {selectedMarker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={() => setSelectedMarker(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h3 className="text-gray-900">{selectedMarker.label}</h3>
                <p className="text-sm text-gray-600">{selectedMarker.vehicle?.label ?? selectedMarker.vehicle?.code ?? "Live GPS from driver app"}</p>
              </div>
              <button onClick={() => setSelectedMarker(null)} className="text-gray-400 hover:text-gray-600">
                <X className="size-6" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Status</span><p className="text-gray-900 capitalize">{normalizeStatusLabel(selectedMarker.status)}</p></div>
              <div><span className="text-gray-500">Driver</span><p className="text-gray-900">{selectedMarker.driver?.name ?? "Unassigned"}</p></div>
              <div><span className="text-gray-500">Route</span><p className="text-gray-900">{selectedMarker.route?.name ?? "Unassigned"}</p></div>
              <div><span className="text-gray-500">Progress</span><p className="text-gray-900">{selectedMarker.route?.id ? `${getRouteProgress(String(selectedMarker.route.id), deliveries)}%` : "No route"}</p></div>
              <div><span className="text-gray-500">Last updated</span><p className={selectedMarker.delayed ? "text-amber-600" : "text-gray-900"}>{formatDateTime(selectedMarker.lastUpdatedAt)}</p></div>
              <div><span className="text-gray-500">Speed</span><p className="text-gray-900">{selectedMarker.speedKph != null ? `${selectedMarker.speedKph.toFixed(1)} kph` : "Not reported"}</p></div>
              <div><span className="text-gray-500">GPS accuracy</span><p className="text-gray-900">{selectedMarker.accuracyM != null ? `${selectedMarker.accuracyM.toFixed(1)} m` : "Not reported"}</p></div>
              <div><span className="text-gray-500">Latitude</span><p className="text-gray-900">{selectedMarker.latitude.toFixed(7)}</p></div>
              <div><span className="text-gray-500">Longitude</span><p className="text-gray-900">{selectedMarker.longitude.toFixed(7)}</p></div>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
