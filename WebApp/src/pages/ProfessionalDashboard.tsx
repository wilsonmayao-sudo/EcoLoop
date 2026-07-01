import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, Truck, MapPin, AlertCircle, Activity, CheckCircle, Clock, Users, ShieldCheck, Database, UserCheck } from "lucide-react";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import RoleIndicator from "../components/layout/RoleIndicator";
import { formatDateOnly, getRouteProgress, normalizeStatus, relativeTime, useLiveData } from "../hooks/useLiveData";
import { supabase } from "../services/supabaseClient";
import type { AccountStatus, AppRole } from "../contexts/AuthContext";

function labelRouteStatus(status: string) {
  const n = normalizeStatus(status);
  if (n === "planned" || n === "pending") return "Pending";
  if (n === "active") return "Active";
  if (n === "completed") return "Completed";
  return status;
}
import { resolveReportImageUrl } from "../utils/reportMedia";

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

type WebRole = "admin" | "dispatcher" | "supervisor" | "truck_driver";

interface ProfessionalDashboardProps {
  onNavigate: (page: PageType) => void;
  role?: WebRole;
}

interface AdminUserProfileRow {
  auth_user_id: string;
  full_name: string;
  email: string;
  role: AppRole;
  status: AccountStatus;
}

export default function ProfessionalDashboard({ onNavigate, role = "admin" }: ProfessionalDashboardProps) {
  const { dashboardStats, reports, routes, deliveries, vehicles, notifications, driverById, loading, error } = useLiveData();
  const canManageRoutes = role === "dispatcher";
  const [adminUsers, setAdminUsers] = useState<AdminUserProfileRow[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(role === "admin");
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null);

  const loadAdminUsers = useCallback(async () => {
    if (role !== "admin") {
      setAdminUsers([]);
      setAdminUsersLoading(false);
      setAdminUsersError(null);
      return;
    }
    setAdminUsersLoading(true);
    setAdminUsersError(null);
    const { data, error: profileError } = await supabase
      .from("user_profiles")
      .select("auth_user_id, full_name, email, role, status")
      .order("full_name", { ascending: true });
    if (profileError) {
      setAdminUsers([]);
      setAdminUsersError(profileError.message);
    } else {
      setAdminUsers((data as AdminUserProfileRow[]) ?? []);
    }
    setAdminUsersLoading(false);
  }, [role]);

  useEffect(() => {
    void loadAdminUsers();
    if (role !== "admin") return undefined;
    const channel = supabase
      .channel("admin-dashboard-user-profiles")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, () => void loadAdminUsers())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAdminUsers, role]);

  const stats = [
    { id: "bins", title: "Total Collection Sites", value: dashboardStats.totalBins, icon: MapPin, color: "emerald", page: "bin-locations" as PageType },
    { id: "trucks", title: "Active Trucks", value: dashboardStats.activeTrucks, icon: Truck, color: "blue", page: "vehicle-monitoring" as PageType },
    { id: "routes", title: "Completed Routes", value: dashboardStats.completedRoutes, icon: CheckCircle, color: "purple", page: canManageRoutes ? "route-planning" as PageType : "reports" as PageType },
    { id: "reports", title: "Pending Reports", value: dashboardStats.pendingReports, icon: AlertCircle, color: "red", page: "reports" as PageType },
  ];

  const quickActions = canManageRoutes
    ? [
        { id: "create-route", title: "Create Route", description: "Plan a new collection route", icon: MapPin, color: "emerald", page: "route-planning" as PageType },
        { id: "dispatch-truck", title: "Dispatch Truck", description: "Assign vehicle to route", icon: Truck, color: "blue", page: "vehicle-monitoring" as PageType },
        { id: "view-reports", title: "View Reports", description: "Check recent issues", icon: AlertCircle, color: "purple", page: "reports" as PageType },
      ]
    : [
        { id: "users", title: "User Accounts", description: "Approve and manage system users", icon: Users, color: "emerald", page: "user-approvals" as PageType },
        { id: "settings", title: "System Settings", description: "Review platform configuration", icon: Activity, color: "blue", page: "system-settings" as PageType },
        { id: "view-reports", title: "View Reports", description: "Review submitted issues", icon: AlertCircle, color: "purple", page: "reports" as PageType },
      ];

  const recentReports = reports.slice(0, 3);
  const pipelineRoutes = routes
    .filter((route) => ["pending", "planned", "active"].includes(normalizeStatus(route.status)))
    .slice(0, 3);
  const roleSummary = useMemo(() => {
    const counts = adminUsers.reduce((acc, user) => {
      acc.set(user.role, (acc.get(user.role) ?? 0) + 1);
      return acc;
    }, new Map<AppRole, number>());
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [adminUsers]);
  const adminStats = [
    { id: "total-users", title: "Total Users", value: adminUsers.length, icon: Users, color: "emerald", page: "user-approvals" as PageType },
    { id: "pending-drivers", title: "Pending Drivers", value: adminUsers.filter((user) => user.role === "truck_driver" && user.status === "pending_approval").length, icon: UserCheck, color: "red", page: "user-approvals" as PageType },
    { id: "pending-accounts", title: "Pending Accounts", value: adminUsers.filter((user) => user.status === "pending_approval").length, icon: AlertCircle, color: "purple", page: "user-approvals" as PageType },
    { id: "active-users", title: "Active Users", value: adminUsers.filter((user) => user.status === "active").length, icon: ShieldCheck, color: "blue", page: "user-approvals" as PageType },
  ];
  const accountStatusSummary = useMemo(() => {
    const counts = adminUsers.reduce((acc, user) => {
      acc.set(user.status, (acc.get(user.status) ?? 0) + 1);
      return acc;
    }, new Map<AccountStatus, number>());
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [adminUsers]);
  const systemActivity = notifications
    .filter((notification) => notification.category === "system" || notification.type === "warning" || notification.type === "error")
    .slice(0, 4);
  const systemRecords = [
    { label: "Total Users", value: adminUsers.length },
    { label: "Active Users", value: adminUsers.filter((user) => user.status === "active").length },
    { label: "Total Reports", value: reports.length },
    { label: "System Notices", value: systemActivity.length },
  ];
  const userActivity = notifications
    .filter((notification) => notification.user_auth_id || notification.role)
    .slice(0, 4);
  const recentUserAccounts = adminUsers.slice(0, 4);

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

  if (!canManageRoutes) {
    return (
      <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
        <div className="space-y-6">
          <RoleIndicator />
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-gray-900">Admin Dashboard</h2>
              <p className="text-gray-600">System administration, users, roles, and platform records.</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-sm text-gray-900">Today</div>
                <div className="text-xs text-gray-500">{formatDateOnly(new Date().toISOString())}</div>
              </div>
              <NotificationDropdown onViewAll={() => onNavigate("notifications")} />
            </div>
          </div>

          {(error || adminUsersError) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{adminUsersError ?? error}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {adminStats.map((stat) => {
              const colors = getColorClasses(stat.color);
              const Icon = stat.icon;
              return (
                <button
                  key={stat.id}
                  onClick={() => onNavigate(stat.page)}
                  className={`bg-white rounded-xl p-6 border-2 ${colors.border} ${colors.hover} transition-all hover:shadow-lg cursor-pointer text-left group`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`${colors.bg} p-3 rounded-lg`}>
                      <Icon className={`size-6 ${colors.text}`} />
                    </div>
                    <span className={`${colors.text} font-['Poppins:SemiBold',sans-serif] text-sm`}>
                      <TrendingUp className="size-4" />
                    </span>
                  </div>
                  <h3 className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600 mb-1">{stat.title}</h3>
                  <p className="font-['Poppins:Bold',sans-serif] text-3xl text-gray-900">{adminUsersLoading ? "..." : stat.value}</p>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                  <Database className="size-5 text-emerald-600" />
                  <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900">System Summary</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {systemRecords.map((record) => (
                    <div key={record.label} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <p className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600">{record.label}</p>
                      <p className="font-['Poppins:Bold',sans-serif] text-2xl text-gray-900 mt-1">{loading || adminUsersLoading ? "..." : record.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900">Total Reports</h2>
                    <button onClick={() => onNavigate("reports")} className="font-['Poppins:Medium',sans-serif] text-sm text-emerald-600 hover:text-emerald-700">
                      View All
                    </button>
                  </div>
                  <div className="space-y-3">
                    {recentReports.map((report) => {
                      const thumb = resolveReportImageUrl(report.image_url);
                      const category = report.report_type?.trim() || report.type;
                      return (
                        <div key={report.id} onClick={() => onNavigate("reports")} className="p-4 rounded-lg cursor-pointer transition-all border-l-4 bg-white border-gray-300 hover:bg-gray-50">
                          <div className="flex items-start gap-3 mb-2">
                            {thumb ? (
                              <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 object-cover" loading="lazy" />
                            ) : null}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <p className="font-['Poppins:SemiBold',sans-serif] text-gray-900">{report.report_number}: {category}</p>
                              </div>
                              <p className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600 line-clamp-2">{report.location}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`font-['Poppins:Medium',sans-serif] text-xs px-3 py-1 rounded-full capitalize ${statusColor(report.status)}`}>{report.status.replace("_", " ")}</span>
                            <span className="font-['Poppins:Regular',sans-serif] text-xs text-gray-500">{relativeTime(report.created_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                    {!loading && recentReports.length === 0 && <p className="text-sm text-gray-500">No reports found.</p>}
                  </div>
                </div>

                <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                  <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900 mb-6">Recent User Accounts</h2>
                  <div className="space-y-3">
                    {recentUserAccounts.map((user) => (
                      <div key={user.auth_user_id} className="rounded-lg bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-['Poppins:Medium',sans-serif] text-sm text-gray-900 truncate">{user.full_name}</p>
                            <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-600 truncate">{user.email}</p>
                          </div>
                          <span className="font-['Poppins:Medium',sans-serif] text-xs px-3 py-1 rounded-full capitalize bg-gray-200 text-gray-800">
                            {user.status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-500 mt-2 capitalize">{user.role.replace("_", " ")}</p>
                      </div>
                    ))}
                    {!adminUsersLoading && recentUserAccounts.length === 0 && <p className="text-sm text-gray-500">No user accounts found.</p>}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900 mb-6">Quick Actions</h2>
                <div className="space-y-3">
                  {quickActions.map((action) => {
                    const colors = getColorClasses(action.color);
                    const Icon = action.icon;
                    return (
                      <button key={action.id} onClick={() => onNavigate(action.page)} className={`w-full p-4 ${colors.bg} ${colors.hover} rounded-lg transition-all text-left group border ${colors.border}`}>
                        <div className="flex items-center gap-3">
                          <div className="bg-white p-2 rounded-lg shadow-sm">
                            <Icon className={`size-5 ${colors.text}`} />
                          </div>
                          <div className="flex-1">
                            <p className={`font-['Poppins:SemiBold',sans-serif] ${colors.text}`}>{action.title}</p>
                            <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-600">{action.description}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900 mb-6">Users by Role</h2>
                <div className="space-y-3">
                  {roleSummary.map(([userRole, count]) => (
                    <div key={userRole} className="flex items-center justify-between">
                      <span className="font-['Poppins:Regular',sans-serif] text-sm text-gray-700 capitalize">{userRole.replace("_", " ")}</span>
                      <span className="font-['Poppins:Medium',sans-serif] text-sm text-gray-900">{adminUsersLoading ? "..." : count}</span>
                    </div>
                  ))}
                  {!adminUsersLoading && roleSummary.length === 0 && <p className="text-sm text-gray-500">No user roles found.</p>}
                </div>
              </div>

              <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900 mb-6">Account Status Overview</h2>
                <div className="space-y-3">
                  {accountStatusSummary.map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <span className="font-['Poppins:Regular',sans-serif] text-sm text-gray-700 capitalize">{status.replace("_", " ")}</span>
                      <span className="font-['Poppins:Medium',sans-serif] text-sm text-gray-900">{adminUsersLoading ? "..." : count}</span>
                    </div>
                  ))}
                  {!adminUsersLoading && accountStatusSummary.length === 0 && <p className="text-sm text-gray-500">No account statuses found.</p>}
                </div>
              </div>

              <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900 mb-6">System Status</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="font-['Poppins:Regular',sans-serif] text-sm text-gray-700">Live data</span>
                    </div>
                    <span className="font-['Poppins:Medium',sans-serif] text-sm text-green-600">{error || adminUsersError ? "Needs Review" : "Operational"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="size-4 text-blue-600" />
                      <span className="font-['Poppins:Regular',sans-serif] text-sm text-gray-700">System notices</span>
                    </div>
                    <span className="font-['Poppins:Medium',sans-serif] text-sm text-gray-900">{systemActivity.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-purple-600" />
                      <span className="font-['Poppins:Regular',sans-serif] text-sm text-gray-700">Live updates</span>
                    </div>
                    <span className="font-['Poppins:Medium',sans-serif] text-sm text-gray-900">{loading || adminUsersLoading ? "Loading" : "Live"}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900 mb-6">System Activity</h2>
                <div className="space-y-3">
                  {systemActivity.map((item) => (
                    <div key={item.id} className="rounded-lg bg-gray-50 p-3">
                      <p className="font-['Poppins:Medium',sans-serif] text-sm text-gray-900">{item.title}</p>
                      <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-600 line-clamp-2 mt-1">{item.message}</p>
                      <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-500 mt-2">{relativeTime(item.created_at)}</p>
                    </div>
                  ))}
                  {!loading && systemActivity.length === 0 && <p className="text-sm text-gray-500">No system activity found.</p>}
                </div>
              </div>

              <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900 mb-6">Recent User Actions</h2>
                <div className="space-y-3">
                  {userActivity.map((item) => (
                    <div key={item.id} className="rounded-lg bg-gray-50 p-3">
                      <p className="font-['Poppins:Medium',sans-serif] text-sm text-gray-900">{item.title}</p>
                      <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-600 line-clamp-2 mt-1">{item.message}</p>
                      <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-500 mt-2">{relativeTime(item.created_at)}</p>
                    </div>
                  ))}
                  {!loading && userActivity.length === 0 && <p className="text-sm text-gray-500">No recent user actions found.</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
      <div className="space-y-6">
        <RoleIndicator />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-gray-900">Dashboard Overview</h2>
            <p className="text-gray-600">Naga City Waste Collection Management</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-gray-900">Today</div>
              <div className="text-xs text-gray-500">{formatDateOnly(new Date().toISOString())}</div>
            </div>
            <NotificationDropdown onViewAll={() => onNavigate("notifications")} />
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => {
            const colors = getColorClasses(stat.color);
            const Icon = stat.icon;
            return (
              <button
                key={stat.id}
                onClick={() => onNavigate(stat.page)}
                className={`bg-white rounded-xl p-6 border-2 ${colors.border} ${colors.hover} transition-all hover:shadow-lg cursor-pointer text-left group`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`${colors.bg} p-3 rounded-lg`}>
                    <Icon className={`size-6 ${colors.text}`} />
                  </div>
                  <span className={`${colors.text} font-['Poppins:SemiBold',sans-serif] text-sm`}>
                    <TrendingUp className="size-4" />
                  </span>
                </div>
                <h3 className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600 mb-1">{stat.title}</h3>
                <p className="font-['Poppins:Bold',sans-serif] text-3xl text-gray-900">{loading ? "..." : stat.value}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900">Live routes</h2>
                <button onClick={() => onNavigate(canManageRoutes ? "route-planning" : "reports")} className="font-['Poppins:Medium',sans-serif] text-sm text-emerald-600 hover:text-emerald-700">
                  View All
                </button>
              </div>
              <div className="space-y-4">
                {pipelineRoutes.map((route) => {
                  const progress = getRouteProgress(route.id, deliveries);
                  const vehicle = vehicles.find((item) => String(item.route_id) === String(route.id));
                  return (
                    <div key={route.id} onClick={() => onNavigate("vehicle-monitoring")} className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="bg-emerald-600 p-2 rounded-lg">
                            <Truck className="size-5 text-white" />
                          </div>
                          <div>
                            <p className="font-['Poppins:SemiBold',sans-serif] text-gray-900">{route.name}</p>
                            <p className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600">
                              {vehicle?.label ?? "No vehicle assigned"} • {driverById.get(String(route.driver_id))?.name ?? "Unassigned"}
                            </p>
                          </div>
                        </div>
                        <span className="font-['Poppins:Medium',sans-serif] text-sm text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
                          {labelRouteStatus(route.status)}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className="bg-emerald-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-500 mt-1">{progress}% Complete</p>
                    </div>
                  );
                })}
                {!loading && pipelineRoutes.length === 0 && <p className="text-sm text-gray-500">No pending or active routes.</p>}
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900">Recent Reports</h2>
                <button onClick={() => onNavigate("reports")} className="font-['Poppins:Medium',sans-serif] text-sm text-emerald-600 hover:text-emerald-700">
                  View All
                </button>
              </div>
              <div className="space-y-3">
                {recentReports.map((report) => {
                  const thumb = resolveReportImageUrl(report.image_url);
                  const category = report.report_type?.trim() || report.type;
                  return (
                  <div key={report.id} onClick={() => onNavigate("reports")} className="p-4 rounded-lg cursor-pointer transition-all border-l-4 bg-white border-gray-300 hover:bg-gray-50">
                    <div className="flex items-start gap-3 mb-2">
                      {thumb ? (
                        <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 object-cover" loading="lazy" />
                      ) : null}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-['Poppins:SemiBold',sans-serif] text-gray-900">{report.report_number}: {category}</p>
                        </div>
                        <p className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600 line-clamp-2">{report.location}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`font-['Poppins:Medium',sans-serif] text-xs px-3 py-1 rounded-full capitalize ${statusColor(report.status)}`}>{report.status.replace("_", " ")}</span>
                      <span className="font-['Poppins:Regular',sans-serif] text-xs text-gray-500">{relativeTime(report.created_at)}</span>
                    </div>
                  </div>
                  );
                })}
                {!loading && recentReports.length === 0 && <p className="text-sm text-gray-500">No reports found.</p>}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900 mb-6">Quick Actions</h2>
              <div className="space-y-3">
                {quickActions.map((action) => {
                  const colors = getColorClasses(action.color);
                  const Icon = action.icon;
                  return (
                    <button key={action.id} onClick={() => onNavigate(action.page)} className={`w-full p-4 ${colors.bg} ${colors.hover} rounded-lg transition-all text-left group border ${colors.border}`}>
                      <div className="flex items-center gap-3">
                        <div className="bg-white p-2 rounded-lg shadow-sm">
                          <Icon className={`size-5 ${colors.text}`} />
                        </div>
                        <div className="flex-1">
                          <p className={`font-['Poppins:SemiBold',sans-serif] ${colors.text}`}>{action.title}</p>
                          <p className="font-['Poppins:Regular',sans-serif] text-xs text-gray-600">{action.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <h2 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900 mb-6">System Status</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="font-['Poppins:Regular',sans-serif] text-sm text-gray-700">Live data</span>
                  </div>
                  <span className="font-['Poppins:Medium',sans-serif] text-sm text-green-600">{error ? "Needs Review" : "Operational"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="size-4 text-blue-600" />
                    <span className="font-['Poppins:Regular',sans-serif] text-sm text-gray-700">Active Drivers</span>
                  </div>
                  <span className="font-['Poppins:Medium',sans-serif] text-sm text-gray-900">{dashboardStats.activeUsers}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-purple-600" />
                    <span className="font-['Poppins:Regular',sans-serif] text-sm text-gray-700">Live updates</span>
                  </div>
                  <span className="font-['Poppins:Medium',sans-serif] text-sm text-gray-900">{loading ? "Loading" : "Live"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
