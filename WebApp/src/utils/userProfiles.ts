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

function notifyDriversUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ecoloop:drivers-updated"));
  }
}

async function ensureDriverRecordForProfile(params: {
  authUserId: string;
  profileId?: string | null;
  fullName?: string | null;
  phoneNumber?: string | null;
}) {
  const { authUserId, profileId = null, fullName, phoneNumber = null } = params;
  const cleanName = fullName?.trim() || "Truck Driver";
  const { data: existingDriver, error: selectError } = await supabase
    .from("drivers")
    .select("id, profile_id, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (selectError) throw selectError;

  if (!existingDriver) {
    const { error: upsertError } = await supabase.from("drivers").upsert(
      {
        auth_user_id: authUserId,
        profile_id: profileId,
        name: cleanName,
        status: "available",
        phone: phoneNumber,
        phone_number: phoneNumber,
        assigned_vehicle_id: null,
      },
      { onConflict: "auth_user_id" },
    );
    if (upsertError) throw upsertError;
  } else {
    const nextStatus =
      String(existingDriver.status ?? "").toLowerCase() === "offline"
        ? "available"
        : existingDriver.status;
    const { error: updateError } = await supabase
      .from("drivers")
      .update({
        profile_id: profileId ?? existingDriver.profile_id,
        name: cleanName,
        status: nextStatus,
        ...(phoneNumber ? { phone: phoneNumber, phone_number: phoneNumber } : {}),
      })
      .eq("id", existingDriver.id);
    if (updateError) throw updateError;
  }
}

export async function approveUserProfileByAuthId(authUserId: string) {
  const { data, error } = await supabase
    .from("user_profiles")
    .update({ status: "active", approved_at: new Date().toISOString() })
    .eq("auth_user_id", authUserId)
    .select("id, full_name, role, phone, phone_number")
    .maybeSingle();
  if (error) throw error;

  if (data?.role === "truck_driver") {
    await ensureDriverRecordForProfile({
      authUserId,
      profileId: data.id,
      fullName: data.full_name,
      phoneNumber: data.phone_number ?? data.phone ?? null,
    });
  }
  notifyDriversUpdated();
}

export async function suspendOrReactivateAccountByAuthId(authUserId: string, suspend: boolean) {
  const { data, error } = await supabase.rpc("admin_suspend_user_account", {
    p_auth_user_id: authUserId,
    p_suspend: suspend,
  });
  if (error) throw new Error(error.message || "Unable to update account suspension status.");
  notifyDriversUpdated();
  return data as {
    success: boolean;
    auth_user_id: string;
    status: AccountStatus;
    email: string | null;
    full_name: string | null;
    role: AppRole;
  };
}

export async function deleteUserAccountPermanentlyByAuthId(authUserId: string) {
  const { data, error } = await supabase.rpc("admin_delete_user_account", {
    p_auth_user_id: authUserId,
  });
  if (error) throw new Error(error.message || "Unable to permanently delete user account.");
  notifyDriversUpdated();
  return data as {
    success: boolean;
    deleted_auth_user_id: string;
    email: string | null;
    full_name: string | null;
    role: AppRole | null;
  };
}

export async function updateUserProfileStatusByAuthId(authUserId: string, status: AccountStatus) {
  if (status === "suspended") {
    await suspendOrReactivateAccountByAuthId(authUserId, true);
    return;
  }

  if (status === "active") {
    const { data: currentProfile } = await supabase
      .from("user_profiles")
      .select("id, full_name, role, status, phone, phone_number")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (currentProfile?.status === "suspended" || currentProfile?.status === "inactive") {
      await suspendOrReactivateAccountByAuthId(authUserId, false);
      if (currentProfile.role === "truck_driver") {
        await ensureDriverRecordForProfile({
          authUserId,
          profileId: currentProfile.id,
          fullName: currentProfile.full_name,
          phoneNumber: currentProfile.phone_number ?? currentProfile.phone ?? null,
        });
      }
      notifyDriversUpdated();
      return;
    }
  }

  const payload: Record<string, unknown> = { status };
  if (status === "active") {
    payload.approved_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from("user_profiles")
    .update(payload)
    .eq("auth_user_id", authUserId)
    .select("id, full_name, role, phone, phone_number")
    .maybeSingle();
  if (error) throw error;

  if (data?.role === "truck_driver" && status === "active") {
    await ensureDriverRecordForProfile({
      authUserId,
      profileId: data.id,
      fullName: data.full_name,
      phoneNumber: data.phone_number ?? data.phone ?? null,
    });
  }
  notifyDriversUpdated();
}

export async function updateUserProfileRoleByAuthId(authUserId: string, role: AppRole, fullName?: string) {
  const updatePayload: Record<string, unknown> = { role };
  if (role === "truck_driver") {
    updatePayload.status = "active";
    updatePayload.approved_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from("user_profiles")
    .update(updatePayload)
    .eq("auth_user_id", authUserId)
    .select("id, full_name, phone, phone_number")
    .maybeSingle();
  if (error) throw error;

  if (role === "truck_driver") {
    await ensureDriverRecordForProfile({
      authUserId,
      profileId: data?.id ?? null,
      fullName: fullName ?? data?.full_name,
      phoneNumber: data?.phone_number ?? data?.phone ?? null,
    });
  }
  notifyDriversUpdated();
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
  const { data: profileRow, error: profileError } = await supabase
    .from("user_profiles")
    .upsert(
      {
        auth_user_id: newUserId,
        full_name: trimmedName,
        email: normalizedEmail,
        role: params.role,
        status: "active",
        phone: trimmedPhone,
        phone_number: trimmedPhone,
        approved_at: nowIso,
      },
      { onConflict: "auth_user_id" },
    )
    .select("id")
    .maybeSingle();
  if (profileError) throw profileError;

  if (params.role === "truck_driver") {
    await ensureDriverRecordForProfile({
      authUserId: newUserId,
      profileId: profileRow?.id ?? null,
      fullName: trimmedName,
      phoneNumber: trimmedPhone,
    });
  }
  notifyDriversUpdated();

  return newUserId;
}
