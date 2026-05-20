import React, { useCallback, useEffect, useState } from "react";
import { UserCheck, RefreshCw } from "lucide-react";
import { supabase } from "../services/supabaseClient";
import type { AppRole, AccountStatus } from "../contexts/AuthContext";

type PageType = "dashboard" | "route-planning" | "vehicle-monitoring" | "reports" | "bin-locations" | "notifications" | "user-approvals";

interface UserApprovalsProps {
  onNavigate?: (page: PageType) => void;
}

interface ProfileRow {
  auth_user_id: string;
  full_name: string;
  email: string;
  role: AppRole;
  status: AccountStatus;
}

export default function UserApprovals({ onNavigate }: UserApprovalsProps) {
  const [rows, setRows] = useState([] as ProfileRow[]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null as string | null);
  const [error, setError] = useState(null as string | null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("user_profiles")
      .select("auth_user_id, full_name, email, role, status")
      .eq("status", "pending_approval")
      .order("full_name", { ascending: true });
    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data as ProfileRow[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("user-approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const approve = async (authUserId: string) => {
    setBusyId(authUserId);
    setError(null);
    const { error: uErr } = await supabase.from("user_profiles").update({ status: "active" }).eq("auth_user_id", authUserId);
    setBusyId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    await load();
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-4xl mx-auto p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="font-['Poppins:Bold',sans-serif] text-2xl text-gray-900">Pending accounts</h1>
            <p className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600 mt-1">
              Review people who registered on the web app. When you approve an account, they can sign in with the role they requested.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}

        {loading ? (
          <p className="text-gray-600 text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-gray-600 text-sm">No pending approvals.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li
                key={r.auth_user_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div>
                  <p className="font-['Poppins:SemiBold',sans-serif] text-gray-900">{r.full_name}</p>
                  <p className="text-sm text-gray-600">{r.email}</p>
                  <p className="text-xs text-gray-500 mt-1 capitalize">
                    Role: {r.role.replace("_", " ")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === r.auth_user_id}
                  onClick={() => void approve(r.auth_user_id)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <UserCheck className="size-4" />
                  {busyId === r.auth_user_id ? "Saving…" : "Approve"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate("dashboard")}
            className="mt-8 text-sm text-emerald-700 hover:underline"
          >
            ← Back to dashboard
          </button>
        )}
      </div>
    </div>
  );
}
