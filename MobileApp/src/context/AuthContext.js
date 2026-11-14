import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";
import { clearDriverLatestLocation } from "../services/liveLocation";

const AuthContext = createContext(null);

function isInvalidRefreshTokenError(error) {
  const msg = String(error?.message ?? error ?? "");
  return /invalid refresh token|refresh token not found/i.test(msg);
}

function isBenignSignOutError(error) {
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

function getMobileAccountBlockedMessage(status) {
  switch (String(status ?? "").toLowerCase()) {
    case "suspended":
      return "Your account has been suspended by an administrator. Contact an administrator to reactivate your access.";
    case "inactive":
      return "Your account is currently inactive. Contact an administrator for assistance.";
    case "rejected":
    case "declined":
      return "Your account registration was rejected. Please contact the administrator.";
    default:
      return "Account not active. Please contact the administrator.";
  }
}

async function clearSupabaseAuthStorage() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const authKeys = keys.filter(
      (key) => /^sb-.*-auth-token/i.test(key) || key === "supabase.auth.token"
    );
    if (authKeys.length > 0) {
      await AsyncStorage.multiRemove(authKeys);
    }
  } catch (storageErr) {
    console.warn("Unable to clear local auth storage keys:", storageErr?.message ?? storageErr);
  }
}

async function clearStaleLocalSession() {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Ignore local cleanup errors
  }
  await clearSupabaseAuthStorage();
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [driver, setDriver] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const signingUpRef = useRef(false);
  const suppressSignupSessionRef = useRef(false);
  const signingOutRef = useRef(false);
  const authSeqRef = useRef(0);
  const pendingLogoutReasonRef = useRef(null);

  const validateProfile = async (userId) => {
    if (!userId) {
      setProfile(null);
      return null;
    }
    let { data, error } = await supabase
      .from("user_profiles")
      .select("id, auth_user_id, role, status, full_name, email, phone_number, address")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (error) throw error;

    if (!data || (data.role === "truck_driver" && (data.status === "pending_approval" || data.status === "pending"))) {
      try {
        await supabase.rpc("ensure_current_driver_account");
      } catch {
        // Fallback query/upsert handled below if RPC is unavailable
      }
      const refreshed = await supabase
        .from("user_profiles")
        .select("id, auth_user_id, role, status, full_name, email, phone_number, address")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (!refreshed.error && refreshed.data) {
        data = refreshed.data;
      }
    }

    if (!data) {
      setProfile(null);
      throw new Error("Account profile not found. Please contact the administrator.");
    }
    if (data.role !== "truck_driver") {
      throw new Error("This account is not a Truck Driver account.");
    }
    if (data.status !== "active") {
      throw new Error(getMobileAccountBlockedMessage(data.status));
    }
    setProfile(data);
    return data;
  };

  const loadDriver = async (userId, accountProfile = null) => {
    if (!userId) {
      setDriver(null);
      return;
    }
    let { data, error } = await supabase
      .from("drivers")
      .select("id, name, status, auth_user_id, phone_number, address, assigned_vehicle_id")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      try {
        await supabase.rpc("ensure_current_driver_account");
      } catch {
        // Fallback direct insert below
      }
      const retry = await supabase
        .from("drivers")
        .select("id, name, status, auth_user_id, phone_number, address, assigned_vehicle_id")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (!retry.error && retry.data) {
        data = retry.data;
      } else if (accountProfile?.role === "truck_driver") {
        const inserted = await supabase
          .from("drivers")
          .insert({
            auth_user_id: userId,
            name: accountProfile.full_name || "Truck Driver",
            status: "available",
            phone_number: accountProfile.phone_number || null,
            address: accountProfile.address || null,
            assigned_vehicle_id: null,
          })
          .select("id, name, status, auth_user_id, phone_number, address, assigned_vehicle_id")
          .maybeSingle();
        if (!inserted.error && inserted.data) {
          data = inserted.data;
        }
      }
    }
    if (!data) {
      setDriver(null);
      throw new Error("Driver record not found. Please contact the administrator.");
    }
    if (data.status === "suspended") {
      throw new Error("Driver account is not active.");
    }
    setDriver(data);
    return data;
  };

  const driverIdRef = useRef(null);
  driverIdRef.current = driver?.id ?? null;

  const performSignOut = useCallback(async ({ reason = null } = {}) => {
    const seq = ++authSeqRef.current;
    signingOutRef.current = true;
    pendingLogoutReasonRef.current = reason;

    const currentDriverId = driverIdRef.current;
    if (currentDriverId) {
      try {
        await Promise.race([
          clearDriverLatestLocation({ driverId: currentDriverId }),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch (error) {
        console.warn("Unable to clear driver location during sign out:", error?.message);
      }
    }

    try {
      const presenceChannels = supabase
        .getChannels()
        .filter((ch) => typeof ch?.topic === "string" && ch.topic.endsWith(":drivers-presence"));
      presenceChannels.forEach((ch) => {
        try {
          supabase.removeChannel(ch);
        } catch {
          // Ignore channel cleanup failure during logout
        }
      });
    } catch {
      // Ignore channel lookup failure during logout
    }

    let remoteError = null;
    try {
      const result = await Promise.race([
        supabase.auth.signOut({ scope: "global" }),
        new Promise((resolve) =>
          setTimeout(() => resolve({ error: new Error("Timed out waiting for server sign-out.") }), 5000)
        ),
      ]);
      if (result?.error && !isBenignSignOutError(result.error)) {
        remoteError = result.error;
      }
    } catch (error) {
      if (!isBenignSignOutError(error)) {
        remoteError = error;
      }
    }

    try {
      const localResult = await supabase.auth.signOut({ scope: "local" });
      if (localResult?.error && !isBenignSignOutError(localResult.error)) {
        throw localResult.error;
      }
      await clearSupabaseAuthStorage();
    } catch (localErr) {
      if (seq === authSeqRef.current) {
        signingOutRef.current = false;
      }
      throw new Error(localErr?.message || "Unable to clear the local session cleanly. Please try again.");
    }

    if (seq === authSeqRef.current) {
      setSession(null);
      setProfile(null);
      setDriver(null);
      setLoading(false);
      if (remoteError && !reason) {
        pendingLogoutReasonRef.current = null;
        setAuthError(
          `Signed out on this device, though the server session could not be revoked cleanly: ${remoteError?.message ?? "network error"}`
        );
      } else {
        pendingLogoutReasonRef.current = null;
        setAuthError(reason);
      }
      signingOutRef.current = false;
    }
  }, []);

  const refreshAccount = async (nextSession) => {
    const seq = ++authSeqRef.current;

    if (!nextSession?.user?.id || signingOutRef.current) {
      const reason = pendingLogoutReasonRef.current;
      pendingLogoutReasonRef.current = null;
      setSession(null);
      setProfile(null);
      setDriver(null);
      setAuthError(reason);
      return;
    }

    setSession(nextSession);
    const accountProfile = await validateProfile(nextSession.user.id);
    if (seq !== authSeqRef.current || signingOutRef.current) return;
    if (!accountProfile) {
      return;
    }
    await loadDriver(nextSession.user.id, accountProfile);
    if (seq !== authSeqRef.current || signingOutRef.current) {
      setSession(null);
      setProfile(null);
      setDriver(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted || signingOutRef.current) return;
      if (error) {
        if (isInvalidRefreshTokenError(error)) {
          await clearStaleLocalSession();
          setSession(null);
          setProfile(null);
          setDriver(null);
          setAuthError(null);
          setLoading(false);
          return;
        }
        console.warn("Failed loading session:", error.message);
      }
      const currentSession = data?.session ?? null;
      try {
        setAuthError(null);
        await refreshAccount(currentSession);
      } catch (driverError) {
        if (isInvalidRefreshTokenError(driverError)) {
          await clearStaleLocalSession();
          setAuthError(null);
        } else {
          setAuthError(driverError.message);
          await clearStaleLocalSession();
        }
        setSession(null);
        setProfile(null);
        setDriver(null);
      } finally {
        if (mounted) setLoading(false);
      }
    });

    const { data: authSubscription } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (!mounted) return;
      if (signingUpRef.current || suppressSignupSessionRef.current) {
        setAuthError(null);
        setSession(null);
        setProfile(null);
        setDriver(null);
        if (nextSession?.user?.id) {
          await clearStaleLocalSession();
        }
        return;
      }

      if (event === "SIGNED_OUT") {
        await clearSupabaseAuthStorage();
        if (signingOutRef.current) {
          return;
        }
        await refreshAccount(null);
        return;
      }

      if (signingOutRef.current) {
        return;
      }

      try {
        setAuthError(null);
        await refreshAccount(nextSession);
      } catch (driverError) {
        if (isInvalidRefreshTokenError(driverError)) {
          await clearStaleLocalSession();
          setAuthError(null);
        } else {
          setAuthError(driverError.message);
          await clearStaleLocalSession();
        }
        setSession(null);
        setProfile(null);
        setDriver(null);
      }
    });

    return () => {
      mounted = false;
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profile?.id || !session?.user?.id) return undefined;

    const profileChannel = supabase
      .channel(`mobile-profile-watch-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_profiles", filter: `id=eq.${profile.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            void performSignOut({
              reason: "Your account was permanently deleted by an administrator.",
            });
            return;
          }
          const updated = payload.new;
          if (!updated) return;
          if (updated.role !== "truck_driver") {
            void performSignOut({ reason: "This account is no longer assigned the Truck Driver role." });
            return;
          }
          if (updated.status !== "active") {
            void performSignOut({ reason: getMobileAccountBlockedMessage(updated.status) });
            return;
          }
          setProfile((current) => (current ? { ...current, ...updated } : current));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [performSignOut, profile?.id, session?.user?.id]);

  useEffect(() => {
    if (!driver?.id) return undefined;

    const channel = supabase
      .channel(`mobile-driver-status-${driver.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers", filter: `id=eq.${driver.id}` },
        (payload) => setDriver((current) => (current ? { ...current, ...payload.new } : current)),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id]);

  useEffect(() => {
    if (!driver?.id) return undefined;

    const touchLastSeen = async () => {
      try {
        await supabase
          .from("drivers")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", driver.id);
      } catch {
        /* non-fatal network error */
      }
    };

    if (AppState.currentState === "active") {
      void touchLastSeen();
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void touchLastSeen();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [driver?.id]);

  const setDriverStatus = useCallback((status) => {
    setDriver((current) => (current ? { ...current, status } : current));
  }, []);

  const signIn = async ({ email, password }) => {
    signingOutRef.current = false;
    pendingLogoutReasonRef.current = null;
    signingUpRef.current = false;
    suppressSignupSessionRef.current = false;
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
    if (data?.session) {
      try {
        await refreshAccount(data.session);
      } catch (accountError) {
        await performSignOut({ reason: accountError?.message || "Unable to sign in." }).catch(() => null);
        throw accountError;
      }
    }
  };

  const signUp = async ({ email, password, name, fullName, phoneNumber }) => {
    const cleanedName = (fullName ?? name ?? "").trim();
    const cleanedEmail = email.trim().toLowerCase();
    const cleanedPhone = (phoneNumber ?? "").trim();

    if (!cleanedName || !cleanedEmail || !password || !cleanedPhone) {
      throw new Error("Full name, email, password, and phone number are required.");
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }

    setAuthError(null);
    signingOutRef.current = false;
    pendingLogoutReasonRef.current = null;
    signingUpRef.current = true;
    suppressSignupSessionRef.current = false;
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanedEmail,
        password,
        options: {
          data: {
            full_name: cleanedName,
            phone_number: cleanedPhone,
            contact_number: cleanedPhone,
            role: "truck_driver",
          },
        },
      });
      if (error) throw error;

      // Profile and driver rows are created as active by public.handle_new_auth_user().
      if (data?.session) {
        try {
          await supabase.rpc("ensure_current_driver_account");
        } catch {
          // Trigger already created active profile and driver rows
        }
        await refreshAccount(data.session);
      }
      return data;
    } finally {
      signingUpRef.current = false;
    }
  };

  const signOut = useCallback(async () => {
    await performSignOut({ reason: null });
  }, [performSignOut]);

  const value = useMemo(
    () => ({
      session,
      driver,
      profile,
      loading,
      authError,
      signIn,
      signUp,
      signOut,
      setDriverStatus,
    }),
    [session, driver, profile, loading, authError, signOut, setDriverStatus],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

