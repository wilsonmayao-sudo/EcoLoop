import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../services/supabaseClient";
import { useAuth, type AppRole } from "../contexts/AuthContext";

export type PageType =
  | "dashboard"
  | "route-planning"
  | "vehicle-monitoring"
  | "reports"
  | "bin-locations"
  | "notifications"
  | "users"
  | "user-approvals"
  | "supervisor-dashboard"
  | "system-settings";

export interface BinRecord {
  id: string | number;
  code: string | null;
  location: string;
  type?: string | null;
  status?: string | null;
  capacity_percent?: number | null;
  latitude: number | string | null;
  longitude: number | string | null;
  updated_at?: string | null;
}

export interface DriverRecord {
  id: string | number;
  name: string;
  status: string;
  auth_user_id?: string | null;
  assigned_vehicle_id?: string | number | null;
}

export interface RouteRecord {
  id: string;
  name: string;
  status: string;
  distance_km?: number | null;
  duration_minutes?: number | null;
  driver_id?: string | number | null;
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
  label: string;
  status: string;
  driver_id?: string | number | null;
  route_id?: string | null;
  capacity_kg?: number | null;
  fuel_percent?: number | null;
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

export interface ReferenceRecord {
  id: string;
  name: string;
  is_active?: boolean;
  sort_order?: number;
}

export type ReferenceTableName = "report_categories" | "maintenance_types" | "service_areas" | "bin_types";

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
  "service_areas",
  "bin_types",
];

const REFERENCE_TABLES = new Set<ReferenceTableName>(["report_categories", "maintenance_types", "service_areas", "bin_types"]);

export function formatDateOnly(value?: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value?: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function relativeTime(value?: string | null) {
  if (!value) return "Not recorded";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, unitSeconds] of units) {
    if (abs >= unitSeconds) return formatter.format(Math.round(seconds / unitSeconds), unit);
  }
  return formatter.format(seconds, "second");
}

export function normalizeStatus(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/\s+/g, "_");
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

  const readablePages = useMemo(() => permissions.filter((item) => item.can_read).map((item) => item.page), [permissions]);

  return { permissions, readablePages, loading, error, reload: load };
}

export function useLiveData() {
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
  const [serviceAreas, setServiceAreas] = useState<ReferenceRecord[]>([]);
  const [binTypes, setBinTypes] = useState<ReferenceRecord[]>([]);
  const [allReportCategories, setAllReportCategories] = useState<ReferenceRecord[]>([]);
  const [allMaintenanceTypes, setAllMaintenanceTypes] = useState<ReferenceRecord[]>([]);
  const [allServiceAreas, setAllServiceAreas] = useState<ReferenceRecord[]>([]);
  const [allBinTypes, setAllBinTypes] = useState<ReferenceRecord[]>([]);

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
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
      reportCategoriesResult,
      maintenanceTypesResult,
      serviceAreasResult,
      binTypesResult,
      allReportCategoriesResult,
      allMaintenanceTypesResult,
      allServiceAreasResult,
      allBinTypesResult,
    ] = await Promise.all([
      supabase.from("bins").select("id, code, location, type, status, capacity_percent, latitude, longitude, updated_at").order("id", { ascending: true }),
      supabase.from("drivers").select("id, name, status, auth_user_id, assigned_vehicle_id").order("name", { ascending: true }),
      supabase
        .from("routes")
        .select(
          "id, name, status, distance_km, duration_minutes, driver_id, center_lat, center_lng, generated_at, assignment_updated_at, started_at, completed_at, created_at, updated_at",
        )
        .order("created_at", { ascending: false }),
      supabase.from("route_stops").select("route_id, bin_id, stop_order, bins(id, code, location, type, status, capacity_percent, latitude, longitude)").order("stop_order", { ascending: true }),
      supabase.from("deliveries").select("id, route_id, bin_id, driver_id, status, eta, completed_at, updated_at").order("updated_at", { ascending: false }),
      supabase.from("vehicles").select("id, code, label, status, driver_id, route_id, capacity_kg, fuel_percent, latitude, longitude, last_seen_at, updated_at").order("label", { ascending: true }),
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
      supabase.from("report_categories").select("id, name, is_active, sort_order").eq("is_active", true).order("sort_order", { ascending: true }),
      supabase.from("maintenance_types").select("id, name, is_active, sort_order").eq("is_active", true).order("sort_order", { ascending: true }),
      supabase.from("service_areas").select("id, name, is_active, sort_order").eq("is_active", true).order("sort_order", { ascending: true }),
      supabase.from("bin_types").select("id, name, is_active, sort_order").eq("is_active", true).order("sort_order", { ascending: true }),
      supabase.from("report_categories").select("id, name, is_active, sort_order").order("sort_order", { ascending: true }),
      supabase.from("maintenance_types").select("id, name, is_active, sort_order").order("sort_order", { ascending: true }),
      supabase.from("service_areas").select("id, name, is_active, sort_order").order("sort_order", { ascending: true }),
      supabase.from("bin_types").select("id, name, is_active, sort_order").order("sort_order", { ascending: true }),
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
      tableError(reportCategoriesResult.error, "report_categories"),
      tableError(maintenanceTypesResult.error, "maintenance_types"),
      tableError(serviceAreasResult.error, "service_areas"),
      tableError(binTypesResult.error, "bin_types"),
      tableError(allReportCategoriesResult.error, "all report_categories"),
      tableError(allMaintenanceTypesResult.error, "all maintenance_types"),
      tableError(allServiceAreasResult.error, "all service_areas"),
      tableError(allBinTypesResult.error, "all bin_types"),
    ].find(Boolean);

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
    setSettings((settingsResult.data as SystemSetting[]) ?? []);
    setRolePermissions((permissionsResult.data as RolePermission[]) ?? []);
    setReportCategories((reportCategoriesResult.data as ReferenceRecord[]) ?? []);
    setMaintenanceTypes((maintenanceTypesResult.data as ReferenceRecord[]) ?? []);
    setServiceAreas((serviceAreasResult.data as ReferenceRecord[]) ?? []);
    setBinTypes((binTypesResult.data as ReferenceRecord[]) ?? []);
    setAllReportCategories((allReportCategoriesResult.data as ReferenceRecord[]) ?? []);
    setAllMaintenanceTypes((allMaintenanceTypesResult.data as ReferenceRecord[]) ?? []);
    setAllServiceAreas((allServiceAreasResult.data as ReferenceRecord[]) ?? []);
    setAllBinTypes((allBinTypesResult.data as ReferenceRecord[]) ?? []);
    setError(firstError ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!profile) return undefined;
    void load();
    const channel = supabase.channel(`webapp-live-data-${profile.auth_user_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    LIVE_TABLES.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => void load());
    });
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, profile?.auth_user_id]);

  useEffect(() => {
    if (!profile) return undefined;

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
    const activeVehicles = vehicles.filter((vehicle) => ["active", "available", "on_route"].includes(normalizeStatus(vehicle.status)));
    return {
      totalBins: bins.length,
      activeTrucks: activeVehicles.length,
      completedRoutes: routes.filter((route) => normalizeStatus(route.status) === "completed").length,
      pendingReports: pendingReports.length,
      activeRoutes: activeRoutes.length,
      completedCollectionsToday: completedToday.length,
      activeUsers: drivers.filter((driver) => normalizeStatus(driver.status) !== "inactive").length,
    };
  }, [bins, deliveries, drivers, reports, routes, vehicles]);

  const createBin = async (payload: { code: string; location: string; type: string; latitude: number; longitude: number; status?: string; capacity_percent?: number | null }) => {
    const { error } = await supabase.from("bins").insert(payload);
    if (error) throw error;
    await load();
  };

  const updateBin = async (id: string | number, payload: Partial<BinRecord>) => {
    const { error } = await supabase.from("bins").update(payload).eq("id", id);
    if (error) throw error;
    await load();
  };

  const deleteBin = async (id: string | number) => {
    const { error } = await supabase.from("bins").delete().eq("id", id);
    if (error) throw error;
    await load();
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
    const { error } = await supabase.from("vehicles").insert(payload);
    if (error) throw error;
    await load();
  };

  const updateVehicle = async (id: string, payload: Partial<VehicleRecord>) => {
    const { error } = await supabase.from("vehicles").update(payload).eq("id", id);
    if (error) throw error;
    await load();
  };

  const recordVehicleLocation = async (payload: { vehicle_id: string | number; route_id?: string | number | null; latitude: number; longitude: number }) => {
    const { error } = await supabase.from("vehicle_locations").insert(payload);
    if (error) throw error;
    await load();
  };

  const createMaintenanceRecord = async (payload: Partial<MaintenanceRecord>) => {
    const { error } = await supabase.from("maintenance_records").insert(payload);
    if (error) throw error;
    await load();
  };

  const upsertSystemSetting = async (key: string, value: any, description?: string) => {
    const { error } = await supabase.from("system_settings").upsert({ key, value, description });
    if (error) throw error;
    await load();
  };

  const assertReferenceTable = (table: ReferenceTableName) => {
    if (!REFERENCE_TABLES.has(table)) throw new Error("Unsupported reference table.");
  };

  const createReferenceItem = async (table: ReferenceTableName, payload: { name: string; is_active?: boolean; sort_order?: number }) => {
    assertReferenceTable(table);
    const { error } = await supabase.from(table).insert({
      name: payload.name,
      is_active: payload.is_active ?? true,
      sort_order: payload.sort_order ?? 100,
    });
    if (error) throw error;
    await load();
  };

  const updateReferenceItem = async (table: ReferenceTableName, id: string, payload: Partial<Pick<ReferenceRecord, "name" | "is_active" | "sort_order">>) => {
    assertReferenceTable(table);
    const { error } = await supabase.from(table).update(payload).eq("id", id);
    if (error) throw error;
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
    rolePermissions,
    reportCategories,
    maintenanceTypes,
    serviceAreas,
    binTypes,
    allReportCategories,
    allMaintenanceTypes,
    allServiceAreas,
    allBinTypes,
    driverById,
    routeById,
    vehicleById,
    dashboardStats,
    reload: load,
    refreshVehicleLocations,
    createBin,
    updateBin,
    deleteBin,
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
    recordVehicleLocation,
    createMaintenanceRecord,
    upsertSystemSetting,
    createReferenceItem,
    updateReferenceItem,
  };
}
