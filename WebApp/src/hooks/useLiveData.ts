import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../services/supabaseClient";
import { useAuth, type AppRole } from "../contexts/AuthContext";
import {
  formatDateOnly as formatSystemDateOnly,
  formatDateTime as formatSystemDateTime,
  relativeTime as formatSystemRelativeTime,
  resolveAllSystemSettings,
  syncRuntimeSystemSettings,
} from "../utils/systemSettings";

export type PageType =
  | "dashboard"
  | "live-monitoring"
  | "area-management"
  | "route-planning"
  | "reports"
  | "notifications"
  | "users"
  | "system-settings";

export interface BinRecord {
  id: string | number;
  code: string | null;
  location: string;
  barangay?: string | null;
  area_code?: string | null;
  schedule_days?: string[] | null;
  schedule_time_window?: string | null;
  waste_category?: string | null;
  collection_status?: string | null;
  coordinate_status?: string | null;
  is_active?: boolean | null;
  type?: string | null;
  status?: string | null;
  capacity_percent?: number | null;
  latitude: number | string | null;
  longitude: number | string | null;
  updated_at?: string | null;
}

export interface CollectionScheduleRecord {
  id: number;
  area_code: string;
  area_name: string;
  shift_label?: string | null;
  stop_order: number;
  location_name: string;
  stop_type: string;
  barangay?: string | null;
  days_of_week: string[];
  day_times: Record<string, string>;
  scheduled_time?: string | null;
  waste_category?: string | null;
  assigned_truck_note?: string | null;
  special_instructions?: string | null;
  bin_id?: number | string | null;
  latitude?: number | null;
  longitude?: number | null;
  coordinate_status: string;
  monitor_name?: string | null;
  source_reference?: string | null;
  source_page?: number | null;
  is_active: boolean;
}

export interface DriverRecord {
  id: string | number;
  name: string;
  status: string;
  auth_user_id?: string | null;
  assigned_vehicle_id?: string | number | null;
  last_seen_at?: string | null;
}

export interface RouteRecord {
  id: string;
  name: string;
  status: string;
  area_code?: string | null;
  scheduled_days?: string[] | null;
  shift_label?: string | null;
  waste_category?: string | null;
  distance_km?: number | null;
  duration_minutes?: number | null;
  driver_id?: string | number | null;
  vehicle_id?: string | number | null;
  center_lat?: number | null;
  center_lng?: number | null;
  generated_at?: string | null;
  assignment_updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RouteStopRecord {
  route_id: string;
  bin_id: string | number;
  stop_order: number;
  bins?: BinRecord | null;
}

export interface DeliveryRecord {
  id: string | number;
  route_id: string;
  bin_id?: string | number | null;
  driver_id?: string | number | null;
  status: string;
  eta?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
}

export interface VehicleRecord {
  id: string | number;
  code: string;
  truck_code?: string | null;
  plate_number?: string | null;
  label: string;
  model?: string | null;
  is_active?: boolean | null;
  status: string;
  driver_id?: string | number | null;
  route_id?: string | null;
  capacity_liters?: number | null;
  capacity_kg?: number | null;
  fuel_percent?: number | null;
  load_percent?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
}

export interface VehicleLocationRecord {
  id?: string | number | null;
  vehicle_id?: string | number | null;
  driver_id?: string | number | null;
  route_id?: string | number | null;
  latitude: number | string | null;
  longitude: number | string | null;
  speed_kph?: number | string | null;
  heading_deg?: number | string | null;
  accuracy_m?: number | string | null;
  updated_at?: string | null;
  recorded_at?: string | null;
  source?: "latest" | "gps_log";
}

export interface WasteReportRecord {
  id: string;
  report_id?: string | null;
  report_number: string;
  driver_id?: string | number | null;
  /** Problem category from the driver app (may mirror `type`). */
  report_type?: string | null;
  type: string;
  location: string;
  image_url?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  status: string;
  priority: string;
  description?: string | null;
  reported_by?: string | null;
  assigned_to?: string | null;
  bin_id?: string | number | null;
  route_id?: string | number | null;
  created_at: string;
  resolved_at?: string | null;
  updated_at?: string | null;
}

export interface NotificationRecord {
  id: string;
  /** Some DBs require NOT NULL `user_id`; mirror `user_auth_id` on insert when applicable. */
  user_id?: string | number | null;
  user_auth_id?: string | null;
  role?: AppRole | null;
  title: string;
  message: string;
  type: "info" | "warning" | "success" | "error" | string;
  category: "route" | "bin" | "truck" | "report" | "system" | string;
  source_table?: string | null;
  source_id?: string | null;
  read: boolean;
  created_at: string;
}

export interface MaintenanceRecord {
  id: string;
  vehicle_id: string | number;
  maintenance_type: string;
  scheduled_at: string;
  estimated_duration_minutes?: number | null;
  notes?: string | null;
  status: string;
  created_at: string;
}

export interface OverflowBinEntry {
  bin_id: string | number;
  stop_order: number;
  lat: number;
  lng: number;
  location: string;
}

export interface OverflowEventRecord {
  id: string;
  source_vehicle_id: string | number | null;
  source_driver_id: string | number | null;
  source_route_id: string | null;
  target_vehicle_id: string | number | null;
  target_driver_id: string | number | null;
  status: "pending" | "dispatched" | "accepted" | "declined" | "completed" | string;
  overflow_bins: OverflowBinEntry[];
  bins_count: number;
  distance_km: number | null;
  reassignment_metadata?: any;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
}

export interface ReferenceRecord {
  id: string;
  name: string;
  is_active?: boolean;
  sort_order?: number;
}

export type ReferenceTableName = "report_categories" | "maintenance_types" | "bin_types";

export interface RolePermission {
  role: AppRole;
  page: PageType;
  can_read: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface SystemSetting {
  key: string;
  value: any;
  description?: string | null;
}

export interface MapPoint {
  x: number;
  y: number;
}

const LIVE_TABLES = [
  "bins",
  "collection_schedules",
  "drivers",
  "routes",
  "route_stops",
  "deliveries",
  "vehicles",
  "maintenance_records",
  "waste_reports",
  "notifications",
  "system_settings",
  "role_permissions",
  "report_categories",
  "maintenance_types",
  "bin_types",
  "overflow_events",
];

const REFERENCE_TABLES = new Set<ReferenceTableName>(["report_categories", "maintenance_types", "bin_types"]);

export function formatDateOnly(value?: string | null) {
  return formatSystemDateOnly(value);
}

export function formatDateTime(value?: string | null) {
  return formatSystemDateTime(value);
}

export function relativeTime(value?: string | null) {
  return formatSystemRelativeTime(value);
}

export function normalizeStatus(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/\s+/g, "_");
}

export function isBinActive(bin?: Pick<BinRecord, "is_active" | "status"> | null): boolean {
  if (!bin) return false;
  if (bin.is_active === false) return false;
  const s = normalizeStatus(bin.status);
  return s !== "disabled" && s !== "inactive";
}

/** Some Supabase schemas require NOT NULL `user_id`; mirror `user_auth_id` when present. */
export function normalizeNotificationInsert(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  const authId = next.user_auth_id;
  if (authId != null && authId !== "" && (next.user_id === undefined || next.user_id === null)) {
    next.user_id = authId;
  }
  return next;
}

function tableError(error: any, table: string) {
  return error ? `${table}: ${error.message ?? "Unable to load data"}` : null;
}

const LOCATION_ROW_RETENTION_MS = 60 * 60 * 1000;

function locationTimestamp(value: Partial<VehicleLocationRecord>) {
  return value.updated_at ?? value.recorded_at ?? null;
}

function locationTimestampMs(value: Partial<VehicleLocationRecord>) {
  const ts = locationTimestamp(value);
  return ts ? new Date(ts).getTime() : 0;
}

function locationRowKey(value: Partial<VehicleLocationRecord>) {
  if (value.source === "latest" && value.vehicle_id != null) return `latest:${value.vehicle_id}`;
  if (value.vehicle_id != null) return `vehicle-log:${value.vehicle_id}`;
  if (value.driver_id != null) return `driver-log:${value.driver_id}`;
  return `log:${value.id ?? `${value.latitude}:${value.longitude}:${locationTimestamp(value)}`}`;
}

function normalizeLocationRows(rows: Partial<VehicleLocationRecord>[], source: "latest" | "gps_log"): VehicleLocationRecord[] {
  return rows
    .map((row) => ({ ...row, source }) as VehicleLocationRecord)
    .filter((row) => {
      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) && !(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001);
    });
}

function mergeVehicleLocationRows(prev: VehicleLocationRecord[], incoming: VehicleLocationRecord[]) {
  const cutoff = Date.now() - LOCATION_ROW_RETENTION_MS;
  const byKey = new Map<string, VehicleLocationRecord>();

  [...prev, ...incoming].forEach((row) => {
    const rowMs = locationTimestampMs(row);
    if (rowMs && rowMs < cutoff) return;
    const key = locationRowKey(row);
    const existing = byKey.get(key);
    if (!existing || locationTimestampMs(row) >= locationTimestampMs(existing)) {
      byKey.set(key, row);
    }
  });

  return Array.from(byKey.values())
    .sort((a, b) => locationTimestampMs(b) - locationTimestampMs(a))
    .slice(0, 300);
}

export function getRouteProgress(routeId: string, deliveries: DeliveryRecord[]) {
  const routeDeliveries = deliveries.filter((delivery) => String(delivery.route_id) === String(routeId));
  if (routeDeliveries.length === 0) return 0;
  const completed = routeDeliveries.filter((delivery) => normalizeStatus(delivery.status) === "completed").length;
  return Math.round((completed / routeDeliveries.length) * 100);
}

const COMPLETED_DELIVERY_STATUSES = new Set(["completed", "collected", "done"]);

/** Computes stop-level route completion counts and percentage across deliveries and route_stops. */
export function getRouteStopProgress(
  routeId: string,
  deliveries: DeliveryRecord[],
  routeStops: RouteStopRecord[],
): { progressPercent: number; completedStops: number; totalStops: number } {
  if (!routeId) {
    return { progressPercent: 0, completedStops: 0, totalStops: 0 };
  }
  const stopsForRoute = routeStops.filter((stop) => String(stop.route_id) === String(routeId));
  const deliveriesForRoute = deliveries.filter((delivery) => String(delivery.route_id) === String(routeId));
  const totalStops = stopsForRoute.length > 0 ? stopsForRoute.length : deliveriesForRoute.length;
  if (totalStops === 0) {
    return { progressPercent: 0, completedStops: 0, totalStops: 0 };
  }
  const completedDeliveries = deliveriesForRoute.filter((delivery) =>
    COMPLETED_DELIVERY_STATUSES.has(normalizeStatus(delivery.status)),
  );
  const completedBinIds = new Set(
    completedDeliveries
      .map((delivery) => (delivery.bin_id != null ? String(delivery.bin_id) : null))
      .filter((binId): binId is string => binId !== null),
  );
  const completedStops = Math.min(
    totalStops,
    completedBinIds.size > 0 ? completedBinIds.size : completedDeliveries.length,
  );
  return {
    progressPercent: Math.round((completedStops / totalStops) * 100),
    completedStops,
    totalStops,
  };
}

export function mapLatLngToPoint(
  lat: number | null | undefined,
  lng: number | null | undefined,
  bins: BinRecord[],
  additionalCoordinates: Array<{ lat: number | string | null | undefined; lng: number | string | null | undefined }> = [],
): MapPoint {
  const coordinates = [
    ...bins.map((bin) => ({ lat: Number(bin.latitude), lng: Number(bin.longitude) })),
    ...additionalCoordinates.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) })),
  ]
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || coordinates.length === 0) {
    return { x: 50, y: 50 };
  }
  const minLat = Math.min(...coordinates.map((point) => point.lat));
  const maxLat = Math.max(...coordinates.map((point) => point.lat));
  const minLng = Math.min(...coordinates.map((point) => point.lng));
  const maxLng = Math.max(...coordinates.map((point) => point.lng));
  const lngSpan = maxLng - minLng || 1;
  const latSpan = maxLat - minLat || 1;
  return {
    x: Math.min(92, Math.max(8, ((Number(lng) - minLng) / lngSpan) * 84 + 8)),
    y: Math.min(92, Math.max(8, (1 - (Number(lat) - minLat) / latSpan) * 84 + 8)),
  };
}

export function getSetting<T>(settings: SystemSetting[], key: string, fallback: T): T {
  const setting = settings.find((item) => item.key === key);
  return (setting?.value as T) ?? fallback;
}

const LEGACY_PAGE_ALIASES: Record<string, PageType> = {
  "supervisor-dashboard": "dashboard",
  "user-approvals": "users",
  "bin-locations": "area-management",
  "overflow-dispatch": "live-monitoring",
  "vehicle-monitoring": "live-monitoring",
};

export function normalizeWebPageKey(page: string): PageType {
  return LEGACY_PAGE_ALIASES[page] ?? (page as PageType);
}

export function useRolePermissions(role?: AppRole | null) {
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!role) {
      setPermissions([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("role_permissions")
      .select("role, page, can_read, can_create, can_update, can_delete")
      .eq("role", role)
      .order("page", { ascending: true });
    setLoading(false);
    if (error) {
      setError(error.message);
      setPermissions([]);
      return;
    }
    setError(null);
    setPermissions((data as RolePermission[]) ?? []);
  }, [role]);

  useEffect(() => {
    void load();
    if (!role) return undefined;
    const channel = supabase
      .channel(`role-permissions-${role}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "role_permissions", filter: `role=eq.${role}` }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, role]);

  const readablePages = useMemo(
    () => Array.from(new Set(permissions.filter((item) => item.can_read).map((item) => normalizeWebPageKey(String(item.page))))),
    [permissions],
  );

  return { permissions, readablePages, loading, error, reload: load };
}

function useLiveDataInternal() {
  const { profile } = useAuth();
  const [bins, setBins] = useState<BinRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [routeStops, setRouteStops] = useState<RouteStopRecord[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [vehicleLocations, setVehicleLocations] = useState<VehicleLocationRecord[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [reports, setReports] = useState<WasteReportRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [reportCategories, setReportCategories] = useState<ReferenceRecord[]>([]);
  const [maintenanceTypes, setMaintenanceTypes] = useState<ReferenceRecord[]>([]);
  const [binTypes, setBinTypes] = useState<ReferenceRecord[]>([]);
  const [allReportCategories, setAllReportCategories] = useState<ReferenceRecord[]>([]);
  const [allMaintenanceTypes, setAllMaintenanceTypes] = useState<ReferenceRecord[]>([]);
  const [allBinTypes, setAllBinTypes] = useState<ReferenceRecord[]>([]);
  const [overflowEvents, setOverflowEvents] = useState<OverflowEventRecord[]>([]);
  const [collectionSchedules, setCollectionSchedules] = useState<CollectionScheduleRecord[]>([]);

  const refreshVehicleLocations = useCallback(async () => {
    const [latestResult, gpsLogsResult] = await Promise.all([
      supabase
        .from("vehicle_locations_latest")
        .select("vehicle_id, driver_id, route_id, latitude, longitude, speed_kph, heading_deg, updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("vehicle_gps_logs")
        .select("id, vehicle_id, driver_id, route_id, latitude, longitude, speed_kph, heading_deg, accuracy_m, recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(100),
    ]);

    if (latestResult.error || gpsLogsResult.error) return;
    const incoming = mergeVehicleLocationRows(
      normalizeLocationRows((latestResult.data as VehicleLocationRecord[]) ?? [], "latest"),
      normalizeLocationRows((gpsLogsResult.data as VehicleLocationRecord[]) ?? [], "gps_log"),
    );
    setVehicleLocations((current) => mergeVehicleLocationRows(current, incoming));
  }, []);

  /**
   * Silently refreshes live fleet assignments and delivery stop progress without toggling `loading`,
   * so Live Monitoring updates in real time even if Supabase Realtime misses a table event or
   * historical tables exceed PostgREST's default 1000-row cap.
   */
  const refreshLiveProgress = useCallback(async () => {
    if (!profile?.auth_user_id) return;
    const [routesResult, driversResult, vehiclesResult] = await Promise.all([
      supabase
        .from("routes")
        .select(
          "id, name, status, area_code, scheduled_days, shift_label, waste_category, distance_km, duration_minutes, driver_id, vehicle_id, center_lat, center_lng, generated_at, assignment_updated_at, started_at, completed_at, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("drivers").select("id, name, status, auth_user_id, assigned_vehicle_id, last_seen_at").order("name", { ascending: true }),
      supabase.from("vehicles").select("id, code, truck_code, plate_number, label, model, is_active, status, driver_id, route_id, capacity_liters, capacity_kg, fuel_percent, latitude, longitude, last_seen_at, updated_at").order("label", { ascending: true }),
    ]);

    if (!driversResult.error && driversResult.data) {
      setDrivers(driversResult.data as DriverRecord[]);
    }
    if (!vehiclesResult.error && vehiclesResult.data) {
      setVehicles(vehiclesResult.data as VehicleRecord[]);
    }

    const latestRoutes = !routesResult.error && routesResult.data ? (routesResult.data as RouteRecord[]) : null;
    if (latestRoutes) {
      setRoutes((prev) => {
        const byId = new Map(prev.map((r) => [String(r.id), r]));
        latestRoutes.forEach((r) => byId.set(String(r.id), r));
        return Array.from(byId.values());
      });

      const targetRouteIds = latestRoutes.slice(0, 100).map((r) => r.id).filter(Boolean);
      if (targetRouteIds.length > 0) {
        const [stopsResult, deliveriesResult] = await Promise.all([
          supabase
            .from("route_stops")
            .select("route_id, bin_id, stop_order, bins(id, code, location, barangay, area_code, schedule_days, schedule_time_window, waste_category, collection_status, coordinate_status, is_active, type, status, capacity_percent, latitude, longitude)")
            .in("route_id", targetRouteIds)
            .order("stop_order", { ascending: true }),
          supabase
            .from("deliveries")
            .select("id, route_id, bin_id, driver_id, status, eta, completed_at, updated_at")
            .in("route_id", targetRouteIds)
            .order("updated_at", { ascending: false }),
        ]);

        const refreshedIdSet = new Set(targetRouteIds.map((id) => String(id)));

        if (!stopsResult.error && stopsResult.data) {
          const freshStops = (stopsResult.data as any[]).map((stop) => ({
            ...stop,
            bins: Array.isArray(stop.bins) ? stop.bins[0] ?? null : stop.bins ?? null,
          })) as RouteStopRecord[];
          setRouteStops((prev) => [
            ...prev.filter((s) => !refreshedIdSet.has(String(s.route_id))),
            ...freshStops,
          ]);
        }

        if (!deliveriesResult.error && deliveriesResult.data) {
          const freshDeliveries = deliveriesResult.data as DeliveryRecord[];
          setDeliveries((prev) => [
            ...prev.filter((d) => !refreshedIdSet.has(String(d.route_id))),
            ...freshDeliveries,
          ]);
        }
      }
    }
  }, [profile?.auth_user_id]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    if (!profile?.auth_user_id) {
      setLoading(false);
      hasLoadedOnceRef.current = false;
      return;
    }
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
    const [
      binsResult,
      driversResult,
      routesResult,
      routeStopsResult,
      deliveriesResult,
      vehiclesResult,
      latestLocationsResult,
      gpsLogsResult,
      maintenanceResult,
      reportsResult,
      notificationsResult,
      settingsResult,
      permissionsResult,
      allReportCategoriesResult,
      allMaintenanceTypesResult,
      allBinTypesResult,
      overflowEventsResult,
      collectionSchedulesResult,
    ] = await Promise.all([
      supabase.from("bins").select("id, code, location, barangay, area_code, schedule_days, schedule_time_window, waste_category, collection_status, coordinate_status, is_active, type, status, capacity_percent, latitude, longitude, updated_at").order("id", { ascending: true }),
      supabase.from("drivers").select("id, name, status, auth_user_id, assigned_vehicle_id, last_seen_at").order("name", { ascending: true }),
      supabase
        .from("routes")
        .select(
          "id, name, status, area_code, scheduled_days, shift_label, waste_category, distance_km, duration_minutes, driver_id, vehicle_id, center_lat, center_lng, generated_at, assignment_updated_at, started_at, completed_at, created_at, updated_at",
        )
        .order("created_at", { ascending: false }),
      supabase.from("route_stops").select("route_id, bin_id, stop_order, bins(id, code, location, barangay, area_code, schedule_days, schedule_time_window, waste_category, collection_status, coordinate_status, is_active, type, status, capacity_percent, latitude, longitude)").order("stop_order", { ascending: true }),
      supabase.from("deliveries").select("id, route_id, bin_id, driver_id, status, eta, completed_at, updated_at").order("updated_at", { ascending: false }),
      supabase.from("vehicles").select("id, code, truck_code, plate_number, label, model, is_active, status, driver_id, route_id, capacity_liters, capacity_kg, fuel_percent, latitude, longitude, last_seen_at, updated_at").order("label", { ascending: true }),
      supabase.from("vehicle_locations_latest").select("vehicle_id, driver_id, route_id, latitude, longitude, speed_kph, heading_deg, updated_at").order("updated_at", { ascending: false }),
      supabase.from("vehicle_gps_logs").select("id, vehicle_id, driver_id, route_id, latitude, longitude, speed_kph, heading_deg, accuracy_m, recorded_at").order("recorded_at", { ascending: false }).limit(200),
      supabase.from("maintenance_records").select("id, vehicle_id, maintenance_type, scheduled_at, estimated_duration_minutes, notes, status, created_at").order("scheduled_at", { ascending: false }),
      supabase
        .from("waste_reports")
        .select(
          "id, report_id, report_number, driver_id, report_type, type, location, image_url, latitude, longitude, status, priority, description, reported_by, assigned_to, bin_id, route_id, created_at, resolved_at, updated_at",
        )
        .order("created_at", { ascending: false }),
      supabase.from("notifications").select("id, user_auth_id, role, title, message, type, category, source_table, source_id, read, created_at").order("created_at", { ascending: false }),
      supabase.from("system_settings").select("key, value, description").order("key", { ascending: true }),
      supabase.from("role_permissions").select("role, page, can_read, can_create, can_update, can_delete").order("role", { ascending: true }),
      supabase.from("report_categories").select("id, name, is_active, sort_order").order("sort_order", { ascending: true }),
      supabase.from("maintenance_types").select("id, name, is_active, sort_order").order("sort_order", { ascending: true }),
      supabase.from("bin_types").select("id, name, is_active, sort_order").order("sort_order", { ascending: true }),
      supabase.from("overflow_events").select("id, source_vehicle_id, source_driver_id, source_route_id, target_vehicle_id, target_driver_id, status, overflow_bins, bins_count, distance_km, created_at, accepted_at, completed_at").order("created_at", { ascending: false }).limit(100),
      supabase.from("collection_schedules").select("id, area_code, area_name, shift_label, stop_order, location_name, stop_type, barangay, days_of_week, day_times, scheduled_time, waste_category, assigned_truck_note, special_instructions, bin_id, latitude, longitude, coordinate_status, monitor_name, source_reference, source_page, is_active").eq("is_active", true).order("area_code", { ascending: true }).order("stop_order", { ascending: true }),
    ]);

    const firstError = [
      tableError(binsResult.error, "bins"),
      tableError(driversResult.error, "drivers"),
      tableError(routesResult.error, "routes"),
      tableError(routeStopsResult.error, "route_stops"),
      tableError(deliveriesResult.error, "deliveries"),
      tableError(vehiclesResult.error, "vehicles"),
      tableError(latestLocationsResult.error, "vehicle_locations_latest"),
      tableError(gpsLogsResult.error, "vehicle_gps_logs"),
      tableError(maintenanceResult.error, "maintenance_records"),
      tableError(reportsResult.error, "waste_reports"),
      tableError(notificationsResult.error, "notifications"),
      tableError(settingsResult.error, "system_settings"),
      tableError(permissionsResult.error, "role_permissions"),
      tableError(allReportCategoriesResult.error, "report_categories"),
      tableError(allMaintenanceTypesResult.error, "maintenance_types"),
      tableError(allBinTypesResult.error, "bin_types"),
      overflowEventsResult.error?.code === "42P01" || overflowEventsResult.error?.code === "PGRST204"
        ? null
        : tableError(overflowEventsResult.error, "overflow_events"),
      collectionSchedulesResult.error?.code === "42P01" || collectionSchedulesResult.error?.code === "PGRST204"
        ? null
        : tableError(collectionSchedulesResult.error, "collection_schedules"),
    ].find(Boolean);

    const allReportCats = (allReportCategoriesResult.data as ReferenceRecord[]) ?? [];
    const allMaintTypes = (allMaintenanceTypesResult.data as ReferenceRecord[]) ?? [];
    const allBTypes = (allBinTypesResult.data as ReferenceRecord[]) ?? [];

    setBins((binsResult.data as BinRecord[]) ?? []);
    setDrivers((driversResult.data as DriverRecord[]) ?? []);
    setRoutes((routesResult.data as RouteRecord[]) ?? []);
    setRouteStops(((routeStopsResult.data ?? []) as any[]).map((stop) => ({
      ...stop,
      bins: Array.isArray(stop.bins) ? stop.bins[0] ?? null : stop.bins ?? null,
    })) as RouteStopRecord[]);
    setDeliveries((deliveriesResult.data as DeliveryRecord[]) ?? []);
    setVehicles((vehiclesResult.data as VehicleRecord[]) ?? []);
    setVehicleLocations(
      mergeVehicleLocationRows(
        normalizeLocationRows((latestLocationsResult.data as VehicleLocationRecord[]) ?? [], "latest"),
        normalizeLocationRows((gpsLogsResult.data as VehicleLocationRecord[]) ?? [], "gps_log"),
      ),
    );
    setMaintenanceRecords((maintenanceResult.data as MaintenanceRecord[]) ?? []);
    setReports((reportsResult.data as WasteReportRecord[]) ?? []);
    setNotifications((notificationsResult.data as NotificationRecord[]) ?? []);
    const loadedSettings = (settingsResult.data as SystemSetting[]) ?? [];
    syncRuntimeSystemSettings(loadedSettings);
    setSettings(loadedSettings);
    setRolePermissions((permissionsResult.data as RolePermission[]) ?? []);
    setReportCategories(allReportCats.filter((item) => item.is_active !== false));
    setMaintenanceTypes(allMaintTypes.filter((item) => item.is_active !== false));
    setBinTypes(allBTypes.filter((item) => item.is_active !== false));
    setAllReportCategories(allReportCats);
    setAllMaintenanceTypes(allMaintTypes);
    setAllBinTypes(allBTypes);
    setOverflowEvents((overflowEventsResult.data as OverflowEventRecord[]) ?? []);
    setCollectionSchedules((collectionSchedulesResult.data as CollectionScheduleRecord[]) ?? []);
    setError(firstError ?? null);
    hasLoadedOnceRef.current = true;
    setLoading(false);
  }, [profile?.auth_user_id]);

  const loadRef = useRef<() => Promise<void>>(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!profile?.auth_user_id) {
      setBins([]);
      setDrivers([]);
      setRoutes([]);
      setRouteStops([]);
      setDeliveries([]);
      setVehicles([]);
      setVehicleLocations([]);
      setMaintenanceRecords([]);
      setReports([]);
      setNotifications([]);
      setSettings([]);
      setRolePermissions([]);
      setReportCategories([]);
      setMaintenanceTypes([]);
      setBinTypes([]);
      setAllReportCategories([]);
      setAllMaintenanceTypes([]);
      setAllBinTypes([]);
      setOverflowEvents([]);
      setCollectionSchedules([]);
      setError(null);
      setLoading(false);
      return undefined;
    }

    void load();
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleCoalescedLoad = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void loadRef.current();
      }, 300);
    };

    const channel = supabase.channel(`webapp-live-data-${profile.auth_user_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    LIVE_TABLES.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload: any) => {
        if (table === "drivers" && payload?.eventType === "UPDATE" && payload?.new) {
          setDrivers((prev) =>
            prev.map((d) => (String(d.id) === String(payload.new.id) ? { ...d, ...payload.new } : d)),
          );
          return;
        }
        scheduleCoalescedLoad();
      });
    });
    channel.subscribe();
    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      supabase.removeChannel(channel);
    };
  }, [load, profile?.auth_user_id]);

  useEffect(() => {
    if (!profile?.auth_user_id) return undefined;

    const mergePayload = (row: any, source: "latest" | "gps_log") => {
      const normalized = normalizeLocationRows([row], source);
      if (normalized.length > 0) {
        setVehicleLocations((prev) => mergeVehicleLocationRows(prev, normalized));
      }
    };

    const channel = supabase
      .channel(`webapp-live-locations-${profile.auth_user_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_locations_latest" }, (payload: any) => {
        if (payload.eventType === "DELETE") {
          const key = locationRowKey({ ...payload.old, source: "latest" });
          setVehicleLocations((prev) => prev.filter((row) => locationRowKey(row) !== key));
          return;
        }
        mergePayload(payload.new, "latest");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "vehicle_gps_logs" }, (payload: any) => {
        mergePayload(payload.new, "gps_log");
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.auth_user_id]);

  const driverById = useMemo(() => new Map(drivers.map((driver) => [String(driver.id), driver])), [drivers]);
  const routeById = useMemo(() => new Map(routes.map((route) => [String(route.id), route])), [routes]);
  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle])), [vehicles]);

  useEffect(() => {
    syncRuntimeSystemSettings(settings);
  }, [settings]);

  const parsedSettings = useMemo(() => resolveAllSystemSettings(settings), [settings]);

  useEffect(() => {
    if (typeof document !== "undefined" && parsedSettings.organization.systemTitle) {
      document.title = parsedSettings.organization.systemTitle;
    }
  }, [parsedSettings.organization.systemTitle]);

  const dashboardStats = useMemo(() => {
    const activeRoutes = routes.filter((route) => {
      const s = normalizeStatus(route.status);
      return s === "active" || s === "pending" || s === "planned";
    });
    const completedToday = deliveries.filter((delivery) => {
      if (normalizeStatus(delivery.status) !== "completed" || !delivery.completed_at) return false;
      return new Date(delivery.completed_at).toDateString() === new Date().toDateString();
    });
    const pendingReports = reports.filter((report) => normalizeStatus(report.status) !== "resolved");
    const activeVehicles = vehicles.filter(
      (vehicle) =>
        vehicle.is_active !== false &&
        ["active", "available", "on_route"].includes(normalizeStatus(vehicle.status)),
    );
    return {
      totalBins: bins.filter((bin) => isBinActive(bin)).length,
      activeTrucks: activeVehicles.length,
      completedRoutes: routes.filter((route) => normalizeStatus(route.status) === "completed").length,
      pendingReports: pendingReports.length,
      activeRoutes: activeRoutes.length,
      completedCollectionsToday: completedToday.length,
      activeUsers: drivers.filter((driver) => normalizeStatus(driver.status) !== "inactive").length,
    };
  }, [bins, deliveries, drivers, reports, routes, vehicles]);

  const createBin = async (payload: {
    code: string;
    location: string;
    barangay?: string | null;
    area_code?: string | null;
    schedule_days?: string[] | null;
    schedule_time_window?: string | null;
    waste_category?: string | null;
    collection_status?: string | null;
    coordinate_status?: string | null;
    type?: string | null;
    latitude: number;
    longitude: number;
    status?: string;
    is_active?: boolean;
    capacity_percent?: number | null;
  }) => {
    const { error } = await supabase.from("bins").insert(payload);
    if (error) throw error;
    await load();
  };

  const updateBin = async (id: string | number, payload: Partial<BinRecord>) => {
    const { error } = await supabase.from("bins").update(payload).eq("id", id);
    if (error) throw error;
    await load();
  };

  const setBinActive = async (id: string | number, active: boolean) => {
    const { error } = await supabase
      .from("bins")
      .update({
        is_active: active,
        status: active ? "active" : "disabled",
      })
      .eq("id", id);
    if (error) throw error;
    await load();
  };

  const disableBin = async (id: string | number) => {
    await setBinActive(id, false);
  };

  const enableBin = async (id: string | number) => {
    await setBinActive(id, true);
  };

  const createReport = async (payload: Partial<WasteReportRecord>) => {
    const { error } = await supabase.from("waste_reports").insert(payload);
    if (error) throw error;
    await load();
  };

  const updateReport = async (id: string, payload: Partial<WasteReportRecord>) => {
    const { error } = await supabase.from("waste_reports").update(payload).eq("id", id);
    if (error) throw error;
    await load();
  };

  const resolveReport = async (id: string) => {
    await updateReport(id, { status: "resolved", resolved_at: new Date().toISOString() });
  };

  const deleteReport = async (id: string) => {
    const { error } = await supabase.from("waste_reports").delete().eq("id", id);
    if (error) throw error;
    await load();
  };

  const createNotification = async (payload: Partial<NotificationRecord>) => {
    const { error } = await supabase.from("notifications").insert(normalizeNotificationInsert(payload as Record<string, unknown>));
    if (error) throw error;
    await load();
  };

  /** Batch insert (e.g. notify every driver with a linked auth account). */
  const createNotifications = async (payloads: Partial<NotificationRecord>[]) => {
    if (payloads.length === 0) return;
    const { error } = await supabase.from("notifications").insert(
      payloads.map((p) => normalizeNotificationInsert(p as Record<string, unknown>)),
    );
    if (error) throw error;
    await load();
  };

  const markNotificationRead = async (id: string) => {
    const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
    if (error) throw error;
    await load();
  };

  const markAllNotificationsRead = async () => {
    const { error } = await supabase.from("notifications").update({ read: true }).eq("read", false);
    if (error) throw error;
    await load();
  };

  const deleteNotification = async (id: string) => {
    const { error } = await supabase.from("notifications").delete().eq("id", id);
    if (error) throw error;
    await load();
  };

  const clearReadNotifications = async () => {
    const { error } = await supabase.from("notifications").delete().eq("read", true);
    if (error) throw error;
    await load();
  };

  const createVehicle = async (payload: Partial<VehicleRecord>) => {
    const { data, error } = await supabase.from("vehicles").insert(payload).select("id").single();
    if (error) throw error;
    await load();
    return data as { id: string | number };
  };

  const updateVehicle = async (id: string, payload: Partial<VehicleRecord>) => {
    const { error } = await supabase.from("vehicles").update(payload).eq("id", id);
    if (error) throw error;
    await load();
  };

  const assignVehicleDriver = async (vehicleId: string, driverId: string | null) => {
    const numericVehicleId = Number(vehicleId);
    const assignedVehicleValue = Number.isFinite(numericVehicleId) ? numericVehicleId : vehicleId;

    const { error: clearDriversErr } = await supabase
      .from("drivers")
      .update({ assigned_vehicle_id: null })
      .eq("assigned_vehicle_id", assignedVehicleValue);
    if (clearDriversErr) throw clearDriversErr;

    if (driverId) {
      const { error: clearVehiclesErr } = await supabase
        .from("vehicles")
        .update({ driver_id: null })
        .eq("driver_id", String(driverId))
        .neq("id", vehicleId);
      if (clearVehiclesErr) throw clearVehiclesErr;
    }

    const { error: vehErr } = await supabase
      .from("vehicles")
      .update({ driver_id: driverId ? String(driverId) : null })
      .eq("id", vehicleId);
    if (vehErr) throw vehErr;

    if (driverId) {
      const { error: drvErr } = await supabase
        .from("drivers")
        .update({ assigned_vehicle_id: assignedVehicleValue })
        .eq("id", driverId);
      if (drvErr) throw drvErr;
    }

    await load();
  };

  const deleteVehicle = async (id: string) => {
    const { error: clearDriverErr } = await supabase
      .from("drivers")
      .update({ assigned_vehicle_id: null })
      .eq("assigned_vehicle_id", id);
    if (clearDriverErr) throw clearDriverErr;

    const { data: deletedRows, error } = await supabase
      .from("vehicles")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!deletedRows || deletedRows.length === 0) {
      throw new Error("Delete blocked by database permissions or linked records. Deactivate the truck or remove it in Supabase SQL Editor.");
    }
    await load();
  };

  const createMaintenanceRecord = async (payload: Partial<MaintenanceRecord>) => {
    const { error } = await supabase.from("maintenance_records").insert(payload);
    if (error) throw error;
    await load();
  };

  const updateMaintenanceRecord = async (id: string, payload: Partial<MaintenanceRecord>) => {
    const { error } = await supabase.from("maintenance_records").update(payload).eq("id", id);
    if (error) throw error;
    await load();
  };

  const recordAuditLog = async (entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    oldData?: unknown;
    newData?: unknown;
    metadata?: Record<string, unknown>;
  }) => {
    try {
      await supabase.from("audit_logs").insert({
        actor_user_id: profile?.auth_user_id ?? null,
        actor_role: profile?.role ?? null,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId ?? null,
        old_data: entry.oldData ?? null,
        new_data: entry.newData ?? null,
        metadata: {
          source: "webapp_system_settings",
          actor_name: profile?.full_name ?? null,
          ...(entry.metadata ?? {}),
        },
      });
    } catch {
      // Non-blocking: do not fail a persisted setting write if secondary audit logging is rejected.
    }
  };

  const upsertSystemSetting = async (key: string, value: any, description?: string) => {
    const previous = settings.find((row) => row.key === key)?.value ?? null;
    const { error } = await supabase.from("system_settings").upsert({ key, value, description });
    if (error) throw error;
    await recordAuditLog({
      action: previous === null ? "system_setting.created" : "system_setting.updated",
      entityType: "system_settings",
      entityId: key,
      oldData: previous,
      newData: value,
    });
    await load();
  };

  const upsertSystemSettingsBatch = async (
    entries: Array<{ key: string; value: any; description?: string }>,
  ) => {
    if (entries.length === 0) return;
    const previousByKey = new Map(settings.map((row) => [row.key, row.value]));
    const { error } = await supabase.from("system_settings").upsert(entries);
    if (error) throw error;
    for (const entry of entries) {
      const previous = previousByKey.get(entry.key) ?? null;
      await recordAuditLog({
        action: previous === null ? "system_setting.created" : "system_setting.updated",
        entityType: "system_settings",
        entityId: entry.key,
        oldData: previous,
        newData: entry.value,
      });
    }
    await load();
  };

  const assertReferenceTable = (table: ReferenceTableName) => {
    if (!REFERENCE_TABLES.has(table)) throw new Error("Unsupported reference table.");
  };

  const createReferenceItem = async (table: ReferenceTableName, payload: { name: string; is_active?: boolean; sort_order?: number }) => {
    assertReferenceTable(table);
    const insertPayload = {
      name: payload.name,
      is_active: payload.is_active ?? true,
      sort_order: payload.sort_order ?? 100,
    };
    const { data, error } = await supabase.from(table).insert(insertPayload).select("id, name, is_active, sort_order").single();
    if (error) throw error;
    await recordAuditLog({
      action: "reference_item.created",
      entityType: table,
      entityId: data?.id ? String(data.id) : payload.name,
      oldData: null,
      newData: data ?? insertPayload,
    });
    await load();
  };

  const updateReferenceItem = async (table: ReferenceTableName, id: string, payload: Partial<Pick<ReferenceRecord, "name" | "is_active" | "sort_order">>) => {
    assertReferenceTable(table);
    const { error } = await supabase.from(table).update(payload).eq("id", id);
    if (error) throw error;
    await recordAuditLog({
      action: "reference_item.updated",
      entityType: table,
      entityId: id,
      oldData: null,
      newData: payload,
    });
    await load();
  };

  const toggleCollectionAreaActive = async (areaCode: string, isActive: boolean) => {
    const { error: schedError } = await supabase
      .from("collection_schedules")
      .update({ is_active: isActive })
      .eq("area_code", areaCode);
    if (schedError) throw schedError;
    await load();
  };

  const createOverflowEvent = async (payload: Partial<OverflowEventRecord>) => {
    const { error } = await supabase.from("overflow_events").insert(payload);
    if (error) throw error;
    await load();
  };

  const updateOverflowEvent = async (id: string, payload: Partial<OverflowEventRecord>) => {
    const { error } = await supabase.from("overflow_events").update(payload).eq("id", id);
    if (error) throw error;
    await load();
  };

  const deleteOverflowEvent = async (id: string) => {
    const { data: deletedRows, error } = await supabase
      .from("overflow_events")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!deletedRows || deletedRows.length === 0) {
      throw new Error("Delete was blocked by database permissions. Use Resolve/Dismiss or run the overflow DELETE policy SQL.");
    }
    await load();
  };

  return {
    loading,
    error,
    bins,
    drivers,
    routes,
    routeStops,
    deliveries,
    vehicles,
    vehicleLocations,
    maintenanceRecords,
    reports,
    notifications,
    settings,
    organizationSetting: parsedSettings.organization,
    displayPreferences: parsedSettings.displayPreferences,
    depotSetting: parsedSettings.depot,
    landfillSetting: parsedSettings.landfill,
    operationsConfig: parsedSettings.operationsConfig,
    mapDefaults: parsedSettings.mapDefaults,
    securityConfig: parsedSettings.securityConfig,
    rolePermissions,
    reportCategories,
    maintenanceTypes,
    binTypes,
    allReportCategories,
    allMaintenanceTypes,
    allBinTypes,
    overflowEvents,
    collectionSchedules,
    driverById,
    routeById,
    vehicleById,
    dashboardStats,
    reload: load,
    refreshVehicleLocations,
    refreshLiveProgress,
    createBin,
    updateBin,
    setBinActive,
    disableBin,
    enableBin,
    createReport,
    updateReport,
    resolveReport,
    deleteReport,
    createNotification,
    createNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    clearReadNotifications,
    createVehicle,
    updateVehicle,
    assignVehicleDriver,
    deleteVehicle,
    createMaintenanceRecord,
    updateMaintenanceRecord,
    upsertSystemSetting,
    upsertSystemSettingsBatch,
    createReferenceItem,
    updateReferenceItem,
    toggleCollectionAreaActive,
    createOverflowEvent,
    updateOverflowEvent,
    deleteOverflowEvent,
  };
}

export type LiveDataContextValue = ReturnType<typeof useLiveDataInternal>;

const LiveDataContext = createContext<LiveDataContextValue | null>(null);

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const value = useLiveDataInternal();
  return React.createElement(LiveDataContext.Provider, { value }, children);
}

export function useLiveData(): LiveDataContextValue {
  const context = useContext(LiveDataContext);
  if (context) {
    return context;
  }
  return useLiveDataInternal();
}
