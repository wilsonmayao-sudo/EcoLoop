import { isBinActive, normalizeStatus } from "../hooks/useLiveData";
import { supabase } from "../services/supabaseClient";
import { formatCollectionAreaDisplay } from "./areaDisplay";
import {
  formatPhilippineDate,
  formatPhilippineDateTime,
  isWithinRange,
  type DateRange,
} from "./reportDateRange";
import {
  doesAreaMatchScheduleDay,
  doesBinMatchScheduleDay,
  doesRouteMatchScheduleDay,
  extractNormalizedScheduleDays,
  formatScheduleDaysLabel,
  normalizeScheduleDayFilter,
} from "./scheduleDays";
import {
  DEFAULT_LANDFILL_SETTING,
  DEFAULT_OPERATIONS_CONFIG,
  DEFAULT_ORGANIZATION_SETTING,
  resolveAllSystemSettings,
  type LandfillSetting,
  type OperationsConfigSetting,
} from "./systemSettings";

export interface SupervisorExportBin {
  id: string | number;
  code?: string | null;
  location: string;
  barangay?: string | null;
  area_code?: string | null;
  schedule_days?: string[] | null;
  schedule_time_window?: string | null;
  waste_category?: string | null;
  collection_status?: string | null;
  is_active?: boolean | null;
  type?: string | null;
  status?: string | null;
}

export interface SupervisorExportRoute {
  id: string;
  name: string;
  status: string;
  area_code?: string | null;
  scheduled_days?: string[] | null;
  shift_label?: string | null;
  waste_category?: string | null;
  driver_id: string | number | null;
  vehicle_id?: string | number | null;
  distance_km?: number | null;
  duration_minutes?: number | null;
  generated_at: string | null;
  assignment_updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SupervisorExportRouteStop {
  route_id: string;
  bin_id: string | number;
  stop_order: number;
  bins?: SupervisorExportBin | null;
}

export interface SupervisorExportDriver {
  id: string | number;
  name: string;
  status: string;
  auth_user_id?: string | null;
  profile_id?: string | null;
  phone?: string | null;
  phone_number?: string | null;
  assigned_vehicle_id?: string | number | null;
  last_seen_at?: string | null;
}

export interface SupervisorExportDelivery {
  id: string | number;
  route_id: string;
  bin_id?: string | number | null;
  driver_id?: string | number | null;
  status: string;
  eta?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
}

export interface SupervisorExportReport {
  id: string;
  report_id?: string | null;
  report_number?: string | null;
  driver_id?: string | number | null;
  report_type?: string | null;
  type: string;
  location?: string | null;
  description?: string | null;
  status: string;
  priority?: string | null;
  reported_by?: string | null;
  assigned_to?: string | null;
  bin_id?: string | number | null;
  route_id?: string | number | null;
  created_at: string;
  resolved_at?: string | null;
}

export interface SupervisorExportVehicle {
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
  latitude?: number | null;
  longitude?: number | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
}

export interface SupervisorExportVehicleLocation {
  vehicle_id?: string | number | null;
  driver_id?: string | number | null;
  route_id?: string | number | null;
  latitude: number | string | null;
  longitude: number | string | null;
  speed_kph?: number | string | null;
  updated_at?: string | null;
  recorded_at?: string | null;
}

export interface SupervisorExportSchedule {
  id: number;
  area_code: string;
  area_name: string;
  shift_label?: string | null;
  stop_order: number;
  location_name: string;
  stop_type: string;
  barangay?: string | null;
  days_of_week: string[];
  day_times?: Record<string, string> | null;
  scheduled_time?: string | null;
  waste_category?: string | null;
  assigned_truck_note?: string | null;
  special_instructions?: string | null;
  bin_id?: number | string | null;
  is_active?: boolean | null;
  monitor_name?: string | null;
}

export interface SupervisorExportData {
  organizationName: string;
  organizationCity: string;
  landfill: LandfillSetting;
  operationsConfig: OperationsConfigSetting;
  routes: SupervisorExportRoute[];
  routeStops: SupervisorExportRouteStop[];
  bins: SupervisorExportBin[];
  drivers: SupervisorExportDriver[];
  deliveries: SupervisorExportDelivery[];
  reports: SupervisorExportReport[];
  vehicles: SupervisorExportVehicle[];
  vehicleLocations: SupervisorExportVehicleLocation[];
  collectionSchedules: SupervisorExportSchedule[];
}

export interface DriverPerformanceRow {
  id: string;
  name: string;
  status: string;
  vehicleLabel: string;
  assigned: number;
  completed: number;
  pending: number;
  collectionsCompleted: number;
  reportsFiled: number;
  completionPct: number;
}

export interface RouteStopExportItem {
  stopOrder: number;
  binCode: string;
  location: string;
  barangay: string;
  scheduleWindow: string;
  activityState: "Completed" | "Active" | "Pending" | "Planned" | "Missed";
  completedAt: string | null;
}

export interface EnrichedRouteReportRow {
  id: string;
  reference: string;
  name: string;
  areaCode: string;
  areaLabel: string;
  scheduledDaysLabel: string;
  shiftLabel: string;
  wasteCategory: string;
  driverName: string;
  vehicleLabel: string;
  vehicleType: string;
  createdAt: string | null;
  completedAt: string | null;
  statusRaw: string;
  statusLabel: string;
  distanceKm: number;
  durationMinutes: number;
  completedStops: number;
  totalStops: number;
  progressPercent: number;
  landfillDestination: string;
  stops: RouteStopExportItem[];
}

export interface FleetMonitoringExportRow {
  vehicleId: string;
  truckCode: string;
  plateNumber: string;
  vehicleLabel: string;
  vehicleType: string;
  driverName: string;
  operationalStatusKey: "on_route" | "returning_to_landfill" | "stopped" | "available" | "offline";
  operationalStatusLabel: string;
  onlineStatus: "Online" | "Offline";
  lastGpsAt: string | null;
  coordinatesLabel: string;
  speedLabel: string;
  currentRoute: string;
  areaLabel: string;
}

export interface CollectionActivityScheduleSummary {
  areaCode: string;
  areaName: string;
  scheduleDaysLabel: string;
  shiftWindow: string;
  wasteCategory: string;
  plannedCount: number;
  activeCount: number;
  completedCount: number;
  missedCount: number;
  remarks: string;
}

export interface CollectionActivityDetailRow {
  areaLabel: string;
  scheduleLabel: string;
  routeName: string;
  stopOrder: number | null;
  location: string;
  barangay: string;
  activityState: "Completed" | "Active" | "Planned" | "Missed";
  activityAt: string | null;
  driverAndVehicle: string;
  remarks: string;
}

export interface MissedOrIssueExportRow {
  reference: string;
  sourceKind: "Missed Collection" | "Field Issue";
  category: string;
  areaLabel: string;
  location: string;
  driverAndVehicle: string;
  reportedAt: string | null;
  statusLabel: string;
  priorityLabel: string;
  remarks: string;
}

function isOptionalTableError(error: any) {
  if (!error) return false;
  const code = String(error.code ?? "");
  return code === "42P01" || code === "PGRST204";
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export async function fetchSupervisorExportData(): Promise<SupervisorExportData> {
  const [
    settingsResult,
    routesResult,
    routeStopsResult,
    binsResult,
    driversResult,
    profilesResult,
    deliveriesResult,
    reportsResult,
    vehiclesResult,
    locationsResult,
    gpsLogsResult,
    schedulesResult,
  ] = await Promise.all([
    supabase.from("system_settings").select("key, value").order("key", { ascending: true }),
    supabase
      .from("routes")
      .select(
        "id, name, status, area_code, scheduled_days, shift_label, waste_category, distance_km, duration_minutes, driver_id, vehicle_id, generated_at, assignment_updated_at, started_at, completed_at, created_at, updated_at",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("route_stops")
      .select(
        "route_id, bin_id, stop_order, bins(id, code, location, barangay, area_code, schedule_days, schedule_time_window, waste_category, collection_status, is_active, type, status)",
      )
      .order("stop_order", { ascending: true }),
    supabase
      .from("bins")
      .select(
        "id, code, location, barangay, area_code, schedule_days, schedule_time_window, waste_category, collection_status, is_active, type, status",
      )
      .order("id", { ascending: true }),
    supabase
      .from("drivers")
      .select("id, name, status, auth_user_id, profile_id, phone, phone_number, assigned_vehicle_id, last_seen_at")
      .order("name", { ascending: true }),
    supabase.from("user_profiles").select("auth_user_id, full_name, role, status"),
    supabase
      .from("deliveries")
      .select("id, route_id, bin_id, driver_id, status, eta, completed_at, updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("waste_reports")
      .select(
        "id, report_id, report_number, driver_id, report_type, type, location, description, status, priority, reported_by, assigned_to, bin_id, route_id, created_at, resolved_at",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("vehicles")
      .select("id, code, truck_code, plate_number, label, model, is_active, status, driver_id, route_id, latitude, longitude, last_seen_at, updated_at")
      .order("label", { ascending: true }),
    supabase
      .from("vehicle_locations_latest")
      .select("vehicle_id, driver_id, route_id, latitude, longitude, speed_kph, updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("vehicle_gps_logs")
      .select("vehicle_id, driver_id, route_id, latitude, longitude, speed_kph, recorded_at")
      .order("recorded_at", { ascending: false })
      .limit(150),
    supabase
      .from("collection_schedules")
      .select(
        "id, area_code, area_name, shift_label, stop_order, location_name, stop_type, barangay, days_of_week, day_times, scheduled_time, waste_category, assigned_truck_note, special_instructions, bin_id, is_active, monitor_name",
      )
      .eq("is_active", true)
      .order("area_code", { ascending: true })
      .order("stop_order", { ascending: true }),
  ]);

  const errors = [
    settingsResult.error,
    routesResult.error,
    routeStopsResult.error,
    binsResult.error,
    driversResult.error,
    deliveriesResult.error,
    reportsResult.error,
    vehiclesResult.error,
    locationsResult.error,
    isOptionalTableError(gpsLogsResult.error) ? null : gpsLogsResult.error,
    isOptionalTableError(schedulesResult.error) ? null : schedulesResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors[0]?.message ?? "Unable to load operational export data.");
  }

  const resolvedSettings = resolveAllSystemSettings((settingsResult.data as Array<{ key: string; value: unknown }>) ?? []);
  const profileByAuthId = new Map<string, { role: string; status: string; full_name: string }>();
  ((profilesResult.data as Array<{ auth_user_id?: string | null; role?: string | null; status?: string | null; full_name?: string | null }>) ?? []).forEach(
    (profile) => {
      if (profile?.auth_user_id) {
        profileByAuthId.set(String(profile.auth_user_id), {
          role: String(profile.role ?? ""),
          status: String(profile.status ?? ""),
          full_name: String(profile.full_name ?? ""),
        });
      }
    },
  );

  const drivers = ((driversResult.data as SupervisorExportDriver[]) ?? [])
    .filter((driver) => {
      const driverStatus = normalizeStatus(driver.status);
      if (driverStatus === "inactive" || driverStatus === "suspended") return false;
      if (!driver.auth_user_id) return true;
      const profile = profileByAuthId.get(String(driver.auth_user_id));
      if (!profile) return true;
      return profile.role === "truck_driver" && profile.status !== "inactive" && profile.status !== "suspended";
    })
    .map((driver) => {
      const profile = driver.auth_user_id ? profileByAuthId.get(String(driver.auth_user_id)) : undefined;
      return {
        ...driver,
        name: profile?.full_name?.trim() || driver.name,
      };
    });

  const routeStops = ((routeStopsResult.data as any[]) ?? []).map((stop) => ({
    ...stop,
    bins: Array.isArray(stop.bins) ? stop.bins[0] ?? null : stop.bins ?? null,
  })) as SupervisorExportRouteStop[];

  const latestLocations = (locationsResult.data as SupervisorExportVehicleLocation[]) ?? [];
  const gpsLogLocations = ((gpsLogsResult.data as SupervisorExportVehicleLocation[]) ?? []).map((row) => ({
    ...row,
    updated_at: row.updated_at ?? row.recorded_at ?? null,
  }));

  const orgName = resolvedSettings.organization.name?.trim() || DEFAULT_ORGANIZATION_SETTING.name;

  return {
    organizationName: orgName,
    organizationCity: resolvedSettings.organization.city?.trim() || DEFAULT_ORGANIZATION_SETTING.city,
    landfill: resolvedSettings.landfill ?? DEFAULT_LANDFILL_SETTING,
    operationsConfig: resolvedSettings.operationsConfig ?? DEFAULT_OPERATIONS_CONFIG,
    routes: (routesResult.data as SupervisorExportRoute[]) ?? [],
    routeStops,
    bins: (binsResult.data as SupervisorExportBin[]) ?? [],
    drivers,
    deliveries: (deliveriesResult.data as SupervisorExportDelivery[]) ?? [],
    reports: (reportsResult.data as SupervisorExportReport[]) ?? [],
    vehicles: (vehiclesResult.data as SupervisorExportVehicle[]) ?? [],
    vehicleLocations: [...latestLocations, ...gpsLogLocations],
    collectionSchedules: (schedulesResult.data as SupervisorExportSchedule[]) ?? [],
  };
}

function routeAssignedAt(route: SupervisorExportRoute) {
  return route.assignment_updated_at ?? route.generated_at ?? route.created_at ?? route.updated_at ?? null;
}

function routeCompletedAt(route: SupervisorExportRoute): string | null {
  return (route.completed_at ?? (normalizeStatus(route.status) === "completed" ? route.updated_at : null)) ?? null;
}

function deliveryActivityAt(delivery: SupervisorExportDelivery) {
  return delivery.completed_at ?? delivery.updated_at ?? null;
}

export function filterRoutesForRange(routes: SupervisorExportRoute[], range: DateRange) {
  return routes.filter((route) => isWithinRange(routeAssignedAt(route), range));
}

export function filterReportsForRange(reports: SupervisorExportReport[], range: DateRange) {
  return reports.filter((report) => isWithinRange(report.created_at, range));
}

export function filterDeliveriesForRange(deliveries: SupervisorExportDelivery[], range: DateRange) {
  return deliveries.filter((delivery) => isWithinRange(deliveryActivityAt(delivery), range));
}

function buildScheduleMaps(schedules: SupervisorExportSchedule[]) {
  const schedulesByArea = new Map<string, SupervisorExportSchedule[]>();
  const scheduleAreaByBinId = new Map<string, string>();
  const rawNameByArea = new Map<string, string>();

  schedules.forEach((row) => {
    const code = row.area_code?.trim();
    if (!code) return;
    const list = schedulesByArea.get(code) ?? [];
    list.push(row);
    schedulesByArea.set(code, list);
    if (!rawNameByArea.has(code) && row.area_name?.trim()) {
      rawNameByArea.set(code, row.area_name.trim());
    }
    if (row.bin_id != null) {
      scheduleAreaByBinId.set(String(row.bin_id), code);
    }
  });

  const displayNameByArea = new Map<string, string>();
  schedulesByArea.forEach((rows, code) => {
    displayNameByArea.set(code, formatCollectionAreaDisplay(code, rawNameByArea.get(code) ?? null, rows));
  });

  return { schedulesByArea, scheduleAreaByBinId, displayNameByArea };
}

function resolveVehicleForRouteOrDriver(
  route: SupervisorExportRoute | null | undefined,
  driver: SupervisorExportDriver | null | undefined,
  vehicleById: Map<string, SupervisorExportVehicle>,
  vehicles: SupervisorExportVehicle[],
): SupervisorExportVehicle | null {
  if (route?.vehicle_id != null) {
    const byRoute = vehicleById.get(String(route.vehicle_id));
    if (byRoute) return byRoute;
  }
  if (driver?.assigned_vehicle_id != null) {
    const byDriverAssigned = vehicleById.get(String(driver.assigned_vehicle_id));
    if (byDriverAssigned) return byDriverAssigned;
  }
  if (driver?.id != null) {
    const matchingDriver = vehicles.find((v) => String(v.driver_id) === String(driver.id));
    if (matchingDriver) return matchingDriver;
  }
  if (route?.id != null) {
    const matchingRoute = vehicles.find((v) => String(v.route_id) === String(route.id));
    if (matchingRoute) return matchingRoute;
  }
  return null;
}

export function formatVehicleTitle(vehicle?: SupervisorExportVehicle | null): string {
  if (!vehicle) return "Not Available";
  const code = vehicle.code?.trim() || vehicle.truck_code?.trim() || `TRK-${vehicle.id}`;
  const plate = vehicle.plate_number?.trim();
  const label = vehicle.label?.trim();
  const parts = [code];
  if (plate && plate !== code) parts.push(plate);
  if (label && label !== code && label !== plate) parts.push(label);
  return parts.join(" · ");
}

export function formatVehicleType(vehicle?: SupervisorExportVehicle | null): string {
  const model = vehicle?.model?.trim();
  return model || "Not Available";
}

function classifyStopActivity(
  deliveryStatus: string | null | undefined,
  routeStatus: string | null | undefined,
): "Completed" | "Active" | "Pending" | "Planned" | "Missed" {
  const dNorm = normalizeStatus(deliveryStatus);
  const rNorm = normalizeStatus(routeStatus);
  if (dNorm === "completed") return "Completed";
  if (["missed", "skipped", "failed", "cancelled"].includes(dNorm)) return "Missed";
  if (rNorm === "completed") return "Missed";
  if (dNorm === "active" || dNorm === "in_progress" || rNorm === "active") return "Active";
  if (dNorm === "pending" || rNorm === "pending") return "Pending";
  return "Planned";
}

export function buildAreaFilterOptions(data: SupervisorExportData): Array<{ value: string; label: string }> {
  const { schedulesByArea, displayNameByArea } = buildScheduleMaps(data.collectionSchedules);
  const areaCodes = new Set<string>();
  schedulesByArea.forEach((_, code) => areaCodes.add(code));
  data.bins.forEach((b) => {
    if (b.area_code?.trim()) areaCodes.add(b.area_code.trim());
  });
  data.routes.forEach((r) => {
    if (r.area_code?.trim()) areaCodes.add(r.area_code.trim());
  });

  return Array.from(areaCodes)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((code) => ({
      value: code,
      label: displayNameByArea.get(code) ?? code,
    }));
}

export function buildEnrichedRouteReports(
  data: SupervisorExportData,
  filters: {
    range: DateRange;
    scheduleDay?: string | null;
    routeStatus?: string | null;
    areaCode?: string | null;
    driverId?: string | number | null;
  },
): EnrichedRouteReportRow[] {
  const dayFilter = normalizeScheduleDayFilter(filters.scheduleDay);
  const statusFilter = normalizeStatus(filters.routeStatus);
  const areaFilter = filters.areaCode?.trim() || "ALL";
  const driverFilter =
    filters.driverId != null && String(filters.driverId).trim() !== "" && String(filters.driverId) !== "ALL"
      ? String(filters.driverId)
      : null;

  const { schedulesByArea, scheduleAreaByBinId, displayNameByArea } = buildScheduleMaps(data.collectionSchedules);
  const schedulesByUpperArea = new Map<string, SupervisorExportSchedule[]>();
  schedulesByArea.forEach((rows, code) => {
    schedulesByUpperArea.set(code.toUpperCase(), rows);
  });
  const binById = new Map(data.bins.map((b) => [String(b.id), b]));
  const driverById = new Map(data.drivers.map((d) => [String(d.id), d]));
  const vehicleById = new Map(data.vehicles.map((v) => [String(v.id), v]));

  const stopsByRouteId = new Map<string, SupervisorExportRouteStop[]>();
  data.routeStops.forEach((stop) => {
    const rId = String(stop.route_id);
    const list = stopsByRouteId.get(rId) ?? [];
    list.push({
      ...stop,
      bins: stop.bins ?? (stop.bin_id != null ? binById.get(String(stop.bin_id)) ?? null : null),
    });
    stopsByRouteId.set(rId, list);
  });

  const deliveriesByRouteId = new Map<string, SupervisorExportDelivery[]>();
  data.deliveries.forEach((delivery) => {
    const rId = String(delivery.route_id);
    const list = deliveriesByRouteId.get(rId) ?? [];
    list.push(delivery);
    deliveriesByRouteId.set(rId, list);
  });

  return data.routes
    .filter((route) => {
      if (!isWithinRange(routeAssignedAt(route), filters.range)) return false;
      if (driverFilter && String(route.driver_id ?? "") !== driverFilter) return false;
      if (statusFilter && statusFilter !== "all") {
        const rNorm = normalizeStatus(route.status);
        const matchesPending = statusFilter === "pending" && (rNorm === "pending" || rNorm === "planned");
        if (!matchesPending && rNorm !== statusFilter) return false;
      }
      const routeStopsList = stopsByRouteId.get(String(route.id)) ?? [];
      const inferredArea =
        route.area_code?.trim() ||
        routeStopsList.find((s) => s.bins?.area_code?.trim())?.bins?.area_code?.trim() ||
        routeStopsList.map((s) => scheduleAreaByBinId.get(String(s.bin_id))).find(Boolean) ||
        "";
      if (
        dayFilter !== "ALL" &&
        !doesRouteMatchScheduleDay(
          { ...route, area_code: inferredArea || route.area_code },
          dayFilter,
          schedulesByUpperArea,
        )
      ) {
        return false;
      }
      if (areaFilter !== "ALL" && inferredArea !== areaFilter) {
        return false;
      }
      return true;
    })
    .sort((a, b) => new Date(routeAssignedAt(b) ?? 0).getTime() - new Date(routeAssignedAt(a) ?? 0).getTime())
    .map((route) => {
      const rId = String(route.id);
      const stops = [...(stopsByRouteId.get(rId) ?? [])].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
      const deliveries = deliveriesByRouteId.get(rId) ?? [];
      const deliveryByBinId = new Map<string, SupervisorExportDelivery>();
      deliveries.forEach((d) => {
        if (d.bin_id != null && !deliveryByBinId.has(String(d.bin_id))) {
          deliveryByBinId.set(String(d.bin_id), d);
        }
      });

      const areaCode =
        route.area_code?.trim() ||
        stops.find((s) => s.bins?.area_code?.trim())?.bins?.area_code?.trim() ||
        stops.map((s) => scheduleAreaByBinId.get(String(s.bin_id))).find(Boolean) ||
        "";
      const areaLabel = areaCode ? displayNameByArea.get(areaCode) ?? areaCode : "Not Available";

      const areaSchedules = areaCode ? schedulesByArea.get(areaCode) ?? [] : [];
      const normalizedDays =
        extractNormalizedScheduleDays(route.scheduled_days).length > 0
          ? extractNormalizedScheduleDays(route.scheduled_days)
          : Array.from(
              new Set(
                areaSchedules.flatMap((row) => extractNormalizedScheduleDays(row.days_of_week)),
              ),
            );
      const scheduledDaysLabel =
        normalizedDays.length > 0 ? formatScheduleDaysLabel(normalizedDays) : "Not Available";

      const driver = route.driver_id != null ? driverById.get(String(route.driver_id)) ?? null : null;
      const vehicle = resolveVehicleForRouteOrDriver(route, driver, vehicleById, data.vehicles);

      const stopItems: RouteStopExportItem[] = [];
      const seenBinIds = new Set<string>();

      stops.forEach((stop, index) => {
        const binKey = String(stop.bin_id);
        seenBinIds.add(binKey);
        const bin = stop.bins ?? binById.get(binKey) ?? null;
        const delivery = deliveryByBinId.get(binKey);
        stopItems.push({
          stopOrder: Number.isFinite(Number(stop.stop_order)) && Number(stop.stop_order) > 0 ? Number(stop.stop_order) : index + 1,
          binCode: bin?.code?.trim() || `Stop #${stop.bin_id}`,
          location: bin?.location?.trim() || "Not Available",
          barangay: bin?.barangay?.trim() || "Not Available",
          scheduleWindow: bin?.schedule_time_window?.trim() || route.shift_label?.trim() || "Not Available",
          activityState: classifyStopActivity(delivery?.status, route.status),
          completedAt: delivery?.completed_at ?? null,
        });
      });

      deliveries.forEach((delivery, index) => {
        if (delivery.bin_id != null && seenBinIds.has(String(delivery.bin_id))) return;
        const bin = delivery.bin_id != null ? binById.get(String(delivery.bin_id)) ?? null : null;
        stopItems.push({
          stopOrder: stopItems.length + index + 1,
          binCode: bin?.code?.trim() || (delivery.bin_id != null ? `Stop #${delivery.bin_id}` : `Stop #${delivery.id}`),
          location: bin?.location?.trim() || "Not Available",
          barangay: bin?.barangay?.trim() || "Not Available",
          scheduleWindow: bin?.schedule_time_window?.trim() || route.shift_label?.trim() || "Not Available",
          activityState: classifyStopActivity(delivery.status, route.status),
          completedAt: delivery.completed_at ?? null,
        });
      });

      const totalStops = stopItems.length > 0 ? stopItems.length : deliveries.length;
      const completedStops =
        stopItems.length > 0
          ? stopItems.filter((item) => item.activityState === "Completed").length
          : deliveries.filter((d) => normalizeStatus(d.status) === "completed").length;
      const progressPercent = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0;

      const hasDisposalContext =
        areaSchedules.some((s) => normalizeStatus(s.stop_type) === "disposal") ||
        ["active", "completed"].includes(normalizeStatus(route.status));
      const landfillDestination = hasDisposalContext
        ? data.landfill.name?.trim() || "SWMO - Sanitary Landfill"
        : normalizeStatus(route.status) === "cancelled"
          ? "Not Applicable (Cancelled)"
          : data.landfill.name?.trim() || "Not Available";

      return {
        id: rId,
        reference: `RT-${rId.slice(0, 8).toUpperCase()}`,
        name: route.name?.trim() || `Route ${rId.slice(0, 8)}`,
        areaCode,
        areaLabel,
        scheduledDaysLabel,
        shiftLabel: route.shift_label?.trim() || areaSchedules.find((s) => s.shift_label?.trim())?.shift_label?.trim() || "Not Available",
        wasteCategory: route.waste_category?.trim() || "Mixed / Segregated",
        driverName: driver?.name?.trim() || "Not Available",
        vehicleLabel: formatVehicleTitle(vehicle),
        vehicleType: formatVehicleType(vehicle),
        createdAt: route.created_at ?? route.generated_at ?? null,
        completedAt: routeCompletedAt(route),
        statusRaw: route.status,
        statusLabel: labelRouteStatus(route.status),
        distanceKm: Number(route.distance_km) || 0,
        durationMinutes: Number(route.duration_minutes) || 0,
        completedStops,
        totalStops,
        progressPercent,
        landfillDestination,
        stops: stopItems,
      };
    });
}

export function buildFleetMonitoringRows(
  data: SupervisorExportData,
  filters: {
    fleetStatus?: string | null;
    areaCode?: string | null;
  },
  nowMs = Date.now(),
): FleetMonitoringExportRow[] {
  const { scheduleAreaByBinId, displayNameByArea } = buildScheduleMaps(data.collectionSchedules);
  const driverById = new Map(data.drivers.map((d) => [String(d.id), d]));
  const routeById = new Map(data.routes.map((r) => [String(r.id), r]));

  const areaByRouteId = new Map<string, string>();
  data.routeStops.forEach((stop) => {
    const rKey = String(stop.route_id);
    if (areaByRouteId.has(rKey)) return;
    const area =
      stop.bins?.area_code?.trim() ||
      (stop.bin_id != null ? scheduleAreaByBinId.get(String(stop.bin_id)) : undefined);
    if (area) areaByRouteId.set(rKey, area);
  });

  const activeRouteByVehicle = new Map<string, SupervisorExportRoute>();
  const activeRouteByDriver = new Map<string, SupervisorExportRoute>();
  data.routes.forEach((route) => {
    const s = normalizeStatus(route.status);
    if (!["pending", "planned", "active", "in_progress"].includes(s)) return;
    if (route.vehicle_id != null && !activeRouteByVehicle.has(String(route.vehicle_id))) {
      activeRouteByVehicle.set(String(route.vehicle_id), route);
    }
    if (route.driver_id != null && !activeRouteByDriver.has(String(route.driver_id))) {
      activeRouteByDriver.set(String(route.driver_id), route);
    }
  });

  const driverOfflineThresholdMs = data.operationsConfig.driverOfflineSeconds * 1000;
  const gpsDelayedThresholdMs = data.operationsConfig.gpsDelayedSeconds * 1000;
  const gpsStoppedThresholdMs = data.operationsConfig.gpsStoppedSeconds * 1000;
  const landfillRadiusMeters = data.operationsConfig.landfillProximityMeters;

  const fleetStatusFilter = (filters.fleetStatus ?? "ALL").toUpperCase();
  const areaFilter = filters.areaCode?.trim() || "ALL";

  return data.vehicles
    .filter((vehicle) => vehicle.is_active !== false)
    .map((vehicle) => {
      const assignedDriver =
        (vehicle.driver_id != null ? driverById.get(String(vehicle.driver_id)) : null) ??
        data.drivers.find((d) => String(d.assigned_vehicle_id ?? "") === String(vehicle.id)) ??
        null;

      const loc =
        data.vehicleLocations.find((l) => String(l.vehicle_id ?? "") === String(vehicle.id)) ??
        (assignedDriver?.id != null
          ? data.vehicleLocations.find((l) => String(l.driver_id ?? "") === String(assignedDriver.id))
          : undefined);

      const assignedRoute =
        (vehicle.route_id ? routeById.get(String(vehicle.route_id)) : null) ??
        (loc?.route_id ? routeById.get(String(loc.route_id)) : null) ??
        activeRouteByVehicle.get(String(vehicle.id)) ??
        (assignedDriver?.id != null ? activeRouteByDriver.get(String(assignedDriver.id)) : null) ??
        null;

      const lastGpsAt = loc?.updated_at ?? vehicle.last_seen_at ?? null;
      const gpsAgeMs = lastGpsAt ? Math.max(0, nowMs - new Date(lastGpsAt).getTime()) : Infinity;
      const driverSeenMs = assignedDriver?.last_seen_at ? new Date(assignedDriver.last_seen_at).getTime() : 0;
      const driverAgeMs = driverSeenMs > 0 ? Math.max(0, nowMs - driverSeenMs) : Infinity;

      const isOnline =
        (driverAgeMs <= driverOfflineThresholdMs && normalizeStatus(assignedDriver?.status) !== "offline") ||
        gpsAgeMs <= gpsDelayedThresholdMs;

      const lat = loc?.latitude != null ? Number(loc.latitude) : vehicle.latitude != null ? Number(vehicle.latitude) : null;
      const lng = loc?.longitude != null ? Number(loc.longitude) : vehicle.longitude != null ? Number(vehicle.longitude) : null;
      const hasCoords =
        lat != null &&
        lng != null &&
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);

      const distToLandfill = hasCoords
        ? haversineMeters(lat!, lng!, data.landfill.latitude, data.landfill.longitude)
        : null;
      const isRouteCompleted = assignedRoute != null && normalizeStatus(assignedRoute.status) === "completed";
      const isReturning =
        !isRouteCompleted &&
        (normalizeStatus(assignedDriver?.status) === "full" ||
          normalizeStatus(vehicle.status) === "unloading" ||
          (assignedRoute != null && distToLandfill !== null && distToLandfill <= landfillRadiusMeters));

      let opKey: FleetMonitoringExportRow["operationalStatusKey"] = "available";
      let opLabel = "Available";
      if (!isOnline && gpsAgeMs > gpsStoppedThresholdMs) {
        opKey = "offline";
        opLabel = "Offline";
      } else if (isReturning) {
        opKey = "returning_to_landfill";
        opLabel = "Returning to Landfill";
      } else if (isRouteCompleted || !assignedRoute) {
        opKey = "available";
        opLabel = "Available";
      } else if (gpsAgeMs > gpsDelayedThresholdMs || Number(loc?.speed_kph ?? 0) === 0) {
        opKey = "stopped";
        opLabel = "Stopped / Delayed GPS";
      } else {
        opKey = "on_route";
        opLabel = "On Route";
      }

      const routeAreaCode =
        assignedRoute?.area_code?.trim() ||
        (assignedRoute?.id ? areaByRouteId.get(String(assignedRoute.id)) : "") ||
        "";
      const areaLabel = routeAreaCode ? displayNameByArea.get(routeAreaCode) ?? routeAreaCode : "Not Available";

      return {
        vehicleId: String(vehicle.id),
        truckCode: vehicle.code?.trim() || vehicle.truck_code?.trim() || `TRK-${vehicle.id}`,
        plateNumber: vehicle.plate_number?.trim() || "Not Available",
        vehicleLabel: vehicle.label?.trim() || formatVehicleTitle(vehicle),
        vehicleType: formatVehicleType(vehicle),
        driverName: assignedDriver?.name?.trim() || "Unassigned",
        operationalStatusKey: opKey,
        operationalStatusLabel: opLabel,
        onlineStatus: isOnline ? ("Online" as const) : ("Offline" as const),
        lastGpsAt,
        coordinatesLabel: hasCoords ? `${lat!.toFixed(5)}, ${lng!.toFixed(5)}` : "Not Available",
        speedLabel: loc?.speed_kph != null && Number.isFinite(Number(loc.speed_kph)) ? `${Math.round(Number(loc.speed_kph))} kph` : "Not Available",
        currentRoute: assignedRoute?.name?.trim() || "No active route",
        areaLabel,
        _routeAreaCode: routeAreaCode,
      };
    })
    .filter((row) => {
      if (fleetStatusFilter === "ONLINE" && row.onlineStatus !== "Online") return false;
      if (fleetStatusFilter === "OFFLINE" && row.onlineStatus !== "Offline") return false;
      if (fleetStatusFilter === "ON_ROUTE" && row.operationalStatusKey !== "on_route") return false;
      if (fleetStatusFilter === "LANDFILL" && row.operationalStatusKey !== "returning_to_landfill") return false;
      if (fleetStatusFilter === "STOPPED" && row.operationalStatusKey !== "stopped") return false;
      if (fleetStatusFilter === "AVAILABLE" && row.operationalStatusKey !== "available") return false;
      if (areaFilter !== "ALL" && row._routeAreaCode !== areaFilter) return false;
      return true;
    })
    .map(({ _routeAreaCode: _omit, ...row }) => row);
}

export function buildCollectionActivityReportData(
  data: SupervisorExportData,
  filters: {
    range: DateRange;
    scheduleDay?: string | null;
    areaCode?: string | null;
  },
): {
  areaSummaries: CollectionActivityScheduleSummary[];
  activityDetails: CollectionActivityDetailRow[];
  missedAndIssues: MissedOrIssueExportRow[];
} {
  const dayFilter = normalizeScheduleDayFilter(filters.scheduleDay);
  const areaFilter = filters.areaCode?.trim() || "ALL";
  const { schedulesByArea, scheduleAreaByBinId, displayNameByArea } = buildScheduleMaps(data.collectionSchedules);
  const binById = new Map(data.bins.map((b) => [String(b.id), b]));
  const driverById = new Map(data.drivers.map((d) => [String(d.id), d]));
  const vehicleById = new Map(data.vehicles.map((v) => [String(v.id), v]));

  const matchingRoutes = buildEnrichedRouteReports(data, {
    range: filters.range,
    scheduleDay: dayFilter,
    areaCode: areaFilter,
  });

  const activityDetails: CollectionActivityDetailRow[] = [];
  const missedStops: MissedOrIssueExportRow[] = [];
  const statsByArea = new Map<
    string,
    { planned: number; active: number; completed: number; missed: number }
  >();

  const incrementAreaCount = (areaCode: string, state: CollectionActivityDetailRow["activityState"]) => {
    const key = areaCode || "UNASSIGNED";
    const entry = statsByArea.get(key) ?? { planned: 0, active: 0, completed: 0, missed: 0 };
    if (state === "Completed") entry.completed += 1;
    else if (state === "Active") entry.active += 1;
    else if (state === "Missed") entry.missed += 1;
    else entry.planned += 1;
    statsByArea.set(key, entry);
  };

  matchingRoutes.forEach((route) => {
    const rawRoute = data.routes.find((r) => String(r.id) === route.id);
    const driverAndVehicle =
      route.driverName !== "Not Available" || route.vehicleLabel !== "Not Available"
        ? `${route.driverName} / ${route.vehicleLabel}`
        : "Not Available";

    if (route.stops.length === 0) {
      const state: CollectionActivityDetailRow["activityState"] =
        normalizeStatus(route.statusRaw) === "completed"
          ? "Completed"
          : normalizeStatus(route.statusRaw) === "active"
            ? "Active"
            : normalizeStatus(route.statusRaw) === "cancelled"
              ? "Missed"
              : "Planned";
      incrementAreaCount(route.areaCode, state);
      activityDetails.push({
        areaLabel: route.areaLabel,
        scheduleLabel: `${route.scheduledDaysLabel} (${route.shiftLabel})`,
        routeName: `${route.reference} - ${route.name}`,
        stopOrder: null,
        location: "Route level entry (no bin stops linked)",
        barangay: "Not Available",
        activityState: state,
        activityAt: route.completedAt ?? route.createdAt,
        driverAndVehicle,
        remarks: route.wasteCategory !== "Mixed / Segregated" ? route.wasteCategory : "Not Available",
      });
      return;
    }

    route.stops.forEach((stop) => {
      const mappedState: CollectionActivityDetailRow["activityState"] =
        stop.activityState === "Pending" ? "Planned" : stop.activityState;
      incrementAreaCount(route.areaCode, mappedState);

      const activityAt =
        stop.completedAt ??
        route.completedAt ??
        (rawRoute ? routeAssignedAt(rawRoute) : null);

      activityDetails.push({
        areaLabel: route.areaLabel,
        scheduleLabel: `${route.scheduledDaysLabel} (${stop.scheduleWindow !== "Not Available" ? stop.scheduleWindow : route.shiftLabel})`,
        routeName: route.name,
        stopOrder: stop.stopOrder,
        location: `${stop.binCode}: ${stop.location}`,
        barangay: stop.barangay,
        activityState: mappedState,
        activityAt,
        driverAndVehicle,
        remarks: mappedState === "Missed" ? "Stop incomplete on route" : route.wasteCategory,
      });

      if (mappedState === "Missed") {
        missedStops.push({
          reference: `${route.reference} #${stop.stopOrder}`,
          sourceKind: "Missed Collection",
          category: "Missed Stop",
          areaLabel: route.areaLabel,
          location: `${stop.binCode} - ${stop.location}${stop.barangay !== "Not Available" ? `, ${stop.barangay}` : ""}`,
          driverAndVehicle,
          reportedAt: activityAt,
          statusLabel: "Missed",
          priorityLabel: "High",
          remarks: `Stop missed during ${route.name} (${route.statusLabel})`,
        });
      }
    });
  });

  // Also include scheduled area compliance even for areas without generated route records yet
  const candidateAreaCodes = new Set<string>();
  schedulesByArea.forEach((rows, code) => {
    if (areaFilter !== "ALL" && code !== areaFilter) return;
    if (dayFilter === "ALL" || doesAreaMatchScheduleDay(rows, dayFilter)) {
      candidateAreaCodes.add(code);
    }
  });
  statsByArea.forEach((_, code) => {
    if (areaFilter === "ALL" || code === areaFilter) {
      candidateAreaCodes.add(code);
    }
  });

  const areaSummaries: CollectionActivityScheduleSummary[] = Array.from(candidateAreaCodes)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((code) => {
      const rows = schedulesByArea.get(code) ?? [];
      const areaBins = data.bins.filter(
        (b) =>
          isBinActive(b) &&
          (b.area_code?.trim() === code || scheduleAreaByBinId.get(String(b.id)) === code) &&
          (dayFilter === "ALL" || doesBinMatchScheduleDay(b, dayFilter, data.collectionSchedules as any)),
      );
      const countStats = statsByArea.get(code);
      const completedFromBins = areaBins.filter((b) => normalizeStatus(b.collection_status) === "completed").length;
      const missedFromBins = areaBins.filter((b) => normalizeStatus(b.collection_status) === "missed").length;
      const plannedFromBins = Math.max(0, areaBins.length - completedFromBins - missedFromBins);

      const days = Array.from(new Set(rows.flatMap((r) => extractNormalizedScheduleDays(r.days_of_week))));
      const shiftValues = Array.from(new Set(rows.map((r) => r.shift_label?.trim()).filter(Boolean))) as string[];
      const wasteCategories = Array.from(new Set(rows.map((r) => r.waste_category?.trim()).filter(Boolean))) as string[];
      const noteValues = Array.from(
        new Set(
          rows
            .flatMap((r) => [r.assigned_truck_note?.trim(), r.special_instructions?.trim(), r.monitor_name?.trim() ? `Monitor: ${r.monitor_name.trim()}` : ""])
            .filter(Boolean),
        ),
      );

      return {
        areaCode: code === "UNASSIGNED" ? "Not Available" : code,
        areaName: code === "UNASSIGNED" ? "Unassigned Area" : displayNameByArea.get(code) ?? code,
        scheduleDaysLabel: days.length > 0 ? formatScheduleDaysLabel(days) : "Not Available",
        shiftWindow: shiftValues.length > 0 ? shiftValues.join(" / ") : "Not Available",
        wasteCategory: wasteCategories.length > 0 ? wasteCategories.join(", ") : "Standard SWMO",
        plannedCount: countStats ? countStats.planned : plannedFromBins,
        activeCount: countStats ? countStats.active : 0,
        completedCount: countStats ? countStats.completed : completedFromBins,
        missedCount: countStats ? countStats.missed : missedFromBins,
        remarks: noteValues.length > 0 ? noteValues.slice(0, 2).join(" · ") : "Not Available",
      };
    });

  const matchingRouteIds = new Set(matchingRoutes.map((r) => r.id));
  const reportsInRange = filterReportsForRange(data.reports, filters.range).filter((report) => {
    if (areaFilter === "ALL") return true;
    const binArea = report.bin_id != null ? binById.get(String(report.bin_id))?.area_code?.trim() : "";
    const routeMatch = report.route_id != null && matchingRouteIds.has(String(report.route_id));
    return binArea === areaFilter || routeMatch;
  });

  const issueRows: MissedOrIssueExportRow[] = reportsInRange.map((report) => {
    const driver = report.driver_id != null ? driverById.get(String(report.driver_id)) ?? null : null;
    const vehicle = driver?.assigned_vehicle_id != null ? vehicleById.get(String(driver.assigned_vehicle_id)) ?? null : null;
    const bin = report.bin_id != null ? binById.get(String(report.bin_id)) ?? null : null;
    const areaCode = bin?.area_code?.trim() || (report.bin_id != null ? scheduleAreaByBinId.get(String(report.bin_id)) ?? "" : "");
    return {
      reference: report.report_number?.trim() || `RPT-${String(report.id).slice(0, 8).toUpperCase()}`,
      sourceKind: "Field Issue",
      category: formatReportType(report),
      areaLabel: areaCode ? displayNameByArea.get(areaCode) ?? areaCode : "Not Available",
      location: report.location?.trim() || bin?.location?.trim() || "Not Available",
      driverAndVehicle:
        driver?.name || vehicle ? `${driver?.name ?? "Unassigned"} / ${formatVehicleTitle(vehicle)}` : "Not Available",
      reportedAt: report.created_at,
      statusLabel: labelReportStatus(report.status),
      priorityLabel: report.priority ? labelReportStatus(report.priority) : "Normal",
      remarks: report.description?.trim() || "Not Available",
    };
  });

  return {
    areaSummaries,
    activityDetails,
    missedAndIssues: [...missedStops, ...issueRows],
  };
}

export function buildDriverOverviewStats(
  drivers: SupervisorExportDriver[],
  routes: SupervisorExportRoute[],
  deliveries: SupervisorExportDelivery[],
) {
  const available = drivers.filter((driver) => normalizeStatus(driver.status) === "available").length;
  const onRoute = drivers.filter((driver) => {
    const driverRoutes = routes.filter((route) => String(route.driver_id) === String(driver.id));
    return driverRoutes.some((route) => normalizeStatus(route.status) === "active");
  }).length;
  const withAssignments = drivers.filter((driver) =>
    routes.some((route) => String(route.driver_id) === String(driver.id)),
  ).length;
  const completedCollections = deliveries.filter((delivery) => delivery.status === "completed").length;
  const assignedRoutes = routes.length;
  const completedRoutes = routes.filter((route) => normalizeStatus(route.status) === "completed").length;
  const completionRate = assignedRoutes > 0 ? Math.round((completedRoutes / assignedRoutes) * 100) : 0;

  return {
    totalDrivers: drivers.length,
    available,
    onRoute,
    withAssignments,
    completedCollections,
    completionRate,
  };
}

export function buildDriverPerformanceRows(
  drivers: SupervisorExportDriver[],
  routes: SupervisorExportRoute[],
  deliveries: SupervisorExportDelivery[],
  reports: SupervisorExportReport[],
  vehicles: SupervisorExportVehicle[],
): DriverPerformanceRow[] {
  const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle]));

  return drivers.map((driver) => {
    const driverKey = String(driver.id);
    const driverRoutes = routes.filter((route) => String(route.driver_id) === driverKey);
    const completed = driverRoutes.filter((route) => normalizeStatus(route.status) === "completed").length;
    const pending = driverRoutes.filter((route) =>
      ["pending", "planned", "active"].includes(normalizeStatus(route.status)),
    ).length;
    const assigned = driverRoutes.length;
    const collectionsCompleted = deliveries.filter(
      (delivery) => String(delivery.driver_id) === driverKey && delivery.status === "completed",
    ).length;
    const reportsFiled = reports.filter((report) => String(report.driver_id) === driverKey).length;
    const completionPct = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;

    const assignedVehicle = resolveVehicleForRouteOrDriver(null, driver, vehicleById, vehicles);
    const vehicleLabel = formatVehicleTitle(assignedVehicle);

    return {
      id: driverKey,
      name: driver.name,
      status: driver.status,
      vehicleLabel,
      assigned,
      completed,
      pending,
      collectionsCompleted,
      reportsFiled,
      completionPct,
    };
  });
}

export function buildDriverReportStats(reports: SupervisorExportReport[]) {
  const pending = reports.filter((report) => normalizeStatus(report.status) === "pending").length;
  const inProgress = reports.filter((report) => normalizeStatus(report.status) === "in_progress").length;
  const resolved = reports.filter((report) => normalizeStatus(report.status) === "resolved").length;

  return {
    total: reports.length,
    pending,
    inProgress,
    resolved,
  };
}

export function formatReportType(report: SupervisorExportReport) {
  const custom = report.report_type?.trim();
  if (custom && custom.toLowerCase() !== "other") return custom;
  return report.type?.replace(/_/g, " ") ?? "Not Available";
}

export function labelRouteStatus(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "planned" || normalized === "pending") return "Pending";
  if (normalized === "active" || normalized === "in_progress") return "Active";
  if (normalized === "completed") return "Completed";
  if (normalized === "cancelled") return "Cancelled";
  return status || "Not Available";
}

export function labelReportStatus(status: string) {
  if (!status?.trim()) return "Not Available";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function labelDriverStatus(status: string) {
  if (!status?.trim()) return "Not Available";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export { formatPhilippineDate, formatPhilippineDateTime, routeAssignedAt, routeCompletedAt };
