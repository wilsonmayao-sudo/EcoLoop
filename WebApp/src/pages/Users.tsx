import { useCallback, useEffect, useMemo, useState } from "react";
import { Users as UsersIcon } from "lucide-react";
import NotificationDropdown from "../components/feedback/NotificationDropdown";
import RoleIndicator from "../components/layout/RoleIndicator";
import { supabase } from "../services/supabaseClient";
import type { AccountStatus, AppRole } from "../contexts/AuthContext";

type PageType =
  | "dashboard"
  | "route-planning"
  | "vehicle-monitoring"
  | "reports"
  | "bin-locations"
  | "notifications"
  | "users"
  | "user-approvals"
  | "supervisor-dashboard"
  | "system-settings";

type UserFilter = "total" | "active";

interface UsersProps {
  onNavigate?: (page: PageType) => void;
  initialFilter?: UserFilter;
}

interface UserProfileRow {
  auth_user_id: string;
  full_name: string;
  email: string;
  role: AppRole;
  status: AccountStatus;
}

export default function Users({ onNavigate, initialFilter = "total" }: UsersProps) {
  const [rows, setRows] = useState<UserProfileRow[]>([]);
  const [filter, setFilter] = useState<UserFilter>(initialFilter);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: profileError } = await supabase
      .from("user_profiles")
      .select("auth_user_id, full_name, email, role, status")
      .order("full_name", { ascending: true });
    if (profileError) {
      setRows([]);
      setError(profileError.message);
    } else {
      setRows((data as UserProfileRow[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("admin-users-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const filteredRows = useMemo(
    () => (filter === "active" ? rows.filter((row) => row.status === "active") : rows),
    [filter, rows],
  );

  return (
    <div className="absolute left-[256px] top-0 right-0 bottom-0 bg-gray-50 overflow-auto p-6">
      <div className="space-y-6 w-full max-w-none">
        <RoleIndicator />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-gray-900">Users</h2>
            <p className="text-gray-600">Review all registered dashboard and mobile users.</p>
          </div>
          {onNavigate && <NotificationDropdown onViewAll={() => onNavigate("notifications")} />}
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-50 p-2">
                <UsersIcon className="size-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-['Poppins:SemiBold',sans-serif] text-xl text-gray-900">User Accounts</h3>
                <p className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600">{loading ? "Loading..." : `${filteredRows.length} shown`}</p>
              </div>
            </div>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => setFilter("total")}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  filter === "total" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-700 hover:bg-white"
                }`}
              >
                Total
              </button>
              <button
                type="button"
                onClick={() => setFilter("active")}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  filter === "active" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-700 hover:bg-white"
                }`}
              >
                Active
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.map((user) => (
                  <tr key={user.auth_user_id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{user.full_name}</td>
                    <td className="px-4 py-3 text-gray-700">{user.email}</td>
                    <td className="px-4 py-3 text-gray-700 capitalize">{user.role.replace("_", " ")}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-medium capitalize text-gray-700">
                        {user.status.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-gray-500" colSpan={4}>No users found.</td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td className="px-4 py-6 text-gray-500" colSpan={4}>Loading users...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
