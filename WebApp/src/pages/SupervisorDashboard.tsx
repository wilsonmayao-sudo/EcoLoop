import React, { useEffect, useMemo, useState } from "react";
import { Activity, CalendarClock, CheckCircle, ClipboardList, FileDown, Truck, Users, X } from "lucide-react";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import RoleIndicator from "../components/layout/RoleIndicator";
import CustomSelect from "../components/ui/CustomSelect";
import { useAuth } from "../contexts/AuthContext";
import { normalizeStatus } from "../hooks/useLiveData";
import { supabase } from "../services/supabaseClient";
import type { ReportPeriod } from "../utils/reportDateRange";

function labelRouteStatus(status: string) {
  const n = normalizeStatus(status);
  if (n === "planned" || n === "pending") return "Pending";
  if (n === "active") return "Active";
  if (n === "completed") return "Completed";
  return status;
}

type PageType =
  | "dashboard"
  | "route-planning"
  | "vehicle-monitoring"
  | "reports"
  | "bin-locations"
  | "notifications"
  | "user-approvals"
  | "supervisor-dashboard"
  | "system-settings";

interface SupervisorDashboardProps {
  onNavigate?: (page: PageType) => void;
}

interface RouteRow {
  id: string;
  name: string;
  status: string;
  driver_id: string | number | null;
  distance_km: number | null;
  duration_minutes: number | null;
  generated_at: string | null;
  updated_at?: string | null;
}

interface DriverRow {
  id: string | number;
  name: string;
  status: string;
}

interface DeliveryRow {
  id: string | number;
  route_id: string;
  driver_id: string | number | null;
  status: string;
  completed_at: string | null;
  updated_at?: string | null;
}

export default function SupervisorDashboard({ onNavigate }: SupervisorDashboardProps) {
  const { profile } = useAuth();
  const canExportDriverPdf = profile?.role === "supervisor" || profile?.role === "dispatcher";
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const driverOptions = useMemo(() => drivers.map((driver) => ({ value: String(driver.id), label: driver.name })), [drivers]);
  const reportPeriodOptions = [
    { value: "today", label: "Today" },
    { value: "week", label: "This Week" },
    { value: "month", label: "This Month" },
    { value: "custom", label: "Custom Range" },
  ];

  const loadOperations = async () => {
    setLoading(true);
    setError(null);
    const [routesResult, driversResult, deliveriesResult] = await Promise.all([
      supabase
        .from("routes")
        .select("id, name, status, driver_id, distance_km, duration_minutes, generated_at, updated_at")
        .order("generated_at", { ascending: false }),
      supabase.from("drivers").select("id, name, status").order("name", { ascending: true }),
      supabase
        .from("deliveries")
        .select("id, route_id, driver_id, status, completed_at, updated_at")
        .order("updated_at", { ascending: false }),
    ]);

    if (routesResult.error || driversResult.error || deliveriesResult.error) {
      setError(routesResult.error?.message ?? driversResult.error?.message ?? deliveriesResult.error?.message ?? "Unable to load operations data.");
    }
    setRoutes((routesResult.data as RouteRow[]) ?? []);
    setDrivers((driversResult.data as DriverRow[]) ?? []);
    setDeliveries((deliveriesResult.data as DeliveryRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void loadOperations();
    const channel = supabase
      .channel("supervisor-operations")
      .on("postgres_changes", { event: "*", schema: "public", table: "routes" }, () => void loadOperations())
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, () => void loadOperations())
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => void loadOperations())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!selectedDriverId && drivers.length > 0) {
      setSelectedDriverId(String(drivers[0].id));
    }
  }, [drivers, selectedDriverId]);

  const driverById = useMemo(() => new Map(drivers.map((driver) => [String(driver.id), driver])), [drivers]);
  const deliveriesByRoute = useMemo(() => {
    return deliveries.reduce((acc, delivery) => {
      const existing = acc.get(String(delivery.route_id)) ?? [];
      existing.push(delivery);
      acc.set(String(delivery.route_id), existing);
      return acc;
    }, new Map<string, DeliveryRow[]>());
  }, [deliveries]);

  const activeOnlyCount = routes.filter((route) => normalizeStatus(route.status) === "active").length;
  const pendingRoutesCount = routes.filter((route) => ["pending", "planned"].includes(normalizeStatus(route.status))).length;
  const pipelineRoutes = routes.filter((route) => {
    const s = normalizeStatus(route.status);
    return s === "active" || s === "pending" || s === "planned";
  });
  const completedDeliveries = deliveries.filter((delivery) => delivery.status === "completed");
  const availableDrivers = drivers.filter((driver) => driver.status === "available");

  const summaryCards = [
    { label: "Active routes", value: activeOnlyCount, icon: Activity, color: "emerald" },
    { label: "Drivers available", value: availableDrivers.length, icon: Users, color: "blue" },
    { label: "Completed collections", value: completedDeliveries.length, icon: CheckCircle, color: "purple" },
    { label: "Pending routes", value: pendingRoutesCount, icon: CalendarClock, color: "amber" },
  ];

  const colorClasses: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
  };

  const routeProgress = (routeId: string) => {
    const routeDeliveries = deliveriesByRoute.get(String(routeId)) ?? [];
    if (routeDeliveries.length === 0) return 0;
    return Math.round((routeDeliveries.filter((delivery) => delivery.status === "completed").length / routeDeliveries.length) * 100);
  };

  const handleExportPdf = async () => {
    if (!canExportDriverPdf) return;
    if (!selectedDriverId) {
      setExportError("Select a driver before exporting.");
      return;
    }
    if (reportPeriod === "custom" && (!customStart || !customEnd)) {
      setExportError("Select both start and end dates for a custom range.");
      return;
    }

    setExporting(true);
    setExportError(null);
    try {
      const { exportSupervisorPdf } = await import("../utils/supervisorPdfExport");
      await exportSupervisorPdf({
        supervisorName: profile?.full_name ?? profile?.email ?? "Supervisor",
        driverId: selectedDriverId,
        period: reportPeriod,
        customStart: reportPeriod === "custom" ? customStart : undefined,
        customEnd: reportPeriod === "custom" ? customEnd : undefined,
      });
      setShowExportModal(false);
    } catch (exportErr) {
      setExportError(exportErr instanceof Error ? exportErr.message : "Unable to export PDF.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
      <div className="space-y-6">
        <RoleIndicator />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-gray-900">Supervisor Operations</h2>
            <p className="text-gray-600">Overview of routes, drivers, collections, schedules, and fleet activity.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {canExportDriverPdf && (
              <button
                type="button"
                onClick={() => {
                  setExportError(null);
                  setShowExportModal(true);
                }}
                disabled={drivers.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <FileDown className="size-4" />
                Export PDF
              </button>
            )}
            {onNavigate && <NotificationDropdown onViewAll={() => onNavigate("notifications")} />}
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {showExportModal && (
          <div
            className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4"
            onClick={() => {
              if (!exporting) setShowExportModal(false);
            }}
          >
            <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Export driver PDF</h3>
                  <p className="mt-1 text-sm text-gray-600">Select the driver and date range for the operational report.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  disabled={exporting}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                  aria-label="Close export dialog"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="space-y-4 px-5 py-5">
                {exportError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{exportError}</div>}

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Driver</label>
                  <CustomSelect
                    value={selectedDriverId}
                    onChange={setSelectedDriverId}
                    options={driverOptions}
                    placeholder="Select driver"
                    buttonClassName="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    ariaLabel="Driver"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Date range</label>
                  <CustomSelect
                    value={reportPeriod}
                    onChange={(period) => setReportPeriod(period as ReportPeriod)}
                    options={reportPeriodOptions}
                    buttonClassName="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    ariaLabel="Date range"
                  />
                </div>

                {reportPeriod === "custom" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="driver-export-start">Start date</label>
                      <input
                        id="driver-export-start"
                        type="date"
                        value={customStart}
                        onChange={(event) => setCustomStart(event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="driver-export-end">End date</label>
                      <input
                        id="driver-export-end"
                        type="date"
                        value={customEnd}
                        onChange={(event) => setCustomEnd(event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  disabled={exporting}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportPdf()}
                  disabled={exporting || !selectedDriverId}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <FileDown className="size-4" />
                  {exporting ? "Exporting..." : "Generate PDF"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className={`rounded-xl border p-5 ${colorClasses[card.color]}`}>
                <Icon className="size-5 mb-3" />
                <p className="text-sm font-medium">{card.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{loading ? "..." : card.value}</p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="p-5 border-b border-gray-200 flex items-center gap-2">
              <ClipboardList className="size-5 text-emerald-600" />
              <h3 className="font-semibold text-gray-900">Live route progress</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-5 py-3 text-left">Route</th>
                    <th className="px-5 py-3 text-left">Driver</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-left">Progress</th>
                    <th className="px-5 py-3 text-left">Schedule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pipelineRoutes.map((route) => {
                    const progress = routeProgress(route.id);
                    return (
                      <tr key={route.id}>
                        <td className="px-5 py-4 text-gray-900">{route.name}</td>
                        <td className="px-5 py-4 text-gray-700">{driverById.get(String(route.driver_id))?.name ?? "Unassigned"}</td>
                        <td className="px-5 py-4 text-gray-700">{labelRouteStatus(route.status)}</td>
                        <td className="px-5 py-4">
                          <div className="w-32 bg-gray-200 h-2 rounded-full">
                            <div className="h-2 bg-emerald-600 rounded-full" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{progress}%</span>
                        </td>
                        <td className="px-5 py-4 text-gray-600">{route.generated_at?.slice(0, 10) ?? "Not scheduled"}</td>
                      </tr>
                    );
                  })}
                  {!loading && pipelineRoutes.length === 0 && (
                    <tr>
                      <td className="px-5 py-6 text-gray-500" colSpan={5}>No pending or active routes.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="p-5 border-b border-gray-200 flex items-center gap-2">
              <Truck className="size-5 text-blue-600" />
              <h3 className="font-semibold text-gray-900">Driver & Truck Activity</h3>
            </div>
            <div className="p-5 space-y-3">
              {drivers.map((driver) => {
                const assignedRoute = routes.find(
                  (route) => String(route.driver_id) === String(driver.id) && normalizeStatus(route.status) !== "completed",
                );
                return (
                  <div key={driver.id} className="rounded-lg bg-gray-50 p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900">{driver.name}</p>
                      <span className="text-xs capitalize text-gray-600">{driver.status}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{assignedRoute ? `Assigned to ${assignedRoute.name}` : "No active route"}</p>
                  </div>
                );
              })}
              {!loading && drivers.length === 0 && <p className="text-sm text-gray-500">No drivers found.</p>}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Truck driver reports</h3>
            <p className="text-sm text-gray-600 mt-1">Review GPS-tagged issues, photos, and status updates from the field.</p>
          </div>
          {onNavigate && (
            <button type="button" onClick={() => onNavigate("reports")} className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700">
              Open Reports & Issues
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Recent Collection History</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {completedDeliveries.slice(0, 6).map((delivery) => (
              <div key={delivery.id} className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm text-gray-900">Delivery #{delivery.id}</p>
                <p className="text-xs text-gray-500">Route: {delivery.route_id}</p>
                <p className="text-xs text-gray-500">Completed: {delivery.completed_at?.slice(0, 10) ?? "Recently"}</p>
              </div>
            ))}
            {!loading && completedDeliveries.length === 0 && <p className="text-sm text-gray-500">No completed collections yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
