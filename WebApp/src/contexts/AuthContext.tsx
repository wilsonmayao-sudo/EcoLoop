import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient";
import { getRuntimeSystemSettings, subscribeRuntimeSettings } from "../utils/systemSettings";

export type AppRole = "admin" | "dispatcher" | "supervisor" | "truck_driver";
export type AccountStatus = "pending_approval" | "active" | "suspended" | "inactive";

export interface UserProfile {
  id?: string;
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

function getInactiveAccountMessage(status: AccountStatus): string {
  switch (status) {
    case "suspended":
      return "Your account has been suspended by an administrator. Contact an administrator to reactivate your access.";
    case "inactive":
      return "Your account is currently inactive. Contact an administrator for assistance.";
    case "pending_approval":
      return "Your account is waiting for admin approval.";
    default:
      return "Your account is not active. Contact an administrator for assistance.";
  }
}

function isBenignSignOutError(error: any): boolean {
  const msg = String(error?.message ?? error ?? "").toLowerCase();
  const status = Number(error?.status ?? 0);
  return (
    status === 401 ||
    status === 403 ||
    msg.includes("auth session missing") ||
    msg.includes("session_not_found") ||
    msg.includes("session from session_id claim in jwt does not exist") ||
    msg.includes("invalid jwt")
  );
}

function clearBrowserAuthStorage() {
  const purge = (storage: Storage | undefined) => {
    if (!storage) return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (/^sb-.*-auth-token/i.test(key) || key === "supabase.auth.token") {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => storage.removeItem(key));
  };
  if (typeof window === "undefined") return;
  purge(window.localStorage);
  purge(window.sessionStorage);
}

async function fetchProfile(authUserId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, auth_user_id, full_name, email, role, status")
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
  const refreshSeqRef = useRef(0);
  const signingOutRef = useRef(false);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState<number>(
    () => getRuntimeSystemSettings().securityConfig.idleTimeoutMinutes,
  );

  const performSignOut = async (options?: { reason?: string | null }) => {
    const seq = ++refreshSeqRef.current;
    signingOutRef.current = true;
    const reason = options?.reason ?? null;
    pendingLogoutReasonRef.current = reason;

    let remoteError: any = null;
    try {
      const result = await Promise.race([
        supabase.auth.signOut({ scope: "global" }),
        new Promise<{ error: Error }>((resolve) =>
          setTimeout(() => resolve({ error: new Error("Timed out waiting for server sign-out.") }), 6000),
        ),
      ]);
      if (result?.error && !isBenignSignOutError(result.error)) {
        remoteError = result.error;
      }
    } catch (err: any) {
      if (!isBenignSignOutError(err)) {
        remoteError = err;
      }
    }

    try {
      const localResult = await supabase.auth.signOut({ scope: "local" });
      if (localResult?.error && !isBenignSignOutError(localResult.error)) {
        throw localResult.error;
      }
      clearBrowserAuthStorage();
    } catch (localErr: any) {
      if (seq === refreshSeqRef.current) {
        signingOutRef.current = false;
      }
      throw new Error(localErr?.message || "Unable to clear the local session cleanly. Please try again.");
    }

    if (seq === refreshSeqRef.current) {
      setSession(null);
      setProfile(null);
      setLoading(false);
      if (remoteError && !reason) {
        const notice = `Signed out on this device, though the server session could not be revoked remotely: ${remoteError?.message ?? "network error"}`;
        pendingLogoutReasonRef.current = null;
        setAuthError(notice);
      } else {
        pendingLogoutReasonRef.current = null;
        setAuthError(reason);
      }
      signingOutRef.current = false;
    }
  };

  const refresh = async (nextSession: any | null) => {
    const seq = ++refreshSeqRef.current;

    if (!nextSession?.user?.id || signingOutRef.current) {
      const reason = pendingLogoutReasonRef.current;
      pendingLogoutReasonRef.current = null;
      setSession(null);
      setProfile(null);
      setAuthError(reason);
      setLoading(false);
      return;
    }

    setSession(nextSession);
    setAuthError(null);

    try {
      const prof = await fetchProfile(nextSession.user.id);
      if (seq !== refreshSeqRef.current || signingOutRef.current) return;

      if (!prof) {
        await performSignOut({ reason: "Account profile not found or was removed. Please contact the administrator." });
        return;
      }
      if (!roleAllowedForWeb(prof.role)) {
        await performSignOut({ reason: "This account role is not allowed to access the web dashboard." });
        return;
      }
      if (prof.status !== "active") {
        await performSignOut({ reason: getInactiveAccountMessage(prof.status) });
        return;
      }
      setProfile(prof);
      setLoading(false);
    } catch (e: any) {
      if (seq !== refreshSeqRef.current || signingOutRef.current) return;
      await performSignOut({ reason: e?.message ?? "Authentication failed." });
    }
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted || signingOutRef.current) return;
      void refresh(data.session ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        clearBrowserAuthStorage();
        if (!signingOutRef.current) {
          void refresh(null);
        }
        return;
      }
      if (signingOutRef.current) return;
      void refresh(nextSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profile?.id || !session?.user?.id) return undefined;

    const channel = supabase
      .channel(`web-account-watch-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_profiles", filter: `id=eq.${profile.id}` },
        (payload: any) => {
          if (payload.eventType === "DELETE") {
            void performSignOut({
              reason: "Your account was permanently deleted by an administrator.",
            });
            return;
          }
          const updated = payload.new as UserProfile | undefined;
          if (!updated) return;
          if (updated.status !== "active") {
            void performSignOut({ reason: getInactiveAccountMessage(updated.status) });
            return;
          }
          if (!roleAllowedForWeb(updated.role)) {
            void performSignOut({ reason: "This account role no longer permits web dashboard access." });
            return;
          }
          setProfile((prev) => (prev ? { ...prev, ...updated } : prev));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile?.id, session?.user?.id]);

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
        const idleMsg = `Signed out automatically after ${idleTimeoutMinutes} minutes of inactivity.`;
        void performSignOut({ reason: idleMsg }).catch(() => {
          setAuthError(idleMsg);
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
    signingOutRef.current = false;
    pendingLogoutReasonRef.current = null;
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
    if (data.user?.id) {
      const prof = await fetchProfile(data.user.id);
      if (!prof) {
        const profileError = new Error("Account profile not found. Please contact the administrator.");
        await performSignOut({ reason: profileError.message }).catch(() => null);
        throw profileError;
      }
      if (!roleAllowedForWeb(prof.role) || (role && prof.role !== role)) {
        const webRoleError = new Error(
          role
            ? `This account does not have ${role} access.`
            : "This account role is not allowed to access the web dashboard.",
        );
        await performSignOut({ reason: webRoleError.message }).catch(() => null);
        throw webRoleError;
      }
      if (prof.status !== "active") {
        const statusError = new Error(getInactiveAccountMessage(prof.status));
        await performSignOut({ reason: statusError.message }).catch(() => null);
        throw statusError;
      }
    }
  };

  const signOut = async () => {
    await performSignOut({ reason: null });
  };

  const value = useMemo(
    () => ({ loading, session, profile, authError, signIn, signOut }) as AuthContextValue,
    [loading, session, profile, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

