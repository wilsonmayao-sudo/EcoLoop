import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);
const APPROVAL_PENDING_MESSAGE = "Your account is still waiting for admin approval.";

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

  const validateProfile = async (userId) => {
    if (!userId) {
      setProfile(null);
      return null;
    }
    const { data, error } = await supabase
      .from("user_profiles")
      .select("auth_user_id, role, status, full_name, email, phone_number, address")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      setProfile(null);
      throw new Error(APPROVAL_PENDING_MESSAGE);
    }
    if (data.status === "pending_approval" || data.status === "pending") {
      throw new Error(APPROVAL_PENDING_MESSAGE);
    }
    if (data.status === "rejected" || data.status === "declined") {
      throw new Error("Your account registration was rejected. Please contact the administrator.");
    }
    if (data.status !== "active") {
      throw new Error("Account not active. Please contact the administrator.");
    }
    if (data.role !== "truck_driver") {
      throw new Error("This account is not a Truck Driver account.");
    }
    setProfile(data);
    return data;
  };

  const loadDriver = async (userId) => {
    if (!userId) {
      setDriver(null);
      return;
    }
    const { data, error } = await supabase
      .from("drivers")
      .select("id, name, status, auth_user_id, phone_number, address")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      setDriver(null);
      throw new Error("Driver record not found. Please contact the administrator.");
    }
    if (data.status === "inactive" || data.status === "suspended") {
      throw new Error("Driver account is not active.");
    }
    setDriver(data);
    return data;
  };

  const refreshAccount = async (nextSession) => {
    setSession(nextSession);
    if (!nextSession?.user?.id) {
      setProfile(null);
      setDriver(null);
      return;
    }
    const accountProfile = await validateProfile(nextSession.user.id);
    if (!accountProfile) {
      return;
    }
    await loadDriver(nextSession.user.id);
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return;
      if (error) console.warn("Failed loading session:", error.message);
      const currentSession = data?.session ?? null;
      try {
        setAuthError(null);
        await refreshAccount(currentSession);
      } catch (driverError) {
        setAuthError(driverError.message);
        await supabase.auth.signOut();
      } finally {
        setLoading(false);
      }
    });

    const { data: authSubscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (signingUpRef.current || suppressSignupSessionRef.current) {
        setAuthError(null);
        setSession(null);
        setProfile(null);
        setDriver(null);
        if (nextSession?.user?.id) {
          await supabase.auth.signOut();
        }
        return;
      }

      try {
        setAuthError(null);
        await refreshAccount(nextSession);
      } catch (driverError) {
        setAuthError(driverError.message);
        await supabase.auth.signOut();
      }
    });

    return () => {
      mounted = false;
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = async ({ email, password }) => {
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
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        setDriver(null);
        setAuthError(accountError.message);
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
    signingUpRef.current = true;
    suppressSignupSessionRef.current = true;
    try {
      const { error } = await supabase.auth.signUp({
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

      // Profile and driver rows are created by public.handle_new_auth_user().
      // Do not refresh account data here; the account is still pending approval.
      await supabase.auth.signOut();
      setAuthError(null);
      setSession(null);
      setProfile(null);
      setDriver(null);
    } finally {
      signingUpRef.current = false;
    }
  };

  const signOut = async () => {
    setAuthError(null);
    await supabase.auth.signOut();
  };

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
    }),
    [session, driver, profile, loading, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

