import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../services/supabaseClient";

export type AppRole = "admin" | "dispatcher" | "supervisor" | "truck_driver";
export type AccountStatus = "pending_approval" | "active" | "suspended" | "inactive";

export interface UserProfile {
  auth_user_id: string;
  full_name: string;
  email: string;
  role: AppRole;
  status: AccountStatus;
}

interface AuthContextValue {
  loading: boolean;
  session: any | null;
  profile: UserProfile | null;
  authError: string | null;
  signIn: (params: { email: string; password: string; role?: "admin" | "dispatcher" | "supervisor" }) => Promise<void>;
  signUp: (params: {
    fullName: string;
    contactNumber: string;
    email: string;
    password: string;
    role: "admin" | "dispatcher" | "supervisor";
  }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext(null as AuthContextValue | null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

async function fetchProfile(authUserId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("auth_user_id, full_name, email, role, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as UserProfile | null) ?? null;
}

function roleAllowedForWeb(role: AppRole) {
  return role === "admin" || role === "dispatcher" || role === "supervisor";
}

const WEB_SIGNUP_ROLES: Array<"admin" | "dispatcher" | "supervisor"> = ["admin", "dispatcher", "supervisor"];

export function AuthProvider({ children }: { children: any }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null as any | null);
  const [profile, setProfile] = useState(null as UserProfile | null);
  const [authError, setAuthError] = useState(null as string | null);

  const refresh = async (nextSession: any | null) => {
    setSession(nextSession);
    setAuthError(null);

    if (!nextSession?.user?.id) {
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
      const prof = await fetchProfile(nextSession.user.id);
      if (!prof) {
        await supabase.auth.signOut();
        setProfile(null);
        setAuthError("Account profile not found. Please contact the administrator.");
        setLoading(false);
        return;
      }
      if (prof.status !== "active") {
        await supabase.auth.signOut();
        setProfile(null);
        setAuthError("Your account is waiting for admin approval.");
        setLoading(false);
        return;
      }
      if (!roleAllowedForWeb(prof.role)) {
        await supabase.auth.signOut();
        setProfile(null);
        setAuthError("This account role is not allowed to access the web dashboard.");
        setLoading(false);
        return;
      }
      setProfile(prof);
      setLoading(false);
    } catch (e: any) {
      await supabase.auth.signOut();
      setProfile(null);
      setAuthError(e?.message ?? "Authentication failed.");
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      refresh(data.session ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      refresh(nextSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async ({
    email,
    password,
    role,
  }: {
    email: string;
    password: string;
    role?: "admin" | "dispatcher" | "supervisor";
  }) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
    if (data.user?.id) {
      const prof = await fetchProfile(data.user.id);
      if (!prof) {
        const profileError = new Error("Account profile not found. Please contact the administrator.");
        await supabase.auth.signOut();
        setAuthError(profileError.message);
        throw profileError;
      }
      if (prof.status !== "active") {
        const approvalError = new Error("Your account is waiting for admin approval.");
        await supabase.auth.signOut();
        setAuthError(approvalError.message);
        throw approvalError;
      }
      if (!roleAllowedForWeb(prof.role)) {
        const webRoleError = new Error("This account role is not allowed to access the web dashboard.");
        await supabase.auth.signOut();
        setAuthError(webRoleError.message);
        throw webRoleError;
      }
      if (role && prof.role !== role) {
        const roleError = new Error(`This account is registered as ${prof.role.replace("_", " ")}, not ${role}.`);
        await supabase.auth.signOut();
        setAuthError(roleError.message);
        throw roleError;
      }
    }
  };

  const signUp = async ({
    fullName,
    contactNumber,
    email,
    password,
    role,
  }: {
    fullName: string;
    contactNumber: string;
    email: string;
    password: string;
    role: "admin" | "dispatcher" | "supervisor";
  }) => {
    if (!WEB_SIGNUP_ROLES.includes(role)) {
      const invalidRoleError = new Error("Invalid role selected for web registration.");
      setAuthError(invalidRoleError.message);
      throw invalidRoleError;
    }
    setAuthError(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, contact_number: contactNumber, role } },
    });
    if (error) {
      setAuthError(error.message);
      throw error;
    }

    // Profile row is created in Postgres by trigger public.handle_new_auth_user()
    // on auth.users. Client upsert fails when email confirmation is on because
    // there is often no JWT yet (auth.uid() is null under RLS).
    if (data.session) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setProfile(null);
    setAuthError(null);
  };

  const signOut = async () => {
    setAuthError(null);
    await supabase.auth.signOut();
  };

  const value = useMemo(
    () => ({ loading, session, profile, authError, signIn, signUp, signOut }) as AuthContextValue,
    [loading, session, profile, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

