import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, X, CheckCircle, User, Image as ImageIcon, Route, Navigation, Trash2, ChevronDown } from "lucide-react";
import ConfirmModal from "../components/feedback/ConfirmModal";
import Toast from "../components/feedback/Toast";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import RoleIndicator from "../components/layout/RoleIndicator";
import ReportLocationMap from "../components/reports/ReportLocationMap";
import CustomSelect from "../components/ui/CustomSelect";
import { useAuth } from "../contexts/AuthContext";
import { formatDateOnly, formatDateTime, useLiveData, type WasteReportRecord } from "../hooks/useLiveData";
import { parseReportCoordinate, resolveReportImageUrl } from "../utils/reportMedia";

type PageType = "dashboard" | "route-planning" | "vehicle-monitoring" | "reports" | "bin-locations" | "notifications";

interface ReportsAndIssuesProps {
  onNavigate?: (page: PageType) => void;
}

const statusOptions = ["pending", "in_progress", "resolved"];

type StatusFilter = "all" | "pending" | "in_progress" | "resolved";
type DayFilter = "all" | "today" | "7" | "30";

const statusFilterOptions: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All Reports" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
];

const dayFilterOptions: { value: DayFilter; label: string }[] = [
  { value: "all", label: "All Days" },
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 Days" },
  { value: "30", label: "Last 30 Days" },
];

interface StatusSelectProps {
  value: string;
  onChange: (status: string) => void;
  getStatusColor: (status: string) => string;
  className?: string;
}

function displayValue(value?: string | null) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "Not recorded";
}

function StatusSelect({ value, onChange, getStatusColor, className = "" }: StatusSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, minWidth: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuHeight = 104;
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const shouldOpenUp = spaceBelow < menuHeight + gap && rect.top > spaceBelow;

    setMenuPosition({
      top: shouldOpenUp ? Math.max(gap, rect.top - menuHeight - gap) : rect.bottom + gap,
      left: Math.max(gap, Math.min(rect.left, window.innerWidth - rect.width - gap)),
      minWidth: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  return (
    <div
      className={`relative inline-block text-left ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          updateMenuPosition();
          setOpen((current) => !current);
        }}
        className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-xs capitalize ${getStatusColor(value)}`}
      >
        <span className="truncate">{displayValue(value)}</span>
        <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div
          className="fixed z-[350] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg"
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            minWidth: menuPosition.minWidth,
          }}
        >
          <div role="listbox" aria-label="Report status" className="max-h-40 overflow-auto">
            {statusOptions.map((status) => (
              <button
                key={status}
                type="button"
                role="option"
                aria-selected={status === value}
                onClick={() => {
                  setOpen(false);
                  onChange(status);
                }}
                className={`block w-full whitespace-nowrap px-3 py-1.5 text-left capitalize ${
                  status === value
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {displayValue(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function isCustomIssueReport(report: WasteReportRecord) {
  const selectedType = report.type?.trim().toLowerCase();
  const customType = report.report_type?.trim();
  return selectedType === "other" && !!customType && customType.toLowerCase() !== "other";
}

export default function ReportsAndIssues({ onNavigate }: ReportsAndIssuesProps) {
  const {
    reports,
    drivers,
    routeById,
    loading,
    error,
    updateReport,
    deleteReport,
    resolveReport,
    createNotification,
  } = useLiveData();
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null as WasteReportRecord | null);
  const [dayFilter, setDayFilter] = useState("all" as DayFilter);
  const [statusFilter, setStatusFilter] = useState("all" as StatusFilter);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState({ message: "", type: "success" as "success" | "error" | "warning" | "info" });
  const { profile } = useAuth();
  const canEditReportStatus = profile?.role === "supervisor" || profile?.role === "dispatcher";
  const canDeleteReports =
    profile?.role === "admin" || profile?.role === "supervisor" || profile?.role === "dispatcher";

  const openReportDetails = (report: WasteReportRecord) => {
    setSelectedReport(report);
    setShowDetailsModal(true);
  };

  const closeReportDetails = () => {
    setShowDetailsModal(false);
    setShowDeleteConfirm(false);
    setSelectedReport(null);
  };

  useEffect(() => {
    if (!showDetailsModal || !selectedReport?.id) return;
    const latest = reports.find((r) => r.id === selectedReport.id);
    if (latest) setSelectedReport(latest);
  }, [reports, showDetailsModal, selectedReport?.id]);

  const reportStats = useMemo(
    () => ({
      total: reports.length,
      pending: reports.filter((report) => report.status === "pending").length,
      inProgress: reports.filter((report) => report.status === "in_progress").length,
      resolved: reports.filter((report) => report.status === "resolved").length,
    }),
    [reports],
  );

  const filteredReports = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rangeStart =
      dayFilter === "today"
        ? todayStart
        : dayFilter === "7" || dayFilter === "30"
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - (Number(dayFilter) - 1))
          : null;

    return reports.filter((report) => {
      if (statusFilter !== "all" && report.status !== statusFilter) return false;
      if (!rangeStart) return true;

      const submittedAt = new Date(report.created_at);
      return !Number.isNaN(submittedAt.getTime()) && submittedAt >= rangeStart;
    });
  }, [dayFilter, reports, statusFilter]);

  const activeFilterLabel = statusFilterOptions.find((option) => option.value === statusFilter)?.label ?? "All Reports";
  const activeDayFilterLabel = dayFilterOptions.find((option) => option.value === dayFilter)?.label ?? "All Days";

  const confirmDelete = async () => {
    if (!selectedReport) return;
    const id = selectedReport.id;
    try {
      await deleteReport(id);
      setShowDeleteConfirm(false);
      closeReportDetails();
      setToastMessage({ message: "Report deleted successfully.", type: "success" });
      setShowToast(true);
    } catch (err: any) {
      const msg = err?.message ?? "Could not delete report. You may not have permission.";
      setToastMessage({ message: msg, type: "error" });
      setShowToast(true);
      throw err;
    }
  };

  const handleMarkAsResolved = async () => {
    if (!selectedReport) return;
    if (selectedReport.status === "resolved") return;
    try {
      await resolveReport(selectedReport.id);
      await notifyDriverReportStatus(selectedReport, "resolved");
      setSelectedReport({ ...selectedReport, status: "resolved", resolved_at: new Date().toISOString() });
      setToastMessage({ message: "Report marked as resolved.", type: "success" });
      setShowToast(true);
    } catch (err: any) {
      const msg = err?.message ?? "Could not update report status. You may not have permission.";
      setToastMessage({ message: msg, type: "error" });
      setShowToast(true);
    }
  };

  const handleStatusChange = async (report: WasteReportRecord, status: string) => {
    if (report.status === status) return;
    try {
      await updateReport(report.id, {
        status,
        resolved_at: status === "resolved" ? new Date().toISOString() : null,
      });
      await notifyDriverReportStatus(report, status);
      setToastMessage({ message: `Report status updated to ${displayValue(status)}.`, type: "success" });
      setShowToast(true);
    } catch (err: any) {
      const msg = err?.message ?? "Could not update report status. You may not have permission.";
      setToastMessage({ message: msg, type: "error" });
      setShowToast(true);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-700";
      case "in_progress":
        return "bg-blue-100 text-blue-700";
      case "resolved":
        return "bg-green-100 text-green-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const reportCategoryLabel = (report: WasteReportRecord) => {
    const fromDriver = report.report_type?.trim();
    if (fromDriver) return fromDriver;
    return report.type;
  };

  const routeLabel = (report: WasteReportRecord) => {
    if (report.route_id == null || report.route_id === "") return "Not linked to a route";
    const route = routeById.get(String(report.route_id));
    return route?.name ? `${route.name} (${report.route_id})` : `Route ID: ${report.route_id}`;
  };

  const notifyDriverReportStatus = async (report: WasteReportRecord, status: string) => {
    const driver = drivers.find((item) => String(item.id) === String(report.driver_id));
    if (!driver?.auth_user_id) return;

    const statusLabel = displayValue(status);
    const category = report.report_type?.trim() || report.type || "report";
    const reportNumber = report.report_number || report.report_id || "your report";
    const location = report.location ? ` at ${report.location}` : "";

    try {
      await createNotification({
        user_auth_id: String(driver.auth_user_id),
        title: `Report ${statusLabel}: ${reportNumber}`,
        message: `Your ${category} report${location} is now ${statusLabel.toLowerCase()}.`,
        type: status === "resolved" ? "success" : "info",
        category: "report",
        source_table: "waste_reports",
        source_id: report.id,
        read: false,
      });
    } catch (err: any) {
      console.warn("Driver report notification failed:", err?.message ?? err);
    }
  };

  return (
    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
      <div className="space-y-6">
        <RoleIndicator />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-gray-900">Reports & Issues</h2>
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
            <div className="text-gray-600 text-sm">Total Reports</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : reportStats.total}</div>
            <div className="text-blue-500 text-sm mt-1">Database records</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Pending</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : reportStats.pending}</div>
            <div className="text-yellow-500 text-sm mt-1">Needs attention</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">In Progress</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : reportStats.inProgress}</div>
            <div className="text-blue-500 text-sm mt-1">Being handled</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Resolved</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : reportStats.resolved}</div>
            <div className="text-green-500 text-sm mt-1">Completed</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-gray-900">{activeFilterLabel}</h3>
              {(dayFilter !== "all" || statusFilter !== "all") && (
                <p className="mt-1 text-sm text-gray-500">
                  Showing {filteredReports.length} of {reports.length} reports for {activeDayFilterLabel.toLowerCase()}
                </p>
              )}
            </div>
            <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:min-w-[24rem]">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Days</label>
                <CustomSelect
                  value={dayFilter}
                  onChange={(value) => setDayFilter(value as DayFilter)}
                  options={dayFilterOptions}
                  buttonClassName="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  ariaLabel="Filter reports by days"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                <CustomSelect
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as StatusFilter)}
                  options={statusFilterOptions}
                  buttonClassName="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  ariaLabel="Filter reports by status"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-sm text-gray-600">Report</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-600">Driver</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-600">Category</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-600">Location</th>
                  <th className="px-4 py-3 text-center text-sm text-gray-600">GPS</th>
                  <th className="px-4 py-3 text-center text-sm text-gray-600">Photo</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-600">Submitted</th>
                  <th className="px-4 py-3 text-left text-sm text-gray-600">Assigned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredReports.map((report) => {
                  const thumbUrl = resolveReportImageUrl(report.image_url);
                  const hasGps = parseReportCoordinate(report.latitude) != null && parseReportCoordinate(report.longitude) != null;
                  return (
                  <tr
                    key={report.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => openReportDetails(report)}
                  >
                    <td className="px-4 py-4 text-sm text-gray-900">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{report.report_number}</span>
                          {report.status === "resolved" && <CheckCircle className="size-4 shrink-0 text-emerald-600" />}
                        </div>
                        {report.report_id && report.report_id !== report.report_number && <span className="text-xs text-gray-500">{report.report_id}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-900">
                      {drivers.find((driver) => String(driver.id) === String(report.driver_id))?.name ?? "Unassigned"}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-900">
                      <div className="max-w-[10rem]">
                        <span className="line-clamp-2">{reportCategoryLabel(report)}</span>
                        {isCustomIssueReport(report) ? (
                          <span className="mt-0.5 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Custom issue</span>
                        ) : (
                          report.report_type?.trim() && report.type && report.report_type.trim() !== report.type && <span className="mt-0.5 block text-xs text-gray-500">Record: {report.type}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-900 max-w-[12rem]">
                      <span className="line-clamp-2">{report.location}</span>
                    </td>
                    <td className="px-4 py-4 text-center text-gray-600">
                      {hasGps ? (
                        <span title="GPS coordinates on file">
                          <Navigation className="mx-auto size-4 text-emerald-600" aria-hidden />
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {thumbUrl ? (
                        <img src={thumbUrl} alt="" className="mx-auto h-10 w-10 rounded-md border border-gray-200 object-cover" loading="lazy" />
                      ) : (
                        <span className="text-xs text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-4" onClick={(event) => event.stopPropagation()}>
                      {canEditReportStatus ? (
                        <StatusSelect value={report.status} onChange={(status) => void handleStatusChange(report, status)} getStatusColor={getStatusColor} className="max-w-[9rem]" />
                      ) : (
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs capitalize ${getStatusColor(report.status)}`}>{displayValue(report.status)}</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-900 whitespace-nowrap">{formatDateTime(report.created_at)}</td>
                    <td className="px-4 py-4 text-sm text-gray-900 max-w-[8rem] truncate">{report.assigned_to ?? "Unassigned"}</td>
                  </tr>
                  );
                })}
                {!loading && filteredReports.length === 0 && (
                  <tr>
                    <td className="px-6 py-8 text-center text-gray-500" colSpan={9}>
                      {reports.length === 0
                        ? "No reports found yet."
                        : `No ${activeFilterLabel.toLowerCase()} found.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {showDetailsModal && selectedReport && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-3 md:p-6" onClick={closeReportDetails}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 md:px-6">
                <div className="min-w-0">
                  <h3 className="text-gray-900 text-lg font-semibold flex flex-wrap items-center gap-2">
                    Truck driver report
                    {selectedReport.status === "resolved" && <CheckCircle className="size-5 shrink-0 text-emerald-600" aria-hidden />}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    <span className="font-medium text-gray-800">{selectedReport.report_number}</span>
                    {selectedReport.report_id && selectedReport.report_id !== selectedReport.report_number && (
                      <span className="text-gray-500"> · {selectedReport.report_id}</span>
                    )}
                  </p>
                </div>
                <button type="button" className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={closeReportDetails} aria-label="Close">
                  <X className="size-5" />
                </button>
              </div>

              {(() => {
                const driver = drivers.find((d) => String(d.id) === String(selectedReport.driver_id));
                const photoUrl = resolveReportImageUrl(selectedReport.image_url);
                const lat = parseReportCoordinate(selectedReport.latitude);
                const lng = parseReportCoordinate(selectedReport.longitude);
                return (
                  <div className="px-5 py-5 md:px-6 md:py-6 space-y-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                          <User className="size-4 text-emerald-600 shrink-0" aria-hidden />
                          Driver
                        </div>
                        <p className="text-gray-900 font-medium">{driver?.name ?? "Unassigned"}</p>
                        {selectedReport.driver_id != null && selectedReport.driver_id !== "" && (
                          <p className="text-xs text-gray-500 mt-1">Driver ID: {String(selectedReport.driver_id)}</p>
                        )}
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                          <AlertTriangle className="size-4 text-amber-600 shrink-0" aria-hidden />
                          Category & status
                        </div>
                        <p className="text-gray-900">{reportCategoryLabel(selectedReport)}</p>
                        {isCustomIssueReport(selectedReport) ? (
                          <p className="text-xs text-gray-500 mt-1">Driver selected Other and entered a custom issue.</p>
                        ) : selectedReport.report_type?.trim() && selectedReport.type && selectedReport.report_type.trim() !== selectedReport.type && (
                          <p className="text-xs text-gray-500 mt-1">Internal type: {selectedReport.type}</p>
                        )}
                        <div className="mt-2" onClick={(event) => event.stopPropagation()}>
                          {canEditReportStatus ? (
                            <StatusSelect value={selectedReport.status} onChange={(status) => void handleStatusChange(selectedReport, status)} getStatusColor={getStatusColor} className="max-w-full" />
                          ) : (
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs capitalize ${getStatusColor(selectedReport.status)}`}>{displayValue(selectedReport.status)}</span>
                          )}
                        </div>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4 sm:col-span-2 lg:col-span-1">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                          <Route className="size-4 text-blue-600 shrink-0" aria-hidden />
                          Submitted
                        </div>
                        <p className="text-gray-900">{formatDateTime(selectedReport.created_at)}</p>
                        {selectedReport.resolved_at && <p className="text-xs text-gray-500 mt-1">Resolved: {formatDateTime(selectedReport.resolved_at)}</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Route</label>
                          <p className="text-gray-900">{routeLabel(selectedReport)}</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Location (description)</label>
                          <p className="text-gray-900">{selectedReport.location}</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">GPS coordinates</label>
                          <p className="text-gray-900 font-mono text-sm">
                            {lat != null && lng != null ? (
                              <>
                                {lat.toFixed(6)}, {lng.toFixed(6)}
                              </>
                            ) : (
                              "Not recorded"
                            )}
                          </p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Notes</label>
                          <p className="text-gray-900 whitespace-pre-wrap rounded-md border border-gray-100 bg-gray-50/50 p-3 text-sm min-h-[4rem]">{selectedReport.description?.trim() ? selectedReport.description : "No notes provided."}</p>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Reported by</label>
                            <p className="text-sm text-gray-900">{selectedReport.reported_by ?? "Not recorded"}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Assigned to</label>
                            <p className="text-sm text-gray-900">{selectedReport.assigned_to ?? "Unassigned"}</p>
                          </div>
                          {selectedReport.bin_id != null && selectedReport.bin_id !== "" && (
                            <div>
                              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Bin</label>
                              <p className="text-sm text-gray-900">#{String(selectedReport.bin_id)}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-5">
                        <div>
                          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                            <ImageIcon className="size-4 text-purple-600 shrink-0" aria-hidden />
                            Photo from driver
                          </div>
                          {photoUrl ? (
                            <a href={photoUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                              <img src={photoUrl} alt="Report attachment" className="max-h-72 w-full object-contain" loading="lazy" />
                            </a>
                          ) : (
                            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">No image uploaded for this report.</div>
                          )}
                        </div>
                        <div>
                          <div className="mb-2 text-sm font-medium text-gray-700">Map</div>
                          <ReportLocationMap latitude={selectedReport.latitude} longitude={selectedReport.longitude} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-gray-200 bg-white p-4 sm:flex-row sm:gap-3 md:px-6">
                {canDeleteReports && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 sm:mr-auto"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Delete Report
                  </button>
                )}
                <button type="button" onClick={closeReportDetails} className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                  Close
                </button>
                {canEditReportStatus && selectedReport.status !== "resolved" && (
                  <button type="button" onClick={() => void handleMarkAsResolved()} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                    Mark as Resolved
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <ConfirmModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => confirmDelete()}
          title="Delete Report"
          message="Are you sure you want to delete this report? This action cannot be undone."
          variant="danger"
          confirmText="Delete"
        />

        {showToast && <Toast message={toastMessage.message} type={toastMessage.type} onClose={() => setShowToast(false)} />}
      </div>
    </div>
  );
}
