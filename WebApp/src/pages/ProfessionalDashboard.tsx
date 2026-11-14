import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, Truck, MapPin, AlertCircle, Activity, CheckCircle, Clock, Users, ShieldCheck, Database, LayoutDashboard, FileDown, ClipboardList, X } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import CustomSelect from "../components/ui/CustomSelect";
import { formatDateOnly, getRouteProgress, isBinActive, normalizeStatus, relativeTime, useLiveData, type PageType } from "../hooks/useLiveData";
import { supabase } from "../services/supabaseClient";
import { useAuth, type AppRole } from "../contexts/AuthContext";
import { doesBinMatchScheduleDay, doesScheduleMatchDay, SCHEDULE_DAY_CODES, SCHEDULE_DAY_LABELS } from "../utils/scheduleDays";
import { cleanCollectionAreaTitle } from "../utils/areaDisplay";
import {
  fetchAdminUserProfiles,
  formatAccountRoleLabel,
  isPendingAccountStatus,
  type AdminUserProfileRow,
} from "../utils/userProfiles";
import { resolveReportImageUrl } from "../utils/reportMedia";
import type { ReportPeriod } from "../utils/reportDateRange";
import type { DispatcherPdfReportType } from "../utils/supervisorPdfExport";

function labelRouteStatus(status: string) {
  const n = normalizeStatus(status);
  if (n === "planned" || n === "pending") return "Pending";
  if (n === "active") return "Active";
  if (n === "completed") return "Completed";
  return status;
}

type WebRole = "admin" | "dispatcher" | "supervisor" | "truck_driver";

interface ProfessionalDashboardProps {
  onNavigate: (page: PageType) => void;
  onNavigateUsers?: (filter: "total" | "pending" | "active") => void;
  role?: WebRole;
}

export default function ProfessionalDashboard({ onNavigate, onNavigateUsers, role = "admin" }: ProfessionalDashboardProps) {
  const { profile } = useAuth();
  const { dashboardStats, bins, collectionSchedules, reports, routes, deliveries, vehicles, drivers, notifications, driverById, operationsConfig, loading, error } = useLiveData();
  const isAdmin = role === "admin";
  const canManageRoutes = role === "dispatcher";
  const canExportDriverPdf = role === "supervisor" || role === "dispatcher";
  const [exportReportType, setExportReportType] = useState<DispatcherPdfReportType>("driver");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("ALL");
  const [exportAreaCode, setExportAreaCode] = useState("ALL");
  const [exportScheduleDay, setExportScheduleDay] = useState("ALL");
  const [exportRouteStatus, setExportRouteStatus] = useState("ALL");
  const [exportFleetStatus, setExportFleetStatus] = useState("ALL");
  const [showExportModal, setShowExportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const activeDrivers = useMemo(
    () =>
      drivers.filter((driver) => {
        const status = normalizeStatus(driver.status);
        return status !== "inactive" && status !== "suspended";
      }),
    [drivers],
  );
  const driverOptions = useMemo(
    () => [
      { value: "ALL", label: `All Active Drivers (${activeDrivers.length})` },
      ...activeDrivers.map((driver) => ({ value: String(driver.id), label: driver.name })),
    ],
    [activeDrivers],
  );
  const reportTypeOptions = [
    { value: "driver", label: "Driver Operational Report" },
    { value: "route", label: "Route Operations Report" },
    { value: "fleet", label: "Fleet & Live Monitoring Report" },
    { value: "activity", label: "Collection Activity & Schedule Report" },
  ];
  const reportPeriodOptions = [
    { value: "today", label: "Today" },
    { value: "week", label: "This Week" },
    { value: "month", label: "This Month" },
    { value: "custom", label: "Custom Range" },
  ];
  const areaFilterOptions = useMemo(() => {
    const areaMap = new Map<string, string>();
    collectionSchedules.forEach((row) => {
      const code = row.area_code?.trim();
      if (!code) return;
      if (!areaMap.has(code)) {
        areaMap.set(code, cleanCollectionAreaTitle(code, row.area_name));
      }
    });
    bins.forEach((bin) => {
      const code = bin.area_code?.trim();
      if (code && !areaMap.has(code)) {
        areaMap.set(code, cleanCollectionAreaTitle(code));
      }
    });
    const sorted = Array.from(areaMap.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([value, label]) => ({ value, label }));
    return [{ value: "ALL", label: "All Collection Areas" }, ...sorted];
  }, [bins, collectionSchedules]);
  const scheduleDayFilterOptions = useMemo(
    () => [
      { value: "ALL", label: "All Scheduled Days" },
      ...SCHEDULE_DAY_CODES.map((day) => ({ value: day, label: SCHEDULE_DAY_LABELS[day] })),
    ],
    [],
  );
  const routeStatusFilterOptions = [
    { value: "ALL", label: "All Route Statuses" },
    { value: "pending", label: "Pending" },
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ];
  const fleetStatusFilterOptions = [
    { value: "ALL", label: "All Fleet Units" },
    { value: "ONLINE", label: "Online Units" },
    { value: "OFFLINE", label: "Offline Units" },
    { value: "ON_ROUTE", label: "On Route" },
    { value: "LANDFILL", label: "Returning to Landfill" },
    { value: "STOPPED", label: "Stopped / Delayed GPS" },
    { value: "AVAILABLE", label: "Available" },
  ];

  useEffect(() => {
    if (!showExportModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !exporting) setShowExportModal(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showExportModal, exporting]);

  const handleExportPdf = async () => {
    if (!canExportDriverPdf) return;
    if (exportReportType === "driver" && !selectedDriverId) {
      setExportError("Select a driver scope before exporting.");
      return;
    }
    if (exportReportType !== "fleet" && reportPeriod === "custom" && (!customStart || !customEnd)) {
      setExportError("Select both start and end dates for a custom range.");
      return;
    }

    setExporting(true);
    setExportError(null);
    try {
      const { exportSupervisorPdf } = await import("../utils/supervisorPdfExport");
      await exportSupervisorPdf({
        reportType: exportReportType,
        supervisorName: profile?.full_name ?? profile?.email ?? (role === "supervisor" ? "Supervisor" : "Dispatcher"),
        supervisorRoleLabel: role === "supervisor" ? "SWMO Supervisor" : "SWMO Dispatcher",
        driverId: selectedDriverId || "ALL",
        period: reportPeriod,
        customStart: reportPeriod === "custom" ? customStart : undefined,
        customEnd: reportPeriod === "custom" ? customEnd : undefined,
        areaCode: exportAreaCode,
        scheduleDay: exportScheduleDay,
        routeStatus: exportRouteStatus,
        fleetStatus: exportFleetStatus,
      });
      setShowExportModal(false);
    } catch (exportErr) {
      setExportError(exportErr instanceof Error ? exportErr.message : "Unable to export PDF.");
    } finally {
      setExporting(false);
    }
  };
  const todayDayCode = useMemo(() => (["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const)[new Date().getDay()] ?? "Mon", []);
  const todayScheduleSummary = useMemo(() => {
    const areasToday = new Set<string>();
    const barangaysToday = new Set<string>();
    collectionSchedules.forEach((row) => {
      if (row.is_active !== false && doesScheduleMatchDay(row.days_of_week, todayDayCode)) {
        areasToday.add(row.area_code);
        if (row.barangay && row.stop_type !== "disposal") barangaysToday.add(row.barangay);
      }
    });
    const scheduledBinsToday = bins.filter(
      (bin) => isBinActive(bin) && doesBinMatchScheduleDay(bin, todayDayCode, collectionSchedules),
    );
    const completedBins = scheduledBinsToday.filter((b) => normalizeStatus(b.collection_status) === "completed").length;
    const missedBins = scheduledBinsToday.filter((b) => normalizeStatus(b.collection_status) === "missed").length;
    const pendingBins = scheduledBinsToday.length - completedBins - missedBins;
    const area1Rule = ["Thu", "Sun"].includes(todayDayCode)
      ? "Non-Biodegradable Waste Only (Area 1)"
      : "Biodegradable Waste Only (Area 1)";
    return {
      dayCode: todayDayCode,
      activeAreasCount: areasToday.size,
      activeBarangaysCount: barangaysToday.size,
      scheduledBinsCount: scheduledBinsToday.length,
      completedBins,
      pendingBins,
      missedBins,
      area1Rule,
    };
  }, [bins, collectionSchedules, todayDayCode]);
  const [adminUsers, setAdminUsers] = useState<AdminUserProfileRow[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(isAdmin);
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null);

  const loadAdminUsers = useCallback(async (showSpinner = true) => {
    if (!isAdmin) {
      setAdminUsers([]);
      setAdminUsersLoading(false);
      setAdminUsersError(null);
      return;
    }
    if (showSpinner) setAdminUsersLoading(true);
    setAdminUsersError(null);
    try {
      const rows = await fetchAdminUserProfiles();
      setAdminUsers(rows);
    } catch (profileError: any) {
      setAdminUsers([]);
      setAdminUsersError(profileError?.message ?? "Unable to load registered accounts.");
    } finally {
      setAdminUsersLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadAdminUsers(true);
    if (!isAdmin) return undefined;
    const channel = supabase
      .channel(`admin-dashboard-user-profiles-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, () => void loadAdminUsers(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => void loadAdminUsers(false))
      .subscribe();
    const handleRefresh = () => {
      if (document.visibilityState === "visible") {
        void loadAdminUsers(false);
      }
    };
    const handleDriversUpdated = () => void loadAdminUsers(false);
    const interval = window.setInterval(handleRefresh, 15_000);
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("ecoloop:drivers-updated", handleDriversUpdated);
    document.addEventListener("visibilitychange", handleRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("ecoloop:drivers-updated", handleDriversUpdated);
      document.removeEventListener("visibilitychange", handleRefresh);
      supabase.removeChannel(channel);
    };
  }, [isAdmin, loadAdminUsers]);

  const stats = [
    { id: "bins", title: "Total Collection Sites", value: dashboardStats.totalBins, icon: MapPin, color: "emerald", page: "area-management" as PageType },
    { id: "trucks", title: "Active Trucks", value: dashboardStats.activeTrucks, icon: Truck, color: "blue", page: "live-monitoring" as PageType },
    { id: "routes", title: "Completed Routes", value: dashboardStats.completedRoutes, icon: CheckCircle, color: "purple", page: canManageRoutes ? "route-planning" as PageType : "reports" as PageType },
    { id: "reports", title: "Pending Reports", value: dashboardStats.pendingReports, icon: AlertCircle, color: "red", page: "reports" as PageType },
  ];

  const quickActions = isAdmin
    ? [
        { id: "users", title: "User Accounts", description: "Review and manage system users", icon: Users, color: "emerald", page: "users" as PageType },
        { id: "settings", title: "System Settings", description: "Review platform configuration", icon: Activity, color: "blue", page: "system-settings" as PageType },
        { id: "view-reports", title: "View Reports", description: "Review submitted issues", icon: AlertCircle, color: "purple", page: "reports" as PageType },
      ]
    : canManageRoutes
      ? [
          { id: "create-route", title: "Create Route", description: "Plan a new collection route", icon: MapPin, color: "emerald", page: "route-planning" as PageType },
          { id: "dispatch-truck", title: "Dispatch Truck", description: "Monitor live truck telemetry", icon: Truck, color: "blue", page: "live-monitoring" as PageType },
          { id: "view-reports", title: "View Reports", description: "Check recent issues", icon: AlertCircle, color: "purple", page: "reports" as PageType },
        ]
      : [
          { id: "live-monitoring", title: "Live Monitoring", description: "Track active fleet locations", icon: Truck, color: "blue", page: "live-monitoring" as PageType },
          { id: "area-management", title: "Areas & Bins", description: "Review SWMO areas & sites", icon: MapPin, color: "emerald", page: "area-management" as PageType },
          { id: "view-reports", title: "View Reports", description: "Review submitted issues", icon: AlertCircle, color: "purple", page: "reports" as PageType },
        ];

  const recentReports = reports.slice(0, 3);
  const pipelineRoutes = routes
    .filter((route) => ["pending", "planned", "active"].includes(normalizeStatus(route.status)))
    .slice(0, 5);
  const roleSummary = useMemo(() => {
    const counts = adminUsers.reduce((acc, user) => {
      acc.set(user.role, (acc.get(user.role) ?? 0) + 1);
      return acc;
    }, new Map<AppRole, number>());
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [adminUsers]);
  const pendingUsers = useMemo(
    () => adminUsers.filter((user) => isPendingAccountStatus(user.status)),
    [adminUsers],
  );
  const adminStats = [
    { id: "total-users", title: "Total Users", value: adminUsers.length, icon: Users, color: "emerald", page: "users" as PageType, userFilter: "total" as const },
    { id: "pending-accounts", title: "Pending Accounts", value: pendingUsers.length, icon: AlertCircle, color: "purple", page: "users" as PageType, userFilter: "pending" as const },
    { id: "active-users", title: "Active Users", value: adminUsers.filter((user) => user.status === "active").length, icon: ShieldCheck, color: "blue", page: "users" as PageType, userFilter: "active" as const },
  ];
  const systemActivity = notifications
    .filter((notification) => notification.category === "system" || notification.type === "warning" || notification.type === "error")
    .slice(0, 4);
  const systemRecords = [
    { label: "Total Users", value: adminUsers.length },
    { label: "Active Users", value: adminUsers.filter((user) => user.status === "active").length },
    { label: "Total Reports", value: reports.length },
    { label: "System Notices", value: systemActivity.length },
  ];
  const getColorClasses = (color: string) => {
    const colors = {
      emerald: { bg: "bg-emerald-50", text: "text-emerald-600", hover: "hover:bg-emerald-100", border: "border-emerald-200" },
      blue: { bg: "bg-blue-50", text: "text-blue-600", hover: "hover:bg-blue-100", border: "border-blue-200" },
      purple: { bg: "bg-purple-50", text: "text-purple-600", hover: "hover:bg-purple-100", border: "border-purple-200" },
      red: { bg: "bg-red-50", text: "text-red-600", hover: "hover:bg-red-100", border: "border-red-200" },
    };
    return colors[color as keyof typeof colors] || colors.emerald;
  };

  const statusColor = (status: string) => {
    if (status === "resolved") return "bg-green-200 text-green-800";
    if (status === "in_progress") return "bg-blue-200 text-blue-800";
    return "bg-gray-200 text-gray-800";
  };

  if (isAdmin) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <PageHeader
          title="Dashboard"
          subtitle="System administration, users, roles, and platform records."
          icon={<LayoutDashboard className="size-5" aria-hidden="true" />}
          onNavigate={onNavigate as any}
        />

        {(error || adminUsersError) && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{adminUsersError ?? error}</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          {adminStats.map((stat) => {
            const colors = getColorClasses(stat.color);
            const Icon = stat.icon;
            return (
              <button
                key={stat.id}
                type="button"
                onClick={() => stat.userFilter && onNavigateUsers ? onNavigateUsers(stat.userFilter) : onNavigate(stat.page)}
                className="bg-white rounded-xl p-5 border border-gray-200 hover:border-emerald-300 transition-colors cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`${colors.bg} p-2.5 rounded-lg`}>
                    <Icon className={`size-5 ${colors.text}`} aria-hidden="true" />
                  </div>
                  <TrendingUp className={`size-4 ${colors.text}`} aria-hidden="true" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{stat.title}</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight tabular-nums">{adminUsersLoading ? "..." : stat.value}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="size-5 text-emerald-600" aria-hidden="true" />
                    <h2 className="font-semibold text-lg text-gray-900">Pending Approvals ({adminUsersLoading ? "..." : pendingUsers.length})</h2>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    All staff invites, role assignments, approvals, and suspensions are managed in Users &amp; Roles.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => (onNavigateUsers ? onNavigateUsers("pending") : onNavigate("users"))}
                  className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-700 shrink-0"
                >
                  Open Users &amp; Roles
                </button>
              </div>
              {adminUsersLoading ? (
                <div className="h-14 animate-pulse rounded-lg bg-gray-100" />
              ) : pendingUsers.length === 0 ? (
                <p className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  No accounts are currently awaiting approval.
                </p>
              ) : (
                <div className="divide-y divide-gray-100 rounded-lg border border-amber-200/80 bg-amber-50/40">
                  {pendingUsers.slice(0, 3).map((user) => (
                    <div key={user.auth_user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs sm:text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{user.full_name}</p>
                        <p className="text-xs text-gray-600 truncate">{user.email} · {formatAccountRoleLabel(user.role)}</p>
                      </div>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {user.created_at ? formatDateOnly(user.created_at) : "Pending"}
                      </span>
                    </div>
                  ))}
                  {pendingUsers.length > 3 && (
                    <div className="px-4 py-2 text-xs text-amber-800 font-medium">
                      +{pendingUsers.length - 3} more awaiting review in Users &amp; Roles
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
              <div className="flex items-center gap-2 mb-5">
                <Database className="size-5 text-emerald-600" aria-hidden="true" />
                <h2 className="font-semibold text-lg text-gray-900">System Summary</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {systemRecords.map((record) => (
                  <div key={record.label} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{record.label}</p>
                    <p className="text-2xl font-bold text-gray-900 tabular-nums mt-1">{loading || adminUsersLoading ? "..." : record.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-semibold text-lg text-gray-900">Total Reports</h2>
                <button type="button" onClick={() => onNavigate("reports")} className="font-medium text-sm text-emerald-700 hover:text-emerald-800 hover:underline">
                  View All
                </button>
              </div>
              <div className="space-y-3">
                {recentReports.map((report) => {
                  const thumb = resolveReportImageUrl(report.image_url);
                  const category = report.report_type?.trim() || report.type;
                  return (
                    <button
                      type="button"
                      key={report.id}
                      onClick={() => onNavigate("reports")}
                      className="w-full text-left p-4 rounded-lg border border-gray-200 border-l-4 border-l-emerald-500 bg-white hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    >
                      <div className="flex items-start gap-3 mb-2">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 object-cover" loading="lazy" />
                        ) : null}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-gray-900 mb-0.5">{report.report_number}: {category}</p>
                          <p className="text-sm text-gray-600 line-clamp-2">{report.location}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`font-medium text-xs px-2.5 py-0.5 rounded-full capitalize ${statusColor(report.status)}`}>{report.status.replace("_", " ")}</span>
                        <span className="text-xs text-gray-500">{relativeTime(report.created_at)}</span>
                      </div>
                    </button>
                  );
                })}
                {!loading && recentReports.length === 0 && <p className="text-sm text-gray-500">No reports found.</p>}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
              <h2 className="font-semibold text-lg text-gray-900 mb-4">Quick Actions</h2>
              <div className="space-y-3">
                {quickActions.map((action) => {
                  const colors = getColorClasses(action.color);
                  const Icon = action.icon;
                  return (
                    <button key={action.id} type="button" onClick={() => onNavigate(action.page)} className={`w-full p-3.5 ${colors.bg} ${colors.hover} rounded-lg transition-colors text-left border ${colors.border} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600`}>
                      <div className="flex items-center gap-3">
                        <div className="bg-white p-2 rounded-lg border border-gray-200/70">
                          <Icon className={`size-5 ${colors.text}`} aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-semibold text-sm ${colors.text}`}>{action.title}</p>
                          <p className="text-xs text-gray-600">{action.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
              <h2 className="font-semibold text-lg text-gray-900 mb-4">Users by Role</h2>
              <div className="space-y-3">
                {roleSummary.map(([userRole, count]) => (
                  <div key={userRole} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 capitalize">{userRole.replace("_", " ")}</span>
                    <span className="font-semibold text-gray-900 tabular-nums">{adminUsersLoading ? "..." : count}</span>
                  </div>
                ))}
                {!adminUsersLoading && roleSummary.length === 0 && <p className="text-sm text-gray-500">No user roles found.</p>}
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
              <h2 className="font-semibold text-lg text-gray-900 mb-4">System Status</h2>
              <div className="space-y-3.5 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-2 bg-emerald-500 rounded-full" />
                    <span className="text-gray-700">Live data</span>
                  </div>
                  <span className="font-medium text-emerald-700">{error || adminUsersError ? "Needs Review" : "Operational"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="size-4 text-blue-600" aria-hidden="true" />
                    <span className="text-gray-700">System notices</span>
                  </div>
                  <span className="font-semibold text-gray-900 tabular-nums">{systemActivity.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-purple-600" aria-hidden="true" />
                    <span className="text-gray-700">Live updates</span>
                  </div>
                  <span className="font-medium text-gray-900">{loading || adminUsersLoading ? "Loading" : "Live"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Dashboard"
        subtitle="Overview of routes, drivers, collections, schedules, and fleet activity"
        icon={<LayoutDashboard className="size-5" aria-hidden="true" />}
        onNavigate={onNavigate as any}
        actions={
          canExportDriverPdf ? (
            <button
              type="button"
              onClick={() => {
                setExportError(null);
                setShowExportModal(true);
              }}
              disabled={loading}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              <FileDown className="size-4" aria-hidden="true" />
              Export PDF
            </button>
          ) : undefined
        }
      />

      {showExportModal && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4 overscroll-contain"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-dialog-title"
          onClick={() => {
            if (!exporting) setShowExportModal(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 bg-gray-50/70">
              <div>
                <h2 id="export-dialog-title" className="text-base sm:text-lg font-semibold text-gray-900">Export Official SWMO PDF</h2>
                <p className="mt-1 text-xs sm:text-sm text-gray-600">Select report category and operational filters for the Naga City SWMO document.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                disabled={exporting}
                className="inline-flex size-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                aria-label="Close export dialog"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-5">
              {exportError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{exportError}</div>}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Report Type</label>
                <CustomSelect
                  value={exportReportType}
                  onChange={(value) => {
                    setExportReportType(value as DispatcherPdfReportType);
                    setExportError(null);
                  }}
                  options={reportTypeOptions}
                  ariaLabel="Report Type"
                />
              </div>

              {(exportReportType === "driver" || exportReportType === "route") && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {exportReportType === "driver" ? "Driver Scope" : "Assigned Driver Filter"}
                  </label>
                  <CustomSelect
                    value={selectedDriverId}
                    onChange={setSelectedDriverId}
                    options={driverOptions}
                    placeholder="Select driver"
                    ariaLabel="Driver Scope"
                  />
                </div>
              )}

              {exportReportType === "fleet" ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-xs text-emerald-900">
                  Exports the live fleet monitoring snapshot in Philippine Time (PHT), including truck type, driver assignment, online/offline state, last GPS update, and current route.
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Date range</label>
                  <CustomSelect
                    value={reportPeriod}
                    onChange={(period) => setReportPeriod(period as ReportPeriod)}
                    options={reportPeriodOptions}
                    ariaLabel="Date range"
                  />
                </div>
              )}

              {exportReportType !== "fleet" && reportPeriod === "custom" && (
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Collection Area</label>
                  <CustomSelect
                    value={exportAreaCode}
                    onChange={setExportAreaCode}
                    options={areaFilterOptions}
                    ariaLabel="Collection Area"
                  />
                </div>

                {exportReportType === "fleet" ? (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Fleet / Connectivity Status</label>
                    <CustomSelect
                      value={exportFleetStatus}
                      onChange={setExportFleetStatus}
                      options={fleetStatusFilterOptions}
                      ariaLabel="Fleet Status"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Collection Day</label>
                    <CustomSelect
                      value={exportScheduleDay}
                      onChange={setExportScheduleDay}
                      options={scheduleDayFilterOptions}
                      ariaLabel="Collection Day"
                    />
                  </div>
                )}
              </div>

              {(exportReportType === "driver" || exportReportType === "route") && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Route Status Filter</label>
                  <CustomSelect
                    value={exportRouteStatus}
                    onChange={setExportRouteStatus}
                    options={routeStatusFilterOptions}
                    ariaLabel="Route Status"
                  />
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
                disabled={exporting || (exportReportType === "driver" && !selectedDriverId)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <FileDown className="size-4" />
                {exporting ? "Exporting..." : "Generate PDF"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {stats.map((stat) => {
          const colors = getColorClasses(stat.color);
          const Icon = stat.icon;
          return (
            <button
              key={stat.id}
              type="button"
              onClick={() => onNavigate(stat.page)}
              className="bg-white rounded-xl p-5 border border-gray-200 hover:border-emerald-300 transition-colors cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`${colors.bg} p-2.5 rounded-lg`}>
                  <Icon className={`size-5 ${colors.text}`} aria-hidden="true" />
                </div>
                <TrendingUp className={`size-4 ${colors.text}`} aria-hidden="true" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{stat.title}</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight tabular-nums">{loading ? "..." : stat.value}</p>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="font-semibold text-lg text-gray-900">
                  Today&apos;s SWMO Collection Schedule ({todayScheduleSummary.dayCode})
                </h2>
                <p className="text-xs text-gray-600 mt-0.5">{todayScheduleSummary.area1Rule}</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("route-planning")}
                className="font-medium text-sm text-emerald-700 hover:text-emerald-800 hover:underline"
              >
                Open Schedule
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              <div className="rounded-lg bg-indigo-50 p-3 border border-indigo-100">
                <div className="text-xs text-indigo-700 font-medium">Active Areas</div>
                <div className="text-xl font-bold text-indigo-900 tabular-nums mt-1">{loading ? "..." : todayScheduleSummary.activeAreasCount}</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 border border-blue-100">
                <div className="text-xs text-blue-700 font-medium">Scheduled Bins</div>
                <div className="text-xl font-bold text-blue-900 tabular-nums mt-1">{loading ? "..." : todayScheduleSummary.scheduledBinsCount}</div>
              </div>
              <div className="rounded-lg bg-amber-50 p-3 border border-amber-100">
                <div className="text-xs text-amber-800 font-medium">Pending</div>
                <div className="text-xl font-bold text-amber-900 tabular-nums mt-1">{loading ? "..." : todayScheduleSummary.pendingBins}</div>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 border border-emerald-100">
                <div className="text-xs text-emerald-700 font-medium">Completed</div>
                <div className="text-xl font-bold text-emerald-900 tabular-nums mt-1">{loading ? "..." : todayScheduleSummary.completedBins}</div>
              </div>
              <div className="rounded-lg bg-red-50 p-3 border border-red-100 col-span-2 sm:col-span-1">
                <div className="text-xs text-red-700 font-medium">Missed</div>
                <div className="text-xl font-bold text-red-900 tabular-nums mt-1">{loading ? "..." : todayScheduleSummary.missedBins}</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ClipboardList className="size-5 text-emerald-600" aria-hidden="true" />
                <h2 className="font-semibold text-lg text-gray-900">Live Route Progress</h2>
              </div>
              <button type="button" onClick={() => onNavigate(canManageRoutes ? "route-planning" : "live-monitoring")} className="font-medium text-sm text-emerald-700 hover:text-emerald-800 hover:underline">
                View All
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wider">Route</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wider">Driver / Truck</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wider">Progress</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wider">Scheduled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pipelineRoutes.map((route) => {
                    const progress = getRouteProgress(route.id, deliveries);
                    const vehicle = vehicles.find((item) => String(item.route_id) === String(route.id));
                    return (
                      <tr
                        key={route.id}
                        onClick={() => onNavigate("live-monitoring")}
                        className="hover:bg-gray-50/70 cursor-pointer"
                      >
                        <td className="px-3 py-3 font-medium text-gray-900">{route.name}</td>
                        <td className="px-3 py-3 text-gray-600 text-xs">
                          <div>{driverById.get(String(route.driver_id))?.name ?? "Unassigned"}</div>
                          <div className="text-gray-500">{vehicle?.label ?? "No vehicle assigned"}</div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                            {labelRouteStatus(route.status)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="w-24 bg-gray-200 h-2 rounded-full">
                            <div className="h-2 bg-emerald-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 tabular-nums">{progress}%</span>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-600 tabular-nums">
                          {route.generated_at ? formatDateOnly(route.generated_at) : "Not scheduled"}
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && pipelineRoutes.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={5}>No pending or active routes.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Recent Reports</h2>
              <button type="button" onClick={() => onNavigate("reports")} className="font-medium text-sm text-emerald-700 hover:text-emerald-800 hover:underline">
                View All
              </button>
            </div>
            <div className="space-y-3">
              {recentReports.map((report) => {
                const thumb = resolveReportImageUrl(report.image_url);
                const category = report.report_type?.trim() || report.type;
                return (
                  <button
                    type="button"
                    key={report.id}
                    onClick={() => onNavigate("reports")}
                    className="w-full text-left p-4 rounded-lg border border-gray-200 border-l-4 border-l-emerald-500 bg-white hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                  >
                    <div className="flex items-start gap-3 mb-2">
                      {thumb ? (
                        <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 object-cover" loading="lazy" />
                      ) : null}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-gray-900 mb-0.5">{report.report_number}: {category}</p>
                        <p className="text-sm text-gray-600 line-clamp-2">{report.location}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`font-medium text-xs px-2.5 py-0.5 rounded-full capitalize ${statusColor(report.status)}`}>{report.status.replace("_", " ")}</span>
                      <span className="text-xs text-gray-500">{relativeTime(report.created_at)}</span>
                    </div>
                  </button>
                );
              })}
              {!loading && recentReports.length === 0 && <p className="text-sm text-gray-500">No reports found.</p>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
            <h2 className="font-semibold text-lg text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-3">
              {quickActions.map((action) => {
                const colors = getColorClasses(action.color);
                const Icon = action.icon;
                return (
                  <button key={action.id} type="button" onClick={() => onNavigate(action.page)} className={`w-full p-3.5 ${colors.bg} ${colors.hover} rounded-lg transition-colors text-left border ${colors.border} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600`}>
                    <div className="flex items-center gap-3">
                      <div className="bg-white p-2 rounded-lg border border-gray-200/70">
                        <Icon className={`size-5 ${colors.text}`} aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm ${colors.text}`}>{action.title}</p>
                        <p className="text-xs text-gray-600">{action.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
            <h2 className="font-semibold text-lg text-gray-900 mb-4">Driver &amp; Truck Activity</h2>
            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {activeDrivers.slice(0, 8).map((driver) => {
                const assignedRoute = routes.find(
                  (route) => String(route.driver_id) === String(driver.id) && normalizeStatus(route.status) !== "completed",
                );
                const assignedVehicle = vehicles.find(
                  (vehicle) => driver.assigned_vehicle_id != null && String(vehicle.id) === String(driver.assigned_vehicle_id),
                );
                const lastSeenMs = driver.last_seen_at ? new Date(driver.last_seen_at).getTime() : 0;
                const isOnline =
                  lastSeenMs > 0 &&
                  Date.now() - lastSeenMs <= operationsConfig.driverOfflineSeconds * 1000 &&
                  normalizeStatus(driver.status) !== "offline";
                const statusNorm = normalizeStatus(driver.status);
                const roleStateLabel =
                  statusNorm === "on_route"
                    ? "On Route"
                    : assignedRoute || assignedVehicle
                      ? "Assigned"
                      : "Available";
                return (
                  <div key={driver.id} className="rounded-lg bg-gray-50 border border-gray-100 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{driver.name}</p>
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
                        <span className={`size-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-gray-400"}`} />
                        <span>{isOnline ? "Online" : "Offline"} • {roleStateLabel}</span>
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {assignedRoute
                        ? `Route: ${assignedRoute.name}`
                        : assignedVehicle
                          ? `Truck: ${assignedVehicle.label || assignedVehicle.code}`
                          : "Available for assignment"}
                    </p>
                  </div>
                );
              })}
              {!loading && activeDrivers.length === 0 && <p className="text-sm text-gray-500">No drivers found.</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
            <h2 className="font-semibold text-lg text-gray-900 mb-4">System Status</h2>
            <div className="space-y-3.5 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-2 bg-emerald-500 rounded-full" />
                  <span className="text-gray-700">Live data</span>
                </div>
                <span className="font-medium text-emerald-700">{error ? "Needs Review" : "Operational"}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-blue-600" aria-hidden="true" />
                  <span className="text-gray-700">Active Drivers</span>
                </div>
                <span className="font-semibold text-gray-900 tabular-nums">{dashboardStats.activeUsers}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-purple-600" aria-hidden="true" />
                  <span className="text-gray-700">Live updates</span>
                </div>
                <span className="font-medium text-gray-900">{loading ? "Loading" : "Live"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
