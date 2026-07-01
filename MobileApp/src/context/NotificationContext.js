import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import {
  configureNotificationHandler,
  ensureAndroidRoutingChannel,
  presentLocalNotificationWhenAway,
  requestExpoNotificationPermissions,
  setIosBadgeCount,
} from "../services/localNotifications";

const NotificationContext = createContext();

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
};

const STORAGE_KEY = "notifications-enabled";

function notificationVisibleToUser(row, authUserId, appRole, unreadOnly = false) {
  if (!row || (unreadOnly && row.read)) return false;
  if (row.user_auth_id) return row.user_auth_id === authUserId;
  if (row.role != null && row.role !== "") return row.role === appRole;
  return false;
}

export const NotificationProvider = ({ children }) => {
  const [enabled, setEnabled] = useState(true);
  const { profile } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const appRole = profile?.role ?? null;
  const authUserId = profile?.auth_user_id ?? null;

  useEffect(() => {
    configureNotificationHandler();
    void ensureAndroidRoutingChannel();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored !== null) setEnabled(stored === "true");
      } catch {
        /* default enabled */
      }
    })();
  }, []);

  const toggle = useCallback(async () => {
    try {
      const next = !enabled;
      if (next) {
        await requestExpoNotificationPermissions();
        await ensureAndroidRoutingChannel();
      }
      setEnabled(next);
      await AsyncStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      if (!next) void setIosBadgeCount(0);
    } catch {
      /* preference may not persist */
    }
  }, [enabled]);

  const load = useCallback(async () => {
    if (!authUserId) {
      setItems([]);
      setError(null);
      return;
    }
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("notifications")
      .select("id, user_auth_id, role, title, message, type, category, source_table, source_id, read, created_at")
      .order("created_at", { ascending: false })
      .limit(80);
    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setItems([]);
      return;
    }
    setError(null);
    setItems((data ?? []).filter((row) => notificationVisibleToUser(row, authUserId, appRole)));
  }, [authUserId, appRole]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && authUserId) void load();
    });
    return () => sub.remove();
  }, [authUserId, load]);

  useEffect(() => {
    if (!authUserId) return undefined;

    const handlePayload = async (payload) => {
      if (payload.eventType === "INSERT" && payload.new) {
        const row = payload.new;
        if (enabled && notificationVisibleToUser(row, authUserId, appRole, true)) {
          await presentLocalNotificationWhenAway({
            id: row.id,
            title: row.title,
            body: row.message,
            data: { notificationId: row.id, category: row.category },
          });
        }
      }
      void load();
    };

    const channel = supabase
      .channel(`mobile-notifications-${authUserId}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, handlePayload)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, load, authUserId, appRole]);

  const displayItems = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      if (!!a.read !== !!b.read) return a.read ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [items]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  useEffect(() => {
    if (!enabled) {
      void setIosBadgeCount(0);
      return;
    }
    void setIosBadgeCount(unreadCount);
  }, [enabled, unreadCount]);

  const markRead = useCallback(
    async (id) => {
      if (!id) return;
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      const { error: uErr } = await supabase.from("notifications").update({ read: true }).eq("id", id);
      if (uErr) {
        await load();
        throw uErr;
      }
    },
    [load],
  );

  const markAllRead = useCallback(async () => {
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id).filter(Boolean);
    if (unreadIds.length === 0) return;

    setItems((prev) => prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read: true } : n)));
    const { error: uErr } = await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
    if (uErr) {
      await load();
      throw uErr;
    }
  }, [enabled, items, load]);

  const value = useMemo(
    () => ({
      enabled,
      toggle,
      items: displayItems,
      unreadCount,
      loading,
      error,
      reload: load,
      markRead,
      markAllRead,
    }),
    [enabled, toggle, displayItems, unreadCount, loading, error, load, markRead, markAllRead],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};
