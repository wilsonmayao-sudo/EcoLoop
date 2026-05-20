import React, { useEffect, useMemo, useState } from "react";
import { Trash2, MapPin, AlertTriangle, X, CheckCircle, User, Image as ImageIcon, Route, Navigation } from "lucide-react";
import ConfirmModal from "../components/feedback/ConfirmModal";
import Toast from "../components/feedback/Toast";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import ReportLocationMap from "../components/reports/ReportLocationMap";
import { useAuth } from "../contexts/AuthContext";
import { formatDateOnly, formatDateTime, useLiveData, type WasteReportRecord } from "../hooks/useLiveData";
import { parseReportCoordinate, resolveReportImageUrl } from "../utils/reportMedia";

type PageType = "dashboard" | "route-planning" | "vehicle-monitoring" | "reports" | "bin-locations" | "notifications";

interface ReportsAndIssuesProps {
  onNavigate?: (page: PageType) => void;
}

const statusOptions = ["pending", "in_progress", "resolved"];

function displayValue(value?: string | null) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "Not recorded";
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [reportToDelete, setReportToDelete] = useState(null as string | null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState({ message: "", type: "success" as "success" | "error" | "warning" | "info" });
  const { profile } = useAuth();
  const canManageReports = profile?.role === "admin" || profile?.role === "supervisor";

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

  const confirmDelete = async () => {
    const id = reportToDelete;
    if (!id) return;
    try {
      await deleteReport(id);
      if (selectedReport?.id === id) {
        setSelectedReport(null);
        setShowDetailsModal(false);
      }
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
    await resolveReport(selectedReport.id);
    await notifyDriverReportStatus(selectedReport, "resolved");
    setSelectedReport({ ...selectedReport, status: "resolved", resolved_at: new Date().toISOString() });
    setToastMessage({ message: "Report marked as resolved.", type: "success" });
    setShowToast(true);
  };

  const handleStatusChange = async (report: WasteReportRecord, status: string) => {
    if (report.status === status) return;
    await updateReport(report.id, {
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    });
    await notifyDriverReportStatus(report, status);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-red-100 text-red-700";
      case "in_progress":
        return "bg-yellow-100 text-yellow-700";
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
            <div className="text-red-500 text-sm mt-1">Needs attention</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">In Progress</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : reportStats.inProgress}</div>
            <div className="text-yellow-500 text-sm mt-1">Being handled</div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="text-gray-600 text-sm">Resolved</div>
            <div className="text-gray-900 mt-2">{loading ? "..." : reportStats.resolved}</div>
            <div className="text-green-500 text-sm mt-1">Completed</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-gray-900">All Reports</h3>
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
                  <th className="px-4 py-3 text-left text-sm text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {reports.map((report) => {
                  const thumbUrl = resolveReportImageUrl(report.image_url);
                  const hasGps = parseReportCoordinate(report.latitude) != null && parseReportCoordinate(report.longitude) != null;
                  return (
                  <tr key={report.id} className="hover:bg-gray-50 transition-colors">
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
                    <td className="px-4 py-4">
                      {canManageReports ? (
                        <select value={report.status} onChange={(event) => void handleStatusChange(report, event.target.value)} className={`max-w-[9rem] px-2 py-1 rounded-full text-xs border-0 capitalize ${getStatusColor(report.status)}`}>
                          {statusOptions.map((status) => (
                            <option key={status} value={status}>
                              {displayValue(status)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs capitalize ${getStatusColor(report.status)}`}>{displayValue(report.status)}</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-900 whitespace-nowrap">{formatDateTime(report.created_at)}</td>
                    <td className="px-4 py-4 text-sm text-gray-900 max-w-[8rem] truncate">{report.assigned_to ?? "Unassigned"}</td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedReport(report);
                            setShowDetailsModal(true);
                          }}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="View full report"
                        >
                          <MapPin className="size-4" />
                        </button>
                        {canManageReports && (
                          <button
                            onClick={() => {
                              setReportToDelete(report.id);
                              setShowDeleteConfirm(true);
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Delete Report"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {!loading && reports.length === 0 && (
                  <tr>
                    <td className="px-6 py-8 text-center text-gray-500" colSpan={10}>
                      No reports found yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {showDetailsModal && selectedReport && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-3 md:p-6" onClick={() => setShowDetailsModal(false)}>
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
                <button type="button" className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={() => setShowDetailsModal(false)} aria-label="Close">
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
                        <div className="mt-2">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs capitalize ${getStatusColor(selectedReport.status)}`}>{displayValue(selectedReport.status)}</span>
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
                <button type="button" onClick={() => setShowDetailsModal(false)} className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                  Close
                </button>
                {canManageReports && selectedReport.status !== "resolved" && (
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
          onClose={() => {
            setShowDeleteConfirm(false);
            setReportToDelete(null);
          }}
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
