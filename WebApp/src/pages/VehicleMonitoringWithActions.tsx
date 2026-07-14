import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { X, Truck, MapPin, Calendar, AlertTriangle, Bell, ClipboardList } from "lucide-react";
import Toast from "../components/feedback/Toast";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import RoleIndicator from "../components/layout/RoleIndicator";
import CustomSelect from "../components/ui/CustomSelect";
import {
  formatDateOnly,
  formatDateTime,
  getRouteProgress,
  mapLatLngToPoint,
  relativeTime,
  useLiveData,
  type DriverRecord,
  type RouteRecord,
  type VehicleLocationRecord,
  type VehicleRecord,
} from "../hooks/useLiveData";

type PageType = "dashboard" | "route-planning" | "vehicle-monitoring" | "reports" | "bin-locations" | "notifications";

interface VehicleMonitoringWithActionsProps {
  onNavigateToRoutePlanning: () => void;
  onNavigateToReports?: () => void;
  onNavigate?: (page: PageType) => void;
}

const emptyMaintenanceForm = { vehicleId: "", maintenanceType: "", scheduledAt: "", durationMinutes: "", notes: "" };
const emptyAlertForm = { message: "" };
const LIVE_LOCATION_STALE_MS = 5 * 60 * 1000;
const LIVE_LOCATION_DELAYED_MS = 60 * 1000;

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

export default function VehicleMonitoringWithActions({ onNavigateToRoutePlanning, onNavigateToReports, onNavigate }: VehicleMonitoringWithActionsProps) {
  const {
    bins,
    routeStops,
    deliveries,
    drivers,
    routes,
    vehicles,
    vehicleLocations,
    maintenanceRecords,
    maintenanceTypes,
    loading,
    error,
    updateVehicle,
    createMaintenanceRecord,
    createNotifications,
  } = useLiveData();
  const vehicleOptions = useMemo(() => vehicles.map((vehicle) => ({ value: String(vehicle.id), label: vehicle.label })), [vehicles]);
  const maintenanceTypeOptions = useMemo(() => maintenanceTypes.map((type) => ({ value: type.name, label: type.name })), [maintenanceTypes]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<FleetMarker | null>(null);
  const [maintenanceForm, setMaintenanceForm] = useState(emptyMaintenanceForm);
  const [alertForm, setAlertForm] = useState(emptyAlertForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState({ message: "", type: "success" as "success" | "error" | "warning" | "info" });

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
    const now = Date.now();
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
      if (!Number.isFinite(updatedMs) || now - updatedMs > LIVE_LOCATION_STALE_MS) return;

      const vehicle = location.vehicle_id != null ? vehicleById.get(String(location.vehicle_id)) ?? null : null;
      const driver =
        (location.driver_id != null ? driverById.get(String(location.driver_id)) : null) ??
        (vehicle?.driver_id != null ? driverById.get(String(vehicle.driver_id)) : null) ??
        (location.vehicle_id != null ? driverByVehicleId.get(String(location.vehicle_id)) : null) ??
        null;
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
        delayed: now - updatedMs > LIVE_LOCATION_DELAYED_MS,
      };

      const existing = byOwner.get(ownerKey);
      if (!existing || updatedMs >= new Date(existing.lastUpdatedAt).getTime()) {
        byOwner.set(ownerKey, marker);
      }
    });

    return Array.from(byOwner.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [drivers, routes, vehicleLocations, vehicles]);

  const mapCoordinateContext = useMemo(
    () => liveFleetMarkers.map((marker) => ({ lat: marker.latitude, lng: marker.longitude })),
    [liveFleetMarkers],
  );

  const routePoints = useMemo(() => {
    return routes.map((route) => {
      const stops = routeStops
        .filter((stop) => String(stop.route_id) === String(route.id))
        .sort((a, b) => a.stop_order - b.stop_order)
        .map((stop) => {
          const bin = stop.bins ?? bins.find((item) => String(item.id) === String(stop.bin_id));
          return mapLatLngToPoint(Number(bin?.latitude), Number(bin?.longitude), bins, mapCoordinateContext);
        });
      return { route, points: stops };
    });
  }, [bins, mapCoordinateContext, routeStops, routes]);

  const scheduleMaintenance = async () => {
    try {
      setFormError(null);
      if (!maintenanceForm.vehicleId || !maintenanceForm.maintenanceType || !maintenanceForm.scheduledAt) {
        setFormError("Vehicle, maintenance type, and schedule are required.");
        return;
      }
      await createMaintenanceRecord({
        vehicle_id: maintenanceForm.vehicleId,
        maintenance_type: maintenanceForm.maintenanceType,
        scheduled_at: new Date(maintenanceForm.scheduledAt).toISOString(),
        estimated_duration_minutes: maintenanceForm.durationMinutes ? Number(maintenanceForm.durationMinutes) : null,
        notes: maintenanceForm.notes || null,
        status: "scheduled",
      });
      await updateVehicle(maintenanceForm.vehicleId, { status: "maintenance" });
      setShowScheduleModal(false);
      setMaintenanceForm(emptyMaintenanceForm);
      setToastMessage({ message: "Maintenance scheduled successfully.", type: "success" });
      setShowToast(true);
    } catch (err: any) {
      setFormError(err?.message ?? "Unable to schedule maintenance.");
    }
  };

  const sendAlert = async () => {
    try {
      setFormError(null);
      const message = alertForm.message.trim();
      if (!message) {
        setFormError("Alert message is required.");
        return;
      }
      const title = "Dispatch alert";
      const type = "warning";
      // DB enum `notification_category` often has route/bin/report/system — not "truck".
      const category = "system";
      const source_table = "vehicle_monitoring";
      const driversWithApp = drivers.filter((d) => Boolean(d.auth_user_id));
      if (driversWithApp.length > 0) {
        await createNotifications(
          driversWithApp.map((d) => ({
            user_auth_id: String(d.auth_user_id),
            title,
            message,
            type,
            category,
            source_table,
            read: false,
          })),
        );
        setToastMessage({
          message: `Alert sent to ${driversWithApp.length} truck driver${driversWithApp.length === 1 ? "" : "s"}.`,
          type: "success",
        });
      } else {
        setFormError("No truck drivers have an EcoLoop login linked to their profile. Ask your administrator to link driver accounts before sending a fleet alert.");
        return;
      }
      setAlertForm(emptyAlertForm);
      setShowAlertModal(false);
      setShowToast(true);
    } catch (err: any) {
      setFormError(err?.message ?? "Unable to send alert.");
    }
  };

  const statusClass = (status: string) => {
    switch (status) {
      case "active":
      case "available":
      case "on_route":
        return "bg-green-100 text-green-700";
      case "maintenance":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

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

          <div className="flex flex-wrap justify-end gap-3">
            <button onClick={onNavigateToRoutePlanning} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              <MapPin className="size-4" />
              Route Planning
            </button>
            <button onClick={() => setShowScheduleModal(true)} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
              <Calendar className="size-4" />
              Maintenance
            </button>
            <button onClick={() => setShowAlertModal(true)} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
              <Bell className="size-4" />
              Send Alert
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-200 flex items-center gap-2">
                <MapPin className="size-5 text-emerald-600" />
                <h3 className="font-semibold text-gray-900">Live Fleet Map</h3>
              </div>
              <div className="relative h-[520px] bg-gradient-to-br from-emerald-50 to-blue-50 overflow-hidden">
                {routePoints.map(({ route, points }) => (
                  <svg key={route.id} className="absolute inset-0 w-full h-full pointer-events-none">
                    {points.length > 1 && (
                      <polyline
                        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke="#10B981"
                        strokeWidth="0.8"
                        strokeDasharray="2 1"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                ))}
                {bins.map((bin) => {
                  const point = mapLatLngToPoint(Number(bin.latitude), Number(bin.longitude), bins, mapCoordinateContext);
                  const completed = deliveries.some((delivery) => String(delivery.bin_id) === String(bin.id) && delivery.status === "completed");
                  return (
                    <div key={bin.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${point.x}%`, top: `${point.y}%` }} title={bin.location}>
                      <MapPin className={`size-5 ${completed ? "text-emerald-600" : "text-gray-500"}`} />
                    </div>
                  );
                })}
                {liveFleetMarkers.map((marker) => {
                  const point = mapLatLngToPoint(marker.latitude, marker.longitude, bins, mapCoordinateContext);
                  return (
                    <button
                      type="button"
                      key={marker.key}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg p-2 border hover:scale-110 transition-transform ${marker.delayed ? "border-amber-300" : "border-emerald-300"}`}
                      style={{ left: `${point.x}%`, top: `${point.y}%` }}
                      onClick={() => setSelectedMarker(marker)}
                      title={`${marker.label} · ${normalizeStatusLabel(marker.status)} · ${relativeTime(marker.lastUpdatedAt)}`}
                    >
                      <Truck className={`size-5 ${marker.delayed ? "text-amber-600" : "text-emerald-600"}`} />
                    </button>
                  );
                })}
                {!loading && liveFleetMarkers.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-500">No fresh driver GPS locations.</div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <div className="p-5 border-b border-gray-200 flex items-center gap-2">
                  <Truck className="size-5 text-blue-600" />
                  <h3 className="font-semibold text-gray-900">Fleet Status</h3>
                </div>
                <div className="p-5 space-y-3 max-h-[520px] overflow-y-auto">
                  {liveFleetMarkers.map((marker) => {
                    return (
                      <button key={marker.key} onClick={() => setSelectedMarker(marker)} className="w-full text-left rounded-lg bg-gray-50 p-3 hover:bg-gray-100">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900">{marker.label}</p>
                            <p className="text-xs text-gray-500">{marker.vehicle?.label ?? marker.vehicle?.code ?? "No vehicle record linked"}</p>
                          </div>
                          <span className={`text-xs capitalize px-2 py-1 rounded-full ${statusClass(marker.status)}`}>{normalizeStatusLabel(marker.status)}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{marker.route ? `Current route: ${marker.route.name}` : "No active route"}</p>
                        <p className={`text-xs mt-1 ${marker.delayed ? "text-amber-600" : "text-emerald-600"}`}>GPS updated {relativeTime(marker.lastUpdatedAt)}</p>
                      </button>
                    );
                  })}
                  {!loading && liveFleetMarkers.length === 0 && <p className="text-sm text-gray-500">No fresh live driver locations found.</p>}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Upcoming Maintenance</h3>
                <div className="space-y-2">
                  {maintenanceRecords.slice(0, 4).map((record) => (
                    <div key={record.id} className="rounded-lg border border-gray-200 p-3">
                      <p className="text-sm text-gray-900">{record.maintenance_type}</p>
                      <p className="text-xs text-gray-500">{formatDateTime(record.scheduled_at)}</p>
                    </div>
                  ))}
                  {!loading && maintenanceRecords.length === 0 && <p className="text-sm text-gray-500">No maintenance records found.</p>}
                </div>
              </div>

              <button onClick={onNavigateToReports} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2">
                <ClipboardList className="size-4" />
                View Reports
              </button>
            </div>
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

      {showScheduleModal && (
        <Modal title="Schedule Maintenance" onClose={() => setShowScheduleModal(false)} icon={<Calendar className="size-6 text-purple-600" />}>
          <CustomSelect
            value={maintenanceForm.vehicleId}
            onChange={(vehicleId) => setMaintenanceForm({ ...maintenanceForm, vehicleId })}
            options={vehicleOptions}
            placeholder="Select vehicle"
            buttonClassName="field flex"
            ariaLabel="Select vehicle"
          />
          <CustomSelect
            value={maintenanceForm.maintenanceType}
            onChange={(maintenanceType) => setMaintenanceForm({ ...maintenanceForm, maintenanceType })}
            options={maintenanceTypeOptions}
            placeholder="Select maintenance type"
            buttonClassName="field flex"
            ariaLabel="Select maintenance type"
          />
          <input className="field" type="datetime-local" value={maintenanceForm.scheduledAt} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, scheduledAt: event.target.value })} />
          <input className="field" placeholder="Estimated duration minutes" value={maintenanceForm.durationMinutes} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, durationMinutes: event.target.value })} />
          <textarea className="field min-h-24" placeholder="Notes" value={maintenanceForm.notes} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, notes: event.target.value })} />
          <ModalFooter error={formError} onCancel={() => setShowScheduleModal(false)} onConfirm={() => void scheduleMaintenance()} confirmText="Schedule" />
        </Modal>
      )}

      {showAlertModal && (
        <Modal title="Send Alert to Truck Drivers" onClose={() => setShowAlertModal(false)} icon={<AlertTriangle className="size-6 text-red-600" />}>
          <p className="text-sm text-gray-600">
            Each truck driver with an EcoLoop account receives this message individually.
          </p>
          <textarea className="field min-h-24" placeholder="Alert message" value={alertForm.message} onChange={(event) => setAlertForm({ ...alertForm, message: event.target.value })} />
          <ModalFooter error={formError} onCancel={() => setShowAlertModal(false)} onConfirm={() => void sendAlert()} confirmText="Send Alert" />
        </Modal>
      )}

      <style dangerouslySetInnerHTML={{ __html: ".field{width:100%;padding:0.625rem 0.75rem;border:1px solid #d1d5db;border-radius:0.5rem;outline:none}.field:focus{border-color:#10b981;box-shadow:0 0 0 2px rgba(16,185,129,.2)}" }} />
      {showToast && <Toast message={toastMessage.message} type={toastMessage.type} onClose={() => setShowToast(false)} />}
    </>
  );
}

function Modal({ title, icon, children, onClose }: { title: string; icon: ReactNode; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-lg">{icon}</div>
            <h3 className="font-['Poppins:SemiBold',sans-serif] text-gray-900">{title}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="size-6" />
          </button>
        </div>
        <div className="p-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ error, onCancel, onConfirm, confirmText }: { error: string | null; onCancel: () => void; onConfirm: () => void; confirmText: string }) {
  return (
    <>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3 pt-2">
        <button onClick={onCancel} className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
          Cancel
        </button>
        <button onClick={onConfirm} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
          {confirmText}
        </button>
      </div>
    </>
  );
}
