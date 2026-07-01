import { normalizeStatus } from "../hooks/useLiveData";
import { supabase } from "../services/supabaseClient";
import type { DateRange } from "./reportDateRange";
import { isWithinRange } from "./reportDateRange";

export interface SupervisorExportRoute {
  id: string;
  name: string;
  status: string;
  driver_id: string | number | null;
  generated_at: string | null;
  assignment_updated_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
}

export interface SupervisorExportDriver {
  id: string | number;
  name: string;
  status: string;
  assigned_vehicle_id?: string | number | null;
}

export interface SupervisorExportDelivery {
  id: string | number;
  route_id: string;
  driver_id?: string | number | null;
  status: string;
  completed_at?: string | null;
  updated_at?: string | null;
}

export interface SupervisorExportReport {
  id: string;
  driver_id?: string | number | null;
  report_type?: string | null;
  type: string;
  description?: string | null;
  status: string;
  reported_by?: string | null;
  assigned_to?: string | null;
  created_at: string;
}

export interface SupervisorExportVehicle {
  id: string | number;
  code: string;
  label: string;
  status: string;
  driver_id?: string | number | null;
  latitude?: number | null;
  longitude?: number | null;
  last_seen_at?: string | null;
}

export interface SupervisorExportVehicleLocation {
  vehicle_id?: string | number | null;
  driver_id?: string | number | null;
  latitude: number | string | null;
  longitude: number | string | null;
  updated_at?: string | null;
}

export interface SupervisorExportData {
  organizationName: string;
  routes: SupervisorExportRoute[];
  drivers: SupervisorExportDriver[];
  deliveries: SupervisorExportDelivery[];
  reports: SupervisorExportReport[];
  vehicles: SupervisorExportVehicle[];
  vehicleLocations: SupervisorExportVehicleLocation[];
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

export async function fetchSupervisorExportData(): Promise<SupervisorExportData> {
  const [settingsResult, routesResult, driversResult, deliveriesResult, reportsResult, vehiclesResult, locationsResult] =
    await Promise.all([
      supabase.from("system_settings").select("key, value").eq("key", "organization").maybeSingle(),
      supabase
        .from("routes")
        .select("id, name, status, driver_id, generated_at, assignment_updated_at, completed_at, updated_at")
        .order("generated_at", { ascending: false }),
      supabase.from("drivers").select("id, name, status, assigned_vehicle_id").order("name", { ascending: true }),
      supabase
        .from("deliveries")
        .select("id, route_id, driver_id, status, completed_at, updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("waste_reports")
        .select("id, driver_id, report_type, type, description, status, reported_by, assigned_to, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("vehicles")
        .select("id, code, label, status, driver_id, latitude, longitude, last_seen_at")
        .order("label", { ascending: true }),
      supabase
        .from("vehicle_locations_latest")
        .select("vehicle_id, driver_id, latitude, longitude, updated_at")
        .order("updated_at", { ascending: false }),
    ]);

  const errors = [
    settingsResult.error,
    routesResult.error,
    driversResult.error,
    deliveriesResult.error,
    reportsResult.error,
    vehiclesResult.error,
    locationsResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors[0]?.message ?? "Unable to load export data.");
  }

  const organization = (settingsResult.data?.value as { name?: string } | null) ?? {};

  return {
    organizationName: organization.name?.trim() || "ECOLOOP",
    routes: (routesResult.data as SupervisorExportRoute[]) ?? [],
    drivers: (driversResult.data as SupervisorExportDriver[]) ?? [],
    deliveries: (deliveriesResult.data as SupervisorExportDelivery[]) ?? [],
    reports: (reportsResult.data as SupervisorExportReport[]) ?? [],
    vehicles: (vehiclesResult.data as SupervisorExportVehicle[]) ?? [],
    vehicleLocations: (locationsResult.data as SupervisorExportVehicleLocation[]) ?? [],
  };
}

function routeAssignedAt(route: SupervisorExportRoute) {
  return route.assignment_updated_at ?? route.generated_at ?? route.updated_at ?? null;
}

function routeCompletedAt(route: SupervisorExportRoute) {
  return route.completed_at ?? (normalizeStatus(route.status) === "completed" ? route.updated_at : null);
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

    const assignedVehicle =
      driver.assigned_vehicle_id != null
        ? vehicleById.get(String(driver.assigned_vehicle_id))
        : vehicles.find((vehicle) => String(vehicle.driver_id) === driverKey);
    const vehicleLabel = assignedVehicle ? `${assignedVehicle.code} · ${assignedVehicle.label}` : "Unassigned";

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

export function buildDriverFleetRows(
  drivers: SupervisorExportDriver[],
  routes: SupervisorExportRoute[],
  vehicles: SupervisorExportVehicle[],
  vehicleLocations: SupervisorExportVehicleLocation[],
) {
  const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle]));
  const locationByDriver = new Map<string, SupervisorExportVehicleLocation>();

  vehicleLocations.forEach((location) => {
    if (location.driver_id == null) return;
    const key = String(location.driver_id);
    if (!locationByDriver.has(key)) locationByDriver.set(key, location);
  });

  return drivers.map((driver) => {
    const driverKey = String(driver.id);
    const assignedVehicle =
      driver.assigned_vehicle_id != null
        ? vehicleById.get(String(driver.assigned_vehicle_id))
        : vehicles.find((vehicle) => String(vehicle.driver_id) === driverKey);
    const activeRoute = routes.find(
      (route) =>
        String(route.driver_id) === driverKey && ["active", "pending", "planned"].includes(normalizeStatus(route.status)),
    );
    const location = locationByDriver.get(driverKey);
    const lat =
      location?.latitude != null
        ? String(location.latitude)
        : assignedVehicle?.latitude != null
          ? String(assignedVehicle.latitude)
          : "—";
    const lng =
      location?.longitude != null
        ? String(location.longitude)
        : assignedVehicle?.longitude != null
          ? String(assignedVehicle.longitude)
          : "—";
    const lastUpdated = location?.updated_at
      ? location.updated_at
      : assignedVehicle?.last_seen_at ?? null;

    return {
      name: driver.name,
      status: driver.status,
      vehicle: assignedVehicle ? `${assignedVehicle.code} · ${assignedVehicle.label}` : "Unassigned",
      currentRoute: activeRoute?.name ?? "No active route",
      lastLocation: `${lat}, ${lng}`,
      lastUpdated,
    };
  });
}

export function formatReportType(report: SupervisorExportReport) {
  const custom = report.report_type?.trim();
  if (custom && custom.toLowerCase() !== "other") return custom;
  return report.type?.replace(/_/g, " ") ?? "Not recorded";
}

export function labelRouteStatus(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "planned" || normalized === "pending") return "Pending";
  if (normalized === "active") return "Active";
  if (normalized === "completed") return "Completed";
  return status;
}

export function labelReportStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function labelDriverStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export { routeAssignedAt, routeCompletedAt };
