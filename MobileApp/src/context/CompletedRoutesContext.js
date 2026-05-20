import React, { createContext, useState, useContext, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";

const CompletedRoutesContext = createContext();

export const useCompletedRoutes = () => {
  const context = useContext(CompletedRoutesContext);
  if (!context) {
    throw new Error('useCompletedRoutes must be used within a CompletedRoutesProvider');
  }
  return context;
};

export const CompletedRoutesProvider = ({ children }) => {
  const { driver } = useAuth();
  const [completedRoutes, setCompletedRoutes] = useState([]);

  const loadCompletedRoutes = useCallback(async () => {
    if (!driver?.id) {
      setCompletedRoutes([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("routes")
        .select("id, name, distance_km, duration_minutes, completed_at, deliveries!inner(id)")
        .eq("driver_id", driver.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false });
      if (error) throw error;
      const mapped = (data ?? []).map((route) => ({
        id: route.id,
        name: route.name,
        dateCompleted: route.completed_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        binsCollected: route.deliveries?.length ?? 0,
        distance: `${Number(route.distance_km ?? 0).toFixed(1)} km`,
        timeTaken: `${Math.max(1, Number(route.duration_minutes ?? 0))}m`,
      }));
      setCompletedRoutes(mapped);
    } catch (error) {
      console.error("Error loading completed routes:", error);
    }
  }, [driver?.id]);

  useEffect(() => {
    loadCompletedRoutes();
  }, [loadCompletedRoutes]);

  useEffect(() => {
    if (!driver?.id) return undefined;
    const channel = supabase
      .channel(`completed-routes-${driver.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "routes", filter: `driver_id=eq.${driver.id}` },
        () => loadCompletedRoutes(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, loadCompletedRoutes]);

  const addCompletedRoute = useCallback(async (_route) => {
    await loadCompletedRoutes();
  }, [loadCompletedRoutes]);

  const value = useMemo(() => ({
    completedRoutes,
    addCompletedRoute,
  }), [completedRoutes, addCompletedRoute]);

  return <CompletedRoutesContext.Provider value={value}>{children}</CompletedRoutesContext.Provider>;
};

