import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, UserCheck, UserX, Users as UsersIcon, X } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import CustomSelect from "../components/ui/CustomSelect";
import { supabase } from "../services/supabaseClient";
import type { AccountStatus, AppRole } from "../contexts/AuthContext";
import { formatDateOnly, formatDateTime, type PageType } from "../hooks/useLiveData";
import { getRuntimeSystemSettings, subscribeRuntimeSettings } from "../utils/systemSettings";
import {
  accountStatusBadgeClass,
  approveUserProfileByAuthId,
  createStaffAccountByAdmin,
  fetchAdminUserProfiles,
  formatAccountRoleLabel,
  formatAccountStatusLabel,
  isPendingAccountStatus,
  updateUserProfileRoleByAuthId,
  updateUserProfileStatusByAuthId,
  type AdminUserProfileRow,
} from "../utils/userProfiles";

type UserFilter = "total" | "pending" | "active";

interface UsersProps {
  onNavigate?: (page: PageType) => void;
  initialFilter?: UserFilter;
  role?: AppRole;
}

const ROLE_SELECT_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "supervisor", label: "Supervisor" },
  { value: "truck_driver", label: "Truck Driver" },
];

export default function Users({ onNavigate, initialFilter = "total", role = "admin" }: UsersProps) {
  const [rows, setRows] = useState<AdminUserProfileRow[]>([]);
  const [filter, setFilter] = useState<UserFilter>(initialFilter);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("dispatcher");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [minPasswordLength, setMinPasswordLength] = useState<number>(() =>
    Math.max(8, getRuntimeSystemSettings().securityConfig.minPasswordLength),
  );
  const isAdmin = role === "admin";

  useEffect(() => {
    return subscribeRuntimeSettings(() => {
      setMinPasswordLength(Math.max(8, getRuntimeSystemSettings().securityConfig.minPasswordLength));
    });
  }, []);

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const load = useCallback(async (showSpinner = true) => {
    if (!isAdmin) {
      setRows([]);
      setLoading(false);
      setError("Administrator role is required to view user accounts.");
      return;
    }
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUserProfiles();
      setRows(data);
    } catch (profileError: any) {
      setRows([]);
      setError(profileError?.message ?? "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load(true);
    if (!isAdmin) return undefined;
    const channel = supabase
      .channel(`admin-users-page-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, () => void load(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => void load(false))
      .subscribe();
    const handleRefresh = () => {
      if (document.visibilityState === "visible") {
        void load(false);
      }
    };
    const handleDriversUpdated = () => void load(false);
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
  }, [isAdmin, load]);

  const handleApprove = async (authUserId: string) => {
    if (!isAdmin) return;
    setBusyId(authUserId);
    setError(null);
    setSuccessMessage(null);
    try {
      await approveUserProfileByAuthId(authUserId);
      setSuccessMessage("Account approved and activated.");
      await load(false);
    } catch (approveErr: any) {
      setError(approveErr?.message ?? "Unable to approve account.");
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusChange = async (authUserId: string, nextStatus: AccountStatus) => {
    if (!isAdmin) return;
    setBusyId(authUserId);
    setError(null);
    setSuccessMessage(null);
    try {
      await updateUserProfileStatusByAuthId(authUserId, nextStatus);
      setSuccessMessage(`Account status updated to ${formatAccountStatusLabel(nextStatus)}.`);
      await load(false);
    } catch (statusErr: any) {
      setError(statusErr?.message ?? "Unable to update account status.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = async (user: AdminUserProfileRow, nextRole: AppRole) => {
    if (!isAdmin || user.role === nextRole) return;
    setBusyId(user.auth_user_id);
    setError(null);
    setSuccessMessage(null);
    try {
      await updateUserProfileRoleByAuthId(user.auth_user_id, nextRole, user.full_name);
      setSuccessMessage(`Updated ${user.full_name}'s role to ${formatAccountRoleLabel(nextRole)}.`);
      await load(false);
    } catch (roleErr: any) {
      setError(roleErr?.message ?? "Unable to update role.");
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateStaffAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setError(null);
    setSuccessMessage(null);
    if (!newFullName.trim() || !newEmail.trim() || newPassword.length < minPasswordLength) {
      setError(`Full name, valid email, and a password of at least ${minPasswordLength} characters are required.`);
      return;
    }
    setCreatingAccount(true);
    try {
      await createStaffAccountByAdmin({
        fullName: newFullName,
        email: newEmail,
        password: newPassword,
        role: newRole,
        phoneNumber: newPhone,
      });
      setShowCreateModal(false);
      setNewFullName("");
      setNewEmail("");
      setNewPassword("");
      setNewPhone("");
      setNewRole("dispatcher");
      setSuccessMessage(`Created active ${formatAccountRoleLabel(newRole)} account for ${newEmail.trim()}.`);
      await load(false);
    } catch (createErr: any) {
      setError(createErr?.message ?? "Unable to create staff account.");
    } finally {
      setCreatingAccount(false);
    }
  };

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "active" && row.status !== "active") return false;
      if (filter === "pending" && !isPendingAccountStatus(row.status)) return false;
      if (!query) return true;
      return (
        row.full_name.toLowerCase().includes(query) ||
        row.email.toLowerCase().includes(query) ||
        formatAccountRoleLabel(row.role).toLowerCase().includes(query)
      );
    });
  }, [filter, rows, searchQuery]);

  const pendingCount = useMemo(() => rows.filter((row) => isPendingAccountStatus(row.status)).length, [rows]);
  const activeCount = useMemo(() => rows.filter((row) => row.status === "active").length, [rows]);

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      <PageHeader
        title="Users"
        subtitle="Review all registered web and mobile accounts, roles, and approval status."
        icon={<UsersIcon className="size-5" aria-hidden="true" />}
        onNavigate={onNavigate as any}
        showDate={false}
      />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {successMessage && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successMessage}</div>}

      <div className="bg-white rounded-xl p-5 sm:p-6 border border-gray-200">
        <div className="flex flex-col gap-4 mb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">User Accounts</h2>
            <p className="text-xs sm:text-sm text-gray-600">{loading ? "Loading..." : `${filteredRows.length} shown of ${rows.length}`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccessMessage(null);
                  setShowCreateModal(true);
                }}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                <Plus className="size-4" aria-hidden="true" />
                Create Staff Account
              </button>
            )}
            <div className="relative min-w-[200px] flex-1 sm:flex-initial">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, email, role…"
                aria-label="Search user accounts"
                className="w-full min-h-[40px] rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => setFilter("total")}
                className={`min-h-[34px] px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  filter === "total" ? "bg-white text-emerald-800 shadow-xs font-semibold" : "text-gray-700 hover:bg-white"
                }`}
              >
                Total ({rows.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className={`min-h-[34px] px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  filter === "pending" ? "bg-white text-amber-800 shadow-xs font-semibold" : "text-gray-700 hover:bg-white"
                }`}
              >
                Pending ({pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter("active")}
                className={`min-h-[34px] px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  filter === "active" ? "bg-white text-emerald-800 shadow-xs font-semibold" : "text-gray-700 hover:bg-white"
                }`}
              >
                Active ({activeCount})
              </button>
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className="inline-flex min-h-[40px] items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto -mx-5 sm:mx-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-5 py-3 text-left font-semibold text-xs tracking-wider uppercase">Full Name</th>
                <th className="px-5 py-3 text-left font-semibold text-xs tracking-wider uppercase">Email</th>
                <th className="px-5 py-3 text-left font-semibold text-xs tracking-wider uppercase">Assigned Role</th>
                <th className="px-5 py-3 text-left font-semibold text-xs tracking-wider uppercase">Account Status</th>
                <th className="px-5 py-3 text-left font-semibold text-xs tracking-wider uppercase">Registration Date</th>
                <th className="px-5 py-3 text-right font-semibold text-xs tracking-wider uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-5 py-4"><div className="h-4 bg-gray-200 rounded w-28" /></td>
                    <td className="px-5 py-4"><div className="h-4 bg-gray-100 rounded w-40" /></td>
                    <td className="px-5 py-4"><div className="h-4 bg-gray-100 rounded w-20" /></td>
                    <td className="px-5 py-4"><div className="h-5 bg-gray-100 rounded-full w-24" /></td>
                    <td className="px-5 py-4"><div className="h-4 bg-gray-100 rounded w-24" /></td>
                    <td className="px-5 py-4"><div className="h-7 bg-gray-100 rounded w-16 ml-auto" /></td>
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-500">
                    No user accounts match the current filter.
                  </td>
                </tr>
              ) : (
                filteredRows.map((user) => {
                  const isPending = isPendingAccountStatus(user.status);
                  const isSuspended = String(user.status ?? "").toLowerCase() === "suspended";
                  return (
                    <tr key={user.auth_user_id} className={isPending ? "bg-amber-50/40 hover:bg-amber-50/70 transition-colors" : "hover:bg-gray-50/60 transition-colors"}>
                      <td className="px-5 py-3.5 font-medium text-gray-900">{user.full_name}</td>
                      <td className="px-5 py-3.5 text-gray-700">{user.email}</td>
                      <td className="px-5 py-3.5 text-gray-700 min-w-[165px]">
                        {isAdmin ? (
                          <CustomSelect
                            value={user.role}
                            onChange={(val) => void handleRoleChange(user, val as AppRole)}
                            options={ROLE_SELECT_OPTIONS}
                            disabled={busyId === user.auth_user_id}
                            size="sm"
                            ariaLabel={`Change role for ${user.full_name}`}
                          />
                        ) : (
                          formatAccountRoleLabel(user.role)
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${accountStatusBadgeClass(user.status)}`}>
                          {formatAccountStatusLabel(user.status)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-600 whitespace-nowrap tabular-nums" title={user.created_at ? formatDateTime(user.created_at) : undefined}>
                        {user.created_at ? formatDateOnly(user.created_at) : "Unavailable"}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          {isPending ? (
                            <>
                              <button
                                type="button"
                                disabled={busyId === user.auth_user_id}
                                onClick={() => void handleApprove(user.auth_user_id)}
                                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
                              >
                                <UserCheck className="size-3.5" aria-hidden="true" />
                                {busyId === user.auth_user_id ? "Saving..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === user.auth_user_id}
                                onClick={() => void handleStatusChange(user.auth_user_id, "suspended")}
                                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50"
                              >
                                <UserX className="size-3.5" aria-hidden="true" />
                                Reject
                              </button>
                            </>
                          ) : isSuspended ? (
                            <button
                              type="button"
                              disabled={busyId === user.auth_user_id}
                              onClick={() => void handleStatusChange(user.auth_user_id, "active")}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
                            >
                              <UserCheck className="size-3.5" aria-hidden="true" />
                              Reactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busyId === user.auth_user_id}
                              onClick={() => void handleStatusChange(user.auth_user_id, "suspended")}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
                            >
                              <UserX className="size-3.5" aria-hidden="true" />
                              Suspend
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Create Staff Account</h3>
                <p className="text-xs text-gray-600">Provision an active SWMO staff or driver account directly.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                aria-label="Close modal"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleCreateStaffAccount} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Full Name</label>
                <input
                  type="text"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Work Email</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="name@naga.gov.ph"
                  className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  Temporary Password (min {minPasswordLength} characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={minPasswordLength}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={`At least ${minPasswordLength} characters`}
                  className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Phone Number (optional)</label>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="09XX XXX XXXX"
                  className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">Assigned Role</label>
                <CustomSelect
                  value={newRole}
                  onChange={(val) => setNewRole(val as AppRole)}
                  options={ROLE_SELECT_OPTIONS}
                  ariaLabel="Assigned Role"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creatingAccount}
                  className="min-h-[38px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingAccount}
                  className="min-h-[38px] rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {creatingAccount ? "Creating..." : "Create Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
