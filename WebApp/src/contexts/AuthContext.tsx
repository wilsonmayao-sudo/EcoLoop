import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient";
import { getRuntimeSystemSettings, subscribeRuntimeSettings } from "../utils/systemSettings";

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

export function AuthProvider({ children }: { children: any }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null as any | null);
  const [profile, setProfile] = useState(null as UserProfile | null);
  const [authError, setAuthError] = useState(null as string | null);
  const pendingLogoutReasonRef = useRef<string | null>(null);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState<number>(
    () => getRuntimeSystemSettings().securityConfig.idleTimeoutMinutes,
  );

  const refresh = async (nextSession: any | null) => {
    setSession(nextSession);

    if (!nextSession?.user?.id) {
      const reason = pendingLogoutReasonRef.current;
      pendingLogoutReasonRef.current = null;
      setAuthError(reason);
      setProfile(null);
      setLoading(false);
      return;
    }

    setAuthError(null);

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

  useEffect(() => {
    return subscribeRuntimeSettings(() => {
      setIdleTimeoutMinutes(getRuntimeSystemSettings().securityConfig.idleTimeoutMinutes);
    });
  }, []);

  useEffect(() => {
    if (!session?.user?.id || !profile?.auth_user_id || idleTimeoutMinutes <= 0) {
      return undefined;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutMs = idleTimeoutMinutes * 60 * 1000;

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        pendingLogoutReasonRef.current = `Signed out automatically after ${idleTimeoutMinutes} minutes of inactivity.`;
        void supabase.auth.signOut().catch(() => {
          setAuthError(pendingLogoutReasonRef.current);
          pendingLogoutReasonRef.current = null;
        });
      }, timeoutMs);
    };

    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "touchstart", "focus"];
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [idleTimeoutMinutes, profile?.auth_user_id, session?.user?.id]);

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
    }
  };

  const signOut = async () => {
    setAuthError(null);
    await supabase.auth.signOut();
  };

  const value = useMemo(
    () => ({ loading, session, profile, authError, signIn, signOut }) as AuthContextValue,
    [loading, session, profile, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

