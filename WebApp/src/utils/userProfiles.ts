import { createClient } from "@supabase/supabase-js";
import type { AccountStatus, AppRole } from "../contexts/AuthContext";
import { supabase } from "../services/supabaseClient";

export interface AdminUserProfileRow {
  auth_user_id: string;
  full_name: string;
  email: string;
  role: AppRole;
  status: AccountStatus;
  created_at?: string | null;
}

export function isPendingAccountStatus(status?: string | null): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "pending_approval" || normalized === "pending";
}

export function formatAccountStatusLabel(status?: string | null): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "pending_approval" || normalized === "pending") return "Pending Approval";
  if (normalized === "active") return "Active";
  if (normalized === "suspended") return "Suspended";
  if (normalized === "inactive") return "Inactive";
  return status ? String(status).replace(/_/g, " ") : "Unknown";
}

export function accountStatusBadgeClass(status?: string | null): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "pending_approval" || normalized === "pending") {
    return "bg-amber-100 text-amber-800 border border-amber-200";
  }
  if (normalized === "active") {
    return "bg-emerald-100 text-emerald-800 border border-emerald-200";
  }
  if (normalized === "suspended") {
    return "bg-red-100 text-red-800 border border-red-200";
  }
  return "bg-gray-100 text-gray-700 border border-gray-200";
}

export function formatAccountRoleLabel(role?: string | null): string {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "truck_driver") return "Truck Driver";
  if (normalized === "admin") return "Admin";
  if (normalized === "dispatcher") return "Dispatcher";
  if (normalized === "supervisor") return "Supervisor";
  return role ? String(role).replace(/_/g, " ") : "Unknown";
}

export async function fetchAdminUserProfiles(options?: { pendingOnly?: boolean }) {
  let query = supabase
    .from("user_profiles")
    .select("auth_user_id, full_name, email, role, status, created_at")
    .order("created_at", { ascending: false });

  if (options?.pendingOnly) {
    query = query.eq("status", "pending_approval");
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as AdminUserProfileRow[]) ?? [];
}

export async function approveUserProfileByAuthId(authUserId: string) {
  const { error } = await supabase
    .from("user_profiles")
    .update({ status: "active", approved_at: new Date().toISOString() })
    .eq("auth_user_id", authUserId);
  if (error) throw error;
}

export async function updateUserProfileStatusByAuthId(authUserId: string, status: AccountStatus) {
  const payload: Record<string, unknown> = { status };
  if (status === "active") {
    payload.approved_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from("user_profiles")
    .update(payload)
    .eq("auth_user_id", authUserId);
  if (error) throw error;
}

export async function updateUserProfileRoleByAuthId(authUserId: string, role: AppRole, fullName?: string) {
  const { error } = await supabase
    .from("user_profiles")
    .update({ role })
    .eq("auth_user_id", authUserId);
  if (error) throw error;

  if (role === "truck_driver") {
    const { data: existingDriver } = await supabase
      .from("drivers")
      .select("id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (!existingDriver) {
      await supabase.from("drivers").insert({
        auth_user_id: authUserId,
        name: fullName?.trim() || "Truck Driver",
        status: "available",
      });
    }
  }
}

export async function createStaffAccountByAdmin(params: {
  fullName: string;
  email: string;
  password: string;
  role: AppRole;
  phoneNumber?: string;
}) {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error("Supabase configuration is missing.");
  }

  const isolatedClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "ecoloop-admin-provision-client",
    },
  });

  const normalizedEmail = params.email.trim().toLowerCase();
  const trimmedName = params.fullName.trim();
  const trimmedPhone = params.phoneNumber?.trim() || null;

  const { data: signUpData, error: signUpError } = await isolatedClient.auth.signUp({
    email: normalizedEmail,
    password: params.password,
    options: {
      data: {
        full_name: trimmedName,
        role: params.role,
        phone_number: trimmedPhone,
      },
    },
  });

  if (signUpError) throw signUpError;
  const newUserId = signUpData.user?.id;
  if (!newUserId) {
    throw new Error("Account creation did not return a user ID.");
  }

  const nowIso = new Date().toISOString();
  const { error: profileError } = await supabase
    .from("user_profiles")
    .upsert(
      {
        auth_user_id: newUserId,
        full_name: trimmedName,
        email: normalizedEmail,
        role: params.role,
        status: "active",
        approved_at: nowIso,
      },
      { onConflict: "auth_user_id" },
    );
  if (profileError) throw profileError;

  if (params.role === "truck_driver") {
    const { data: existingDriver } = await supabase
      .from("drivers")
      .select("id")
      .eq("auth_user_id", newUserId)
      .maybeSingle();
    if (!existingDriver) {
      await supabase.from("drivers").insert({
        auth_user_id: newUserId,
        name: trimmedName,
        status: "available",
        phone_number: trimmedPhone,
      });
    }
  }

  return newUserId;
}
