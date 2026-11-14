import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Lock, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, UserMinus, Users } from "lucide-react";
import CustomSelect from "../ui/CustomSelect";
import ConfirmModal from "../feedback/ConfirmModal";
import PermanentDeleteAccountModal from "./PermanentDeleteAccountModal";
import { supabase } from "../../services/supabaseClient";
import {
  formatDateTime,
  type PageType,
  type RolePermission,
} from "../../hooks/useLiveData";
import {
  IDLE_TIMEOUT_OPTIONS,
  type IdleTimeoutOption,
  type SecurityConfigSetting,
  type SettingFieldErrors,
} from "../../utils/systemSettings";
import {
  accountStatusBadgeClass,
  deleteUserAccountPermanentlyByAuthId,
  fetchAdminUserProfiles,
  formatAccountRoleLabel,
  formatAccountStatusLabel,
  isPendingAccountStatus,
  suspendOrReactivateAccountByAuthId,
  type AdminUserProfileRow,
} from "../../utils/userProfiles";

interface AuditLogRow {
  id: number;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: unknown;
  new_data: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface SecurityAuditTabProps {
  draft: SecurityConfigSetting;
  fieldErrors: SettingFieldErrors;
  touched: Record<string, boolean>;
  rolePermissions: RolePermission[];
  isAdmin?: boolean;
  currentAuthUserId?: string | null;
  onChange: (next: SecurityConfigSetting) => void;
  onBlurField: (fieldKey: string) => void;
  onNavigate?: (page: PageType) => void;
}

const ROLE_ORDER = ["admin", "dispatcher", "supervisor", "truck_driver"] as const;

const PAGE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  "live-monitoring": "Live Monitoring",
  "area-management": "Areas & Bins",
  "route-planning": "Route Planning",
  reports: "Reports & Issues",
  notifications: "Notifications",
  users: "Users & Roles",
  "system-settings": "System Settings",
};

function summarizeAuditChange(row: AuditLogRow): string {
  const actorName =
    row.metadata && typeof row.metadata.actor_name === "string" && row.metadata.actor_name.trim()
      ? row.metadata.actor_name.trim()
      : null;
  const target = row.entity_id ? `${row.entity_type} (${row.entity_id})` : row.entity_type;
  return actorName ? `${actorName} · ${target}` : target;
}

/** Session timeout, password policy, read-only role matrix, and real audit log stream. */
export default function SecurityAuditTab({
  draft,
  fieldErrors,
  touched,
  rolePermissions,
  isAdmin = false,
  currentAuthUserId = null,
  onChange,
  onBlurField,
  onNavigate,
}: SecurityAuditTabProps) {
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditFilter, setAuditFilter] = useState<"all" | "system_settings">("all");
  const [accounts, setAccounts] = useState<AdminUserProfileRow[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountBusyId, setAccountBusyId] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [pendingSuspendTarget, setPendingSuspendTarget] = useState<{
    account: AdminUserProfileRow;
    suspend: boolean;
  } | null>(null);
  const [pendingDeleteTarget, setPendingDeleteTarget] = useState<AdminUserProfileRow | null>(null);
  const [accountSummary, setAccountSummary] = useState<{
    loading: boolean;
    active: number | null;
    pending: number | null;
    error: string | null;
  }>({ loading: true, active: null, pending: null, error: null });

  const loadSecurityTelemetry = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    setAccountSummary((prev) => ({ ...prev, loading: true, error: null }));

    const [auditRes, profilesRes] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("id, actor_user_id, actor_role, action, entity_type, entity_id, old_data, new_data, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      fetchAdminUserProfiles()
        .then((rows) => ({ data: rows, error: null }))
        .catch((err: any) => ({ data: null, error: err?.message ?? "Unable to summarize user accounts." })),
    ]);

    if (auditRes.error) {
      setAuditLogs([]);
      setAuditError(auditRes.error.message);
    } else {
      setAuditLogs((auditRes.data as AuditLogRow[]) ?? []);
    }
    setAuditLoading(false);

    if (profilesRes.error || !profilesRes.data) {
      setAccounts([]);
      setAccountSummary({
        loading: false,
        active: null,
        pending: null,
        error: profilesRes.error ?? "Account summary unavailable.",
      });
    } else {
      const pending = profilesRes.data.filter((u) => isPendingAccountStatus(u.status)).length;
      const active = profilesRes.data.filter((u) => String(u.status).toLowerCase() === "active").length;
      setAccounts(profilesRes.data);
      setAccountSummary({ loading: false, active, pending, error: null });
    }
  }, []);

  useEffect(() => {
    void loadSecurityTelemetry();
  }, [loadSecurityTelemetry]);

  const activeAdminCount = useMemo(
    () =>
      accounts.filter(
        (u) => u.role === "admin" && String(u.status ?? "").toLowerCase() === "active",
      ).length,
    [accounts],
  );

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return accounts;
    return accounts.filter(
      (u) =>
        u.full_name.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        formatAccountRoleLabel(u.role).toLowerCase().includes(query) ||
        formatAccountStatusLabel(u.status).toLowerCase().includes(query),
    );
  }, [accounts, accountSearch]);

  const handleConfirmSuspendToggle = async () => {
    if (!pendingSuspendTarget || !isAdmin) return;
    const { account, suspend } = pendingSuspendTarget;
    setAccountBusyId(account.auth_user_id);
    setAccountError(null);
    setAccountNotice(null);
    try {
      await suspendOrReactivateAccountByAuthId(account.auth_user_id, suspend);
      setAccountNotice(
        suspend
          ? `Suspended ${account.full_name || account.email}. Access is disabled while routes, driver profile, and operational history remain preserved.`
          : `Reactivated ${account.full_name || account.email}. Account access has been restored.`,
      );
      await loadSecurityTelemetry();
    } catch (err: any) {
      setAccountError(err?.message ?? "Unable to update account suspension state.");
      throw err;
    } finally {
      setAccountBusyId(null);
    }
  };

  const handleConfirmPermanentDelete = async (account: AdminUserProfileRow) => {
    if (!isAdmin) return;
    setAccountBusyId(account.auth_user_id);
    setAccountError(null);
    setAccountNotice(null);
    try {
      await deleteUserAccountPermanentlyByAuthId(account.auth_user_id);
      setAccountNotice(
        `Permanently deleted ${account.full_name || account.email}. Operational routes, deliveries, reports, and audit logs remain preserved.`,
      );
      await loadSecurityTelemetry();
    } catch (err: any) {
      setAccountError(err?.message ?? "Unable to permanently delete user account.");
      throw err;
    } finally {
      setAccountBusyId(null);
    }
  };

  const filteredAuditLogs = useMemo(() => {
    if (auditFilter === "system_settings") {
      return auditLogs.filter((row) => row.entity_type === "system_settings");
    }
    return auditLogs;
  }, [auditFilter, auditLogs]);

  const permissionMatrix = useMemo(() => {
    const pages = Array.from(new Set(rolePermissions.map((rp) => rp.page)));
    const lookup = new Map(rolePermissions.map((rp) => [`${rp.role}:${rp.page}`, rp]));
    return { pages, lookup };
  }, [rolePermissions]);

  const pwError = touched["security.minPasswordLength"] ? fieldErrors["security.minPasswordLength"] : undefined;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Session & Password Policies */}
        <section
          aria-labelledby="heading-session-security"
          className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <Lock className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="heading-session-security" className="text-base font-semibold text-gray-900">
                Session &amp; Password Policies
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Enforced directly in WebApp authentication state and admin user account creation.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="security-idle-timeout" className="block text-sm font-medium text-gray-800">
                Web Dashboard Idle Session Timeout
              </label>
              <p id="hint-idle-timeout" className="text-xs text-gray-500">
                Automatically signs out inactive web dashboard sessions after no mouse, keyboard, or focus activity.
              </p>
              <CustomSelect
                id="security-idle-timeout"
                value={String(draft.idleTimeoutMinutes)}
                ariaLabel="Web dashboard idle session timeout"
                options={IDLE_TIMEOUT_OPTIONS.map((opt) => ({
                  value: String(opt.value),
                  label: opt.label,
                }))}
                onChange={(val) =>
                  onChange({
                    ...draft,
                    idleTimeoutMinutes: Number(val) as IdleTimeoutOption,
                  })
                }
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="security-min-password" className="block text-sm font-medium text-gray-800">
                Minimum Staff Temporary Password Length
              </label>
              <p id="hint-min-password" className="text-xs text-gray-500">
                Applies when administrators provision new staff accounts in Users &amp; Roles (8 to 20 characters).
              </p>
              <input
                id="security-min-password"
                type="number"
                min={8}
                max={20}
                value={draft.minPasswordLength}
                aria-describedby={pwError ? "hint-min-password error-min-password" : "hint-min-password"}
                aria-invalid={Boolean(pwError)}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    minPasswordLength: Number(e.target.value),
                  })
                }
                onBlur={() => onBlurField("security.minPasswordLength")}
                className={`input-field ${pwError ? "border-red-500 ring-1 ring-red-500" : ""}`}
              />
              {pwError && (
                <p id="error-min-password" className="text-xs font-medium text-red-600">
                  {pwError}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Onboarding & Access Governance Summary */}
        <section
          aria-labelledby="heading-onboarding-security"
          className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
        >
          <div>
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <UserCheck className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h2 id="heading-onboarding-security" className="text-base font-semibold text-gray-900">
                  Account Approval &amp; RLS Boundary
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Truck Driver accounts activate immediately on registration, while non-driver staff accounts remain in{" "}
                  <code className="rounded bg-gray-100 px-1 text-xs">pending_approval</code> until an administrator activates them.
                </p>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3.5">
                <dt className="text-xs font-medium text-gray-500">Active Accounts</dt>
                <dd className="mt-1 text-xl font-bold text-gray-900 tabular-nums">
                  {accountSummary.loading ? "Checking…" : accountSummary.active ?? "Unavailable"}
                </dd>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5">
                <dt className="text-xs font-medium text-amber-800">Pending Approval</dt>
                <dd className="mt-1 text-xl font-bold text-amber-900 tabular-nums">
                  {accountSummary.loading ? "Checking…" : accountSummary.pending ?? "Unavailable"}
                </dd>
              </div>
            </dl>
            {accountSummary.error && <p className="mt-2 text-xs text-red-600">{accountSummary.error}</p>}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <span className="text-xs text-gray-500">
              Suspend or permanently remove accounts below, or open Users &amp; Roles to provision new staff.
            </span>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate("users")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50"
              >
                <span>Open Users &amp; Roles</span>
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Account Management: Suspend / Reactivate & Permanent Account Deletion */}
      <section aria-labelledby="heading-account-management" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
              <Users className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="heading-account-management" className="text-base font-semibold text-gray-900">
                Account Management
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Temporarily suspend accounts while preserving driver data and history, or permanently remove an account from authentication and system access.
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="text"
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              placeholder="Search user, email, role…"
              aria-label="Search accounts for management"
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
          </div>
        </div>

        {accountError && (
          <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
            {accountError}
          </div>
        )}
        {accountNotice && (
          <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
            {accountNotice}
          </div>
        )}

        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {accountSummary.loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                    Loading system accounts…
                  </td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                    {accounts.length === 0 ? "No accounts available." : "No accounts match your search filter."}
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((account) => {
                  const statusLower = String(account.status ?? "").toLowerCase();
                  const isSuspended = statusLower === "suspended";
                  const isSelf = Boolean(currentAuthUserId && account.auth_user_id === currentAuthUserId);
                  const isLastActiveAdmin =
                    account.role === "admin" && statusLower === "active" && activeAdminCount <= 1;
                  const actionDisabled =
                    !isAdmin || isSelf || isLastActiveAdmin || accountBusyId === account.auth_user_id;
                  const blockNote = !isAdmin
                    ? "Admin access required"
                    : isSelf
                      ? "Signed-in account"
                      : isLastActiveAdmin
                        ? "Last active admin protected"
                        : null;

                  return (
                    <tr key={account.auth_user_id} className="hover:bg-gray-50/70">
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-gray-900">{account.full_name || "Unnamed User"}</span>
                          {isSelf && (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                              You
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600">{account.email || "No email"}</p>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-gray-700">
                        {formatAccountRoleLabel(account.role)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${accountStatusBadgeClass(account.status)}`}>
                          {formatAccountStatusLabel(account.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          {blockNote ? (
                            <span className="text-xs text-gray-500">{blockNote}</span>
                          ) : (
                            <>
                              {isSuspended ? (
                                <button
                                  type="button"
                                  disabled={actionDisabled}
                                  onClick={() => setPendingSuspendTarget({ account, suspend: false })}
                                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                                >
                                  <UserCheck className="size-3.5" aria-hidden="true" />
                                  <span>Reactivate</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={actionDisabled}
                                  onClick={() => setPendingSuspendTarget({ account, suspend: true })}
                                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                                >
                                  <UserMinus className="size-3.5" aria-hidden="true" />
                                  <span>Suspend Account</span>
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={actionDisabled}
                                onClick={() => setPendingDeleteTarget(account)}
                                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                                <span>Delete Account</span>
                              </button>
                            </>
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
      </section>

      {/* Role & Permission Matrix (Read-only overview) */}
      <section aria-labelledby="heading-role-matrix" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="heading-role-matrix" className="text-base font-semibold text-gray-900">
                Role &amp; Module Permission Overview (Read-Only)
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Live view of <code className="rounded bg-gray-100 px-1 text-xs">public.role_permissions</code> paired
                with database Row Level Security policies.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Module / Page
                </th>
                {ROLE_ORDER.map((roleKey) => (
                  <th
                    key={roleKey}
                    scope="col"
                    className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                  >
                    {formatAccountRoleLabel(roleKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {permissionMatrix.pages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-gray-500">
                    No permission rows loaded.
                  </td>
                </tr>
              ) : (
                permissionMatrix.pages.map((pageKey) => (
                  <tr key={pageKey} className="hover:bg-gray-50/70">
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {PAGE_LABELS[pageKey] ?? pageKey}
                    </td>
                    {ROLE_ORDER.map((roleKey) => {
                      const perm = permissionMatrix.lookup.get(`${roleKey}:${pageKey}`);
                      const flags = [
                        perm?.can_read ? "R" : null,
                        perm?.can_create ? "C" : null,
                        perm?.can_update ? "U" : null,
                        perm?.can_delete ? "D" : null,
                      ].filter(Boolean);
                      return (
                        <td key={roleKey} className="px-4 py-2.5">
                          {flags.length > 0 ? (
                            <span className="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              {flags.join(" · ")}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">No access</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Audit Log Feed */}
      <section aria-labelledby="heading-audit-feed" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="heading-audit-feed" className="text-base font-semibold text-gray-900">
              Configuration &amp; System Audit Trail
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Latest events recorded in <code className="rounded bg-gray-100 px-1 text-xs">public.audit_logs</code>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setAuditFilter("all")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  auditFilter === "all" ? "bg-white text-gray-900 shadow-xs" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                All Events
              </button>
              <button
                type="button"
                onClick={() => setAuditFilter("system_settings")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  auditFilter === "system_settings"
                    ? "bg-white text-gray-900 shadow-xs"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Settings Only
              </button>
            </div>
            <button
              type="button"
              onClick={() => void loadSecurityTelemetry()}
              disabled={auditLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${auditLoading ? "animate-spin" : ""}`} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {auditError ? (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Unable to load audit logs: {auditError}
          </p>
        ) : filteredAuditLogs.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
            {auditLoading ? "Loading audit trail…" : "No audit log entries recorded yet."}
          </p>
        ) : (
          <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {filteredAuditLogs.map((row) => (
              <div key={row.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {row.action}
                    </span>
                    {row.actor_role && (
                      <span className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {formatAccountRoleLabel(row.actor_role)}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium text-gray-900">{summarizeAuditChange(row)}</span>
                  </div>
                </div>
                <div className="shrink-0 text-xs text-gray-500 tabular-nums">
                  {formatDateTime(row.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {pendingSuspendTarget && (
        <ConfirmModal
          isOpen={Boolean(pendingSuspendTarget)}
          onClose={() => setPendingSuspendTarget(null)}
          onConfirm={handleConfirmSuspendToggle}
          title={pendingSuspendTarget.suspend ? "Suspend Account" : "Reactivate Account"}
          message={
            pendingSuspendTarget.suspend
              ? `Suspend ${pendingSuspendTarget.account.full_name || pendingSuspendTarget.account.email}? They will immediately lose system access and active sessions will be revoked, while their profile, driver record, routes, and history remain intact.`
              : `Reactivate ${pendingSuspendTarget.account.full_name || pendingSuspendTarget.account.email}? They will immediately regain system access with their existing role and operational history intact.`
          }
          confirmText={pendingSuspendTarget.suspend ? "Suspend Account" : "Reactivate Account"}
          cancelText="Cancel"
          variant={pendingSuspendTarget.suspend ? "warning" : "info"}
        />
      )}

      <PermanentDeleteAccountModal
        account={pendingDeleteTarget}
        onClose={() => setPendingDeleteTarget(null)}
        onConfirmDelete={handleConfirmPermanentDelete}
      />
    </div>
  );
}
