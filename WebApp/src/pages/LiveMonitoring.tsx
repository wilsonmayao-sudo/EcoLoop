import React, { useEffect, useMemo, useState } from "react";
import {
  Truck,
  MapPin,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Scale,
  Sparkles,
  Search,
  Radio,
  Recycle,
  OctagonAlert,
  Trash2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import ConfirmModal from "../components/feedback/ConfirmModal";
import FleetMaintenancePanel from "../components/fleet/FleetMaintenancePanel";
import PageHeader from "../components/layout/PageHeader";
import OverflowEventLog from "../components/overflow/OverflowEventLog";
import CustomSelect from "../components/ui/CustomSelect";
import { formatCollectionAreaDisplay } from "../utils/areaDisplay";
import { useOverflowDispatch } from "../hooks/useOverflowDispatch";
import LiveFleetMap, {
  type LiveFleetMapIconKind,
  type LiveFleetMapMarker,
  type LiveFleetMapRoute,
  type LiveFleetMapTone,
} from "../components/maps/LiveFleetMap";
import {
  fetchStreetRouteGeometry,
  isValidLngLat,
  type LngLat,
} from "../services/streetRouteService";
import type { UncollectedStop } from "../utils/routing/dynamicReassignment";
import {
  formatDateOnly,
  formatDateTime,
  getRouteStopProgress,
  normalizeStatus,
  relativeTime,
  useLiveData,
  type DriverRecord,
  type RouteRecord,
  type PageType,
} from "../hooks/useLiveData";
import { haversineMeters } from "../utils/routing/geo";

interface LiveMonitoringProps {
  onNavigate?: (page: PageType) => void;
  role?: string;
}

const ACTIVE_ROUTE_STATUSES = new Set([
  "active",
  "pending",
  "planned",
  "assigned",
  "in_progress",
  "started",
  "accepted",
  "en_route",
]);

function routeTimestampMs(route?: RouteRecord | null): number {
  if (!route) return 0;
  const candidate = route.assignment_updated_at ?? route.started_at ?? route.generated_at ?? route.created_at ?? route.updated_at;
  if (!candidate) return 0;
  const ms = new Date(candidate).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isPreferredRoute(candidate: RouteRecord, current?: RouteRecord | null): boolean {
  if (!current) return true;
  const candStatus = normalizeStatus(candidate.status);
  const currStatus = normalizeStatus(current.status);
  const candActive = candStatus === "active";
  const currActive = currStatus === "active";
  if (candActive !== currActive) return candActive;
  return routeTimestampMs(candidate) > routeTimestampMs(current);
}

function formatRouteStatusLabel(routeStatus?: string | null, isReturningToLandfill = false): string {
  const normalized = normalizeStatus(routeStatus);
  if (normalized === "completed") return "Completed";
  if (isReturningToLandfill) return "Returning to Landfill";
  if (!normalized) return "Unassigned";
  if (normalized === "active" || normalized === "in_progress" || normalized === "started" || normalized === "accepted" || normalized === "en_route") {
    return "On Route";
  }
  if (normalized === "pending" || normalized === "planned" || normalized === "assigned") return "Assigned";
  if (normalized === "cancelled") return "Cancelled";
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type TruckOperationalStatus = "on_route" | "available" | "returning_to_landfill" | "stopped" | "offline";

export interface MonitoredTruck {
  vehicleId: string | number;
  vehicleName: string;
  vehicleCode: string;
  vehiclePlate: string | null;
  vehicleStatus: string;
  driverId: string | number | null;
  driverName: string;
  isOnline: boolean;
  latitude: number | null;
  longitude: number | null;
  speedKph: number;
  lastGpsUpdate: string | null;
  lastGpsAgeMs: number;
  operationalStatus: TruckOperationalStatus;
  routeStatusLabel: string;
  assignedAreaCode: string | null;
  assignedAreaName: string | null;
  assignedRoute: RouteRecord | null;
  progressPercent: number;
  completedStops: number;
  totalStops: number;
  distanceToLandfillMeters: number | null;
  isReturningToLandfill: boolean;
}

export default function LiveMonitoring({ onNavigate, role = "admin" }: LiveMonitoringProps) {
  const {
    vehicles,
    drivers,
    routes,
    routeStops,
    deliveries,
    maintenanceRecords,
    collectionSchedules,
    vehicleLocations,
    driverById,
    vehicleById,
    routeById,
    operationsConfig,
    landfillSetting,
    mapDefaults,
    loading,
    error,
    refreshVehicleLocations,
    refreshLiveProgress,
  } = useLiveData();
  const {
    overflowEvents,
    overflowLog,
    findMultiCriteriaOptimalTruck,
    signalTruckFull,
    acceptOverflow,
    declineOverflow,
    completeOverflow,
    reassignOverflow,
    deleteOverflowEvent,
  } = useOverflowDispatch();

  const [activeTab, setActiveTab] = useState<"live" | "fleet">("live");
  const [selectedTruckId, setSelectedTruckId] = useState<string | number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [areaFilter, setAreaFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const [overflowBusy, setOverflowBusy] = useState(false);
  const [overflowError, setOverflowError] = useState<string | null>(null);
  const [overflowNotice, setOverflowNotice] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [reassigningEventId, setReassigningEventId] = useState<string | null>(null);
  const [reassignVehicleId, setReassignVehicleId] = useState<string>("");
  const [confirmDeleteOverflowId, setConfirmDeleteOverflowId] = useState<string | null>(null);
  const [logClearedAfterMs, setLogClearedAfterMs] = useState<number>(() => {
    try {
      const saved = Number(sessionStorage.getItem("ecoloop_overflow_log_cleared_ms") || 0);
      return Number.isFinite(saved) ? saved : 0;
    } catch {
      return 0;
    }
  });
  const [showOverflowLog, setShowOverflowLog] = useState(false);
  const [confirmFullTruck, setConfirmFullTruck] = useState(false);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<"multi-criteria" | "nearest-baseline">("multi-criteria");

  const collectionAreas = useMemo(() => {
    const map = new Map<
      string,
      { rawName: string; rows: Array<{ days_of_week: string[]; is_active: boolean }> }
    >();
    collectionSchedules.forEach((row) => {
      const code = row.area_code?.trim();
      if (!code) return;
      const entry = map.get(code) ?? { rawName: row.area_name || code, rows: [] };
      entry.rows.push({ days_of_week: row.days_of_week ?? [], is_active: row.is_active !== false });
      map.set(code, entry);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([areaCode, meta]) => ({
        areaCode,
        areaName: formatCollectionAreaDisplay(areaCode, meta.rawName, meta.rows),
      }));
  }, [collectionSchedules]);

  // Ticking timer for real-time GPS freshness display
  useEffect(() => {
    const timer = window.setInterval(() => setLiveNow(Date.now()), 3000);
    return () => window.clearInterval(timer);
  }, []);

  // Poll vehicle locations and live route/stop progress
  useEffect(() => {
    const syncLive = () => {
      void refreshVehicleLocations();
      void refreshLiveProgress();
    };
    syncLive();
    const timer = window.setInterval(syncLive, 8000);
    return () => window.clearInterval(timer);
  }, [refreshLiveProgress, refreshVehicleLocations]);

  // Build Monitored Trucks list using live Supabase data
  const monitoredTrucks = useMemo((): MonitoredTruck[] => {
    const driverById = new Map(drivers.map((d) => [String(d.id), d]));
    const routeById = new Map(routes.map((r) => [String(r.id), r]));
    const areaByCode = new Map(collectionAreas.map((a) => [a.areaCode, a.areaName]));

    const scheduleAreaByBinId = new Map<string, string>();
    collectionSchedules.forEach((row) => {
      if (row.bin_id != null && row.area_code) {
        scheduleAreaByBinId.set(String(row.bin_id), row.area_code.trim());
      }
    });

    const areaCodeByRouteId = new Map<string, string>();
    routeStops.forEach((stop) => {
      const rKey = String(stop.route_id);
      if (areaCodeByRouteId.has(rKey)) return;
      const stopArea =
        stop.bins?.area_code?.trim() ||
        (stop.bin_id != null ? scheduleAreaByBinId.get(String(stop.bin_id)) : undefined);
      if (stopArea) {
        areaCodeByRouteId.set(rKey, stopArea);
      }
    });

    const driverByVehicleId = new Map<string, DriverRecord>();
    const driverOfflineThresholdMs = operationsConfig.driverOfflineSeconds * 1000;
    drivers.forEach((driver) => {
      if (driver.assigned_vehicle_id == null) return;
      const statusNorm = normalizeStatus(driver.status);
      if (statusNorm === "inactive" || statusNorm === "suspended") return;
      const key = String(driver.assigned_vehicle_id);
      const existing = driverByVehicleId.get(key);
      if (!existing) {
        driverByVehicleId.set(key, driver);
        return;
      }
      const candSeen = driver.last_seen_at ? new Date(driver.last_seen_at).getTime() : 0;
      const existSeen = existing.last_seen_at ? new Date(existing.last_seen_at).getTime() : 0;
      const candOnline = candSeen > 0 && liveNow - candSeen <= driverOfflineThresholdMs && statusNorm !== "offline";
      const existOnline =
        existSeen > 0 &&
        liveNow - existSeen <= driverOfflineThresholdMs &&
        normalizeStatus(existing.status) !== "offline";
      if (candOnline !== existOnline) {
        if (candOnline) driverByVehicleId.set(key, driver);
        return;
      }
      if (candSeen > existSeen) {
        driverByVehicleId.set(key, driver);
      }
    });

    const activeRouteByDriver = new Map<string, RouteRecord>();
    const activeRouteByVehicle = new Map<string, RouteRecord>();
    routes.forEach((route) => {
      const s = normalizeStatus(route.status);
      if (!ACTIVE_ROUTE_STATUSES.has(s)) return;
      if (route.driver_id != null) {
        const dKey = String(route.driver_id);
        if (isPreferredRoute(route, activeRouteByDriver.get(dKey))) {
          activeRouteByDriver.set(dKey, route);
        }
      }
      if (route.vehicle_id != null) {
        const vKey = String(route.vehicle_id);
        if (isPreferredRoute(route, activeRouteByVehicle.get(vKey))) {
          activeRouteByVehicle.set(vKey, route);
        }
      }
    });

    const activeDeliveryRouteByDriver = new Map<string, RouteRecord>();
    deliveries.forEach((delivery) => {
      if (delivery.driver_id == null || delivery.route_id == null) return;
      const dStatus = normalizeStatus(delivery.status);
      if (dStatus === "completed" || dStatus === "cancelled") return;
      const route = routeById.get(String(delivery.route_id));
      if (!route || normalizeStatus(route.status) === "cancelled") return;
      const dKey = String(delivery.driver_id);
      if (isPreferredRoute(route, activeDeliveryRouteByDriver.get(dKey))) {
        activeDeliveryRouteByDriver.set(dKey, route);
      }
    });

    return vehicles
      .filter((vehicle) => vehicle.is_active !== false)
      .map((vehicle) => {
        const vehicleDriver =
          (vehicle.driver_id != null ? driverById.get(String(vehicle.driver_id)) : null) ??
          driverByVehicleId.get(String(vehicle.id)) ??
          null;
        const loc =
          vehicleLocations.find((l) => String(l.vehicle_id) === String(vehicle.id)) ??
          (vehicleDriver?.id != null
            ? vehicleLocations.find((l) => String(l.driver_id) === String(vehicleDriver.id))
            : undefined);
        const rawLat = loc?.latitude != null ? Number(loc.latitude) : vehicle.latitude != null ? Number(vehicle.latitude) : null;
        const rawLng = loc?.longitude != null ? Number(loc.longitude) : vehicle.longitude != null ? Number(vehicle.longitude) : null;
        const hasValidCoords =
          rawLat != null &&
          rawLng != null &&
          Number.isFinite(rawLat) &&
          Number.isFinite(rawLng) &&
          !(Math.abs(rawLat) < 1e-6 && Math.abs(rawLng) < 1e-6);
        const lat = hasValidCoords ? rawLat : null;
        const lng = hasValidCoords ? rawLng : null;
        const lastUpdated = loc?.updated_at ?? loc?.recorded_at ?? vehicle.last_seen_at ?? null;
        const updatedMs = lastUpdated ? new Date(lastUpdated).getTime() : 0;
        const gpsAgeMs = updatedMs > 0 ? Math.max(0, liveNow - updatedMs) : Infinity;

        const vehicleDirectRoute = vehicle.route_id ? routeById.get(String(vehicle.route_id)) ?? null : null;
        const locRoute = loc?.route_id ? routeById.get(String(loc.route_id)) ?? null : null;

        let driver =
          (loc?.driver_id != null ? driverById.get(String(loc.driver_id)) : null) ??
          vehicleDriver;

        const vehicleLatestRoute = activeRouteByVehicle.get(String(vehicle.id)) ?? null;
        const driverLatestRoute = driver?.id != null ? activeRouteByDriver.get(String(driver.id)) ?? null : null;
        const deliveryLatestRoute = driver?.id != null ? activeDeliveryRouteByDriver.get(String(driver.id)) ?? null : null;

        // Pick the freshest active/assigned route across all valid Supabase relationships
        const candidateRoutes = [
          locRoute,
          vehicleLatestRoute,
          driverLatestRoute,
          deliveryLatestRoute,
          vehicleDirectRoute,
        ].filter((r): r is RouteRecord => Boolean(r));

        const activeCandidates = candidateRoutes.filter((r) => ACTIVE_ROUTE_STATUSES.has(normalizeStatus(r.status)));
        const pool = activeCandidates.length > 0 ? activeCandidates : candidateRoutes;
        const assignedRoute = pool.reduce<RouteRecord | null>(
          (best, candidate) => (isPreferredRoute(candidate, best) ? candidate : best),
          null,
        );

        if (!driver && assignedRoute?.driver_id != null) {
          driver = driverById.get(String(assignedRoute.driver_id)) ?? null;
        }

        const gpsDelayedThresholdMs = operationsConfig.gpsDelayedSeconds * 1000;
        const gpsStoppedThresholdMs = operationsConfig.gpsStoppedSeconds * 1000;
        const driverOfflineThresholdMs = operationsConfig.driverOfflineSeconds * 1000;
        const landfillProximityMeters = operationsConfig.landfillProximityMeters;

        const driverLastSeenMs = driver?.last_seen_at ? new Date(driver.last_seen_at).getTime() : 0;
        const driverActivityAgeMs = driverLastSeenMs > 0 ? liveNow - driverLastSeenMs : Infinity;

        // Online status: driver recently seen or fresh GPS update
        const isOnline =
          (driverActivityAgeMs <= driverOfflineThresholdMs && normalizeStatus(driver?.status) !== "offline") ||
          gpsAgeMs <= gpsDelayedThresholdMs;

        const areaCode =
          assignedRoute?.area_code?.trim() ||
          (assignedRoute ? areaCodeByRouteId.get(String(assignedRoute.id)) ?? null : null);
        const areaName = areaCode ? areaByCode.get(areaCode) ?? areaCode : null;

        // Calculate distance to official landfill
        let distanceToLandfillMeters: number | null = null;
        if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
          distanceToLandfillMeters = haversineMeters(
            { lat, lng },
            { lat: landfillSetting.latitude, lng: landfillSetting.longitude },
          );
        }

        // Progress calculation for assigned route
        let progressPercent = 0;
        let completedStops = 0;
        let totalStops = 0;
        if (assignedRoute) {
          const prog = getRouteStopProgress(assignedRoute.id, deliveries, routeStops);
          progressPercent = prog.progressPercent;
          completedStops = prog.completedStops;
          totalStops = prog.totalStops;
        }

        const isRouteCompleted =
          assignedRoute != null &&
          (normalizeStatus(assignedRoute.status) === "completed" || normalizeStatus(assignedRoute.status) === "cancelled");
        const allStopsCollected = Boolean(
          assignedRoute &&
            !isRouteCompleted &&
            totalStops > 0 &&
            completedStops >= totalStops,
        );

        // Check if returning to landfill (only for incomplete/active routes)
        const isReturningToLandfill =
          !isRouteCompleted &&
          (normalizeStatus(driver?.status) === "full" ||
            normalizeStatus(vehicle.status) === "unloading" ||
            allStopsCollected ||
            (assignedRoute != null &&
              distanceToLandfillMeters !== null &&
              distanceToLandfillMeters <= landfillProximityMeters));

        // Determine operational status
        let operationalStatus: TruckOperationalStatus = "available";
        if (!isOnline && gpsAgeMs > gpsStoppedThresholdMs) {
          operationalStatus = "offline";
        } else if (isReturningToLandfill) {
          operationalStatus = "returning_to_landfill";
        } else if (isRouteCompleted || !assignedRoute) {
          operationalStatus = "available";
        } else if (gpsAgeMs > gpsDelayedThresholdMs || (Number(loc?.speed_kph ?? 0) === 0 && assignedRoute)) {
          operationalStatus = "stopped";
        } else {
          operationalStatus = "on_route";
        }

        const vehicleName =
          vehicle.label?.trim() ||
          vehicle.code?.trim() ||
          vehicle.truck_code?.trim() ||
          `Truck #${vehicle.id}`;
        const vehicleCode =
          vehicle.code?.trim() ||
          vehicle.truck_code?.trim() ||
          vehicle.label?.trim() ||
          `TRK-${vehicle.id}`;
        const vehiclePlate = vehicle.plate_number?.trim() || null;

        return {
          vehicleId: vehicle.id,
          vehicleName,
          vehicleCode,
          vehiclePlate,
          vehicleStatus: vehicle.status || "available",
          driverId: driver?.id ?? null,
          driverName: driver?.name ?? "Unassigned Driver",
          isOnline,
          latitude: lat,
          longitude: lng,
          speedKph: Number(loc?.speed_kph ?? 0),
          lastGpsUpdate: lastUpdated,
          lastGpsAgeMs: gpsAgeMs,
          operationalStatus,
          routeStatusLabel: formatRouteStatusLabel(assignedRoute?.status, isReturningToLandfill),
          assignedAreaCode: areaCode,
          assignedAreaName: areaName,
          assignedRoute,
          progressPercent,
          completedStops,
          totalStops,
          distanceToLandfillMeters,
          isReturningToLandfill,
        };
      });
  }, [collectionAreas, collectionSchedules, deliveries, drivers, landfillSetting, liveNow, operationsConfig, routeStops, routes, vehicleLocations, vehicles]);

  // Selected Truck object
  const selectedTruck = useMemo(
    () => monitoredTrucks.find((t) => String(t.vehicleId) === String(selectedTruckId)) ?? null,
    [monitoredTrucks, selectedTruckId],
  );

  // Filtered trucks
  const filteredTrucks = useMemo(() => {
    return monitoredTrucks.filter((truck) => {
      if (statusFilter !== "ALL") {
        if (statusFilter === "ONLINE" && !truck.isOnline) return false;
        if (statusFilter === "OFFLINE" && truck.isOnline) return false;
        if (statusFilter === "ON_ROUTE" && truck.operationalStatus !== "on_route") return false;
        if (statusFilter === "LANDFILL" && truck.operationalStatus !== "returning_to_landfill") return false;
        if (statusFilter === "STOPPED" && truck.operationalStatus !== "stopped") return false;
      }
      if (areaFilter !== "ALL" && truck.assignedAreaCode !== areaFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mName = truck.vehicleName.toLowerCase().includes(q);
        const mCode = truck.vehicleCode.toLowerCase().includes(q);
        const mPlate = (truck.vehiclePlate || "").toLowerCase().includes(q);
        const mDriver = truck.driverName.toLowerCase().includes(q);
        const mArea = (truck.assignedAreaCode || "").toLowerCase().includes(q) || (truck.assignedAreaName || "").toLowerCase().includes(q);
        const mRoute = (truck.assignedRoute?.name || "").toLowerCase().includes(q);
        if (!mName && !mCode && !mPlate && !mDriver && !mArea && !mRoute) return false;
      }
      return true;
    });
  }, [areaFilter, monitoredTrucks, searchQuery, statusFilter]);

  const activeOverflowEvents = useMemo(
    () =>
      overflowEvents.filter((e) =>
        ["pending", "dispatched", "accepted", "declined"].includes(String(e.status).toLowerCase()),
      ),
    [overflowEvents],
  );

  // Map markers: live truck driver locations + active overflow stop pins
  const mapMarkers = useMemo((): LiveFleetMapMarker[] => {
    const truckMarkers: LiveFleetMapMarker[] = filteredTrucks
      .filter((t) => Number.isFinite(t.latitude) && Number.isFinite(t.longitude))
      .map((truck) => {
        let tone: LiveFleetMapTone = "blue";
        let icon: LiveFleetMapIconKind = "truck";

        if (truck.operationalStatus === "on_route") {
          tone = "green";
          icon = "truck";
        } else if (truck.operationalStatus === "returning_to_landfill") {
          tone = "amber";
          icon = "landfill";
        } else if (truck.operationalStatus === "stopped") {
          tone = "red";
          icon = "stopped";
        } else if (truck.operationalStatus === "offline") {
          tone = "gray";
          icon = "truck";
        }

        const isSelected = String(truck.vehicleId) === String(selectedTruckId);

        const progressText = truck.assignedRoute
          ? ` · ${truck.completedStops}/${truck.totalStops} stops (${truck.progressPercent}%)`
          : "";

        return {
          key: `truck:${truck.vehicleId}`,
          label: `${truck.vehicleCode} (${truck.driverName}) · ${truck.operationalStatus.replace(/_/g, " ").toUpperCase()}${progressText}`,
          latitude: truck.latitude!,
          longitude: truck.longitude!,
          delayed: truck.lastGpsAgeMs > operationsConfig.gpsDelayedSeconds * 1000,
          tone: isSelected ? "green" : tone,
          icon,
          small: false,
        };
      });

    const seenOverflowBinIds = new Set<string>();
    const overflowBinMarkers: LiveFleetMapMarker[] = [];
    for (const ev of activeOverflowEvents) {
      if (ev.status === "declined") continue;
      for (const ob of ev.overflow_bins ?? []) {
        const bid = String(ob.bin_id);
        if (seenOverflowBinIds.has(bid)) continue;
        if (!isValidLngLat(ob.lat, ob.lng)) continue;
        seenOverflowBinIds.add(bid);
        const targetVeh = ev.target_vehicle_id != null ? vehicleById.get(String(ev.target_vehicle_id)) : null;
        overflowBinMarkers.push({
          key: `overflow-bin:${bid}`,
          label: `Overflow Stop ${ob.location ?? `#${bid}`}${targetVeh ? ` -> ${targetVeh.label}` : " (Pending)"}`,
          latitude: Number(ob.lat),
          longitude: Number(ob.lng),
          delayed: false,
          tone: "amber",
          icon: "bin",
          small: true,
        });
      }
    }

    return [...truckMarkers, ...overflowBinMarkers];
  }, [activeOverflowEvents, filteredTrucks, operationsConfig.gpsDelayedSeconds, selectedTruckId, vehicleById]);

  const [liveMapRoutes, setLiveMapRoutes] = useState<LiveFleetMapRoute[]>([]);

  // Resolve road-following Mapbox route polylines for active overflow assisting trucks and selected truck
  const overflowRouteRequests = useMemo(() => {
    const requests: Array<{ id: string; label: string; color: string; selected: boolean; waypoints: LngLat[] }> = [];
    const seenRouteKeys = new Set<string>();

    for (const ev of activeOverflowEvents) {
      if (!ev.target_vehicle_id || (ev.status !== "dispatched" && ev.status !== "accepted")) continue;
      const vehId = String(ev.target_vehicle_id);
      const truck = monitoredTrucks.find((t) => String(t.vehicleId) === vehId);
      const pts: LngLat[] = [];
      if (truck && isValidLngLat(truck.latitude, truck.longitude)) {
        pts.push([Number(truck.longitude), Number(truck.latitude)]);
      }
      for (const ob of ev.overflow_bins ?? []) {
        if (isValidLngLat(ob.lat, ob.lng)) {
          pts.push([Number(ob.lng), Number(ob.lat)]);
        }
      }
      if (isValidLngLat(landfillSetting.latitude, landfillSetting.longitude)) {
        pts.push([landfillSetting.longitude, landfillSetting.latitude]);
      }
      if (pts.length >= 2) {
        const sig = `${ev.id}:${pts.map(([lng, lat]) => `${lng.toFixed(3)},${lat.toFixed(3)}`).join("|")}`;
        if (!seenRouteKeys.has(sig)) {
          seenRouteKeys.add(sig);
          requests.push({
            id: `overflow-${ev.id}`,
            label: `Relief Route: ${truck?.vehicleName ?? `Truck ${vehId}`} (${ev.bins_count} overflow stops -> ${landfillSetting.name})`,
            color: "#d97706",
            selected: true,
            waypoints: pts,
          });
        }
      }
    }

    if (selectedTruck?.assignedRoute && isValidLngLat(selectedTruck.latitude, selectedTruck.longitude)) {
      const completedBinSet = new Set(
        deliveries
          .filter(
            (d) =>
              String(d.route_id) === String(selectedTruck.assignedRoute!.id) &&
              ["completed", "cancelled"].includes(normalizeStatus(d.status)),
          )
          .map((d) => String(d.bin_id)),
      );
      const pts: LngLat[] = [[Number(selectedTruck.longitude), Number(selectedTruck.latitude)]];
      routeStops
        .filter((rs) => String(rs.route_id) === String(selectedTruck.assignedRoute!.id) && !completedBinSet.has(String(rs.bin_id)))
        .sort((a, b) => a.stop_order - b.stop_order)
        .forEach((rs) => {
          if (rs.bins && isValidLngLat(rs.bins.latitude, rs.bins.longitude)) {
            pts.push([Number(rs.bins.longitude), Number(rs.bins.latitude)]);
          }
        });
      if (isValidLngLat(landfillSetting.latitude, landfillSetting.longitude)) {
        pts.push([landfillSetting.longitude, landfillSetting.latitude]);
      }
      if (pts.length >= 2) {
        requests.push({
          id: `selected-truck-${selectedTruck.vehicleId}`,
          label: `Active Route: ${selectedTruck.vehicleName} -> ${landfillSetting.name}`,
          color: "#059669",
          selected: true,
          waypoints: pts,
        });
      }
    }

    return requests;
  }, [activeOverflowEvents, deliveries, landfillSetting.latitude, landfillSetting.longitude, landfillSetting.name, monitoredTrucks, routeStops, selectedTruck]);

  useEffect(() => {
    if (overflowRouteRequests.length === 0) {
      setLiveMapRoutes([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      overflowRouteRequests.map(async (req): Promise<LiveFleetMapRoute | null> => {
        const res = await fetchStreetRouteGeometry(req.id, req.waypoints);
        if (!res || res.coordinates.length < 2) return null;
        return {
          id: req.id,
          label: req.label,
          color: req.color,
          coordinates: res.coordinates,
          selected: req.selected,
        };
      }),
    ).then((resolved) => {
      if (!cancelled) {
        setLiveMapRoutes(resolved.filter((r): r is LiveFleetMapRoute => r !== null));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [overflowRouteRequests]);

  // KPIs
  const kpis = useMemo(() => {
    const total = monitoredTrucks.length;
    const online = monitoredTrucks.filter((t) => t.isOnline).length;
    const onRoute = monitoredTrucks.filter((t) => t.operationalStatus === "on_route").length;
    const returningLandfill = monitoredTrucks.filter((t) => t.operationalStatus === "returning_to_landfill").length;
    const stopped = monitoredTrucks.filter((t) => t.operationalStatus === "stopped").length;
    return { total, online, onRoute, returningLandfill, stopped };
  }, [monitoredTrucks]);

  const handleSelectTruck = (truck: MonitoredTruck) => {
    setSelectedTruckId(truck.vehicleId);
    setConfirmFullTruck(false);
  };

  const visibleOverflowLog = useMemo(
    () => overflowLog.filter((entry) => new Date(entry.timestamp).getTime() > logClearedAfterMs),
    [logClearedAfterMs, overflowLog],
  );

  const handleClearTodayOverflowLog = () => {
    const nowMs = Date.now();
    setLogClearedAfterMs(nowMs);
    setShowOverflowLog(false);
    try {
      sessionStorage.setItem("ecoloop_overflow_log_cleared_ms", String(nowMs));
    } catch {
      /* ignore sessionStorage unavailability */
    }
  };

  const handleConfirmDeleteOverflow = async () => {
    if (!confirmDeleteOverflowId) return;
    const id = confirmDeleteOverflowId;
    setConfirmDeleteOverflowId(null);
    await runOverflowAction(() => deleteOverflowEvent(id), "Overflow event deleted.");
  };

  const handleConfirmReassignOverflow = async (eventId: string, overrideVehicleId?: string) => {
    const target = overrideVehicleId ?? reassignVehicleId;
    if (!target) return;
    await runOverflowAction(
      () => reassignOverflow(eventId, target),
      target === "AUTO"
        ? "Dynamic Reassignment Engine assigned eligible relief truck(s)."
        : "Relief truck validated, assigned, and notified.",
    );
    setReassigningEventId(null);
    setReassignVehicleId("");
  };

  const runOverflowAction = async (action: () => Promise<unknown>, notice: string) => {
    setOverflowBusy(true);
    setOverflowError(null);
    setOverflowNotice(null);
    try {
      await action();
      setOverflowNotice(notice);
    } catch (err) {
      setOverflowError(err instanceof Error ? err.message : "Overflow dispatch action failed.");
    } finally {
      setOverflowBusy(false);
    }
  };

  const handleDispatchSelectedTruckOverflow = async () => {
    if (!selectedTruck?.assignedRoute || !selectedTruck.driverId) return;
    setOverflowBusy(true);
    setOverflowError(null);
    setOverflowNotice(null);
    try {
      const result = await signalTruckFull(
        selectedTruck.vehicleId,
        selectedTruck.driverId,
        selectedTruck.assignedRoute.id,
        selectedAlgorithm,
      );
      if (!result) {
        setOverflowNotice("No uncollected stops remain on this route.");
      } else if (result.assignments && result.assignments.length > 1) {
        const list = result.assignments.map((a) => `${a.label} (${a.stopsCount} stops)`).join(", ");
        setOverflowNotice(
          `Overflow dynamically distributed across ${result.assignments.length} relief trucks: ${list}.`,
        );
      } else if (result.nearest) {
        setOverflowNotice(
          `Overflow dispatched to ${result.nearest.vehicle.label} (${result.nearest.distanceKm} km away).`,
        );
      } else {
        setOverflowNotice(
          result.algorithmResult?.message ||
            "Overflow event recorded. No eligible truck with verified GPS, driver, and capacity found — manual dispatch required.",
        );
      }
      setConfirmFullTruck(false);
    } catch (err) {
      setOverflowError(err instanceof Error ? err.message : "Unable to dispatch relief truck.");
    } finally {
      setOverflowBusy(false);
    }
  };

  const canManageFleet = useMemo(() => {
    const r = String(role || "").toLowerCase();
    return r === "admin" || r === "dispatcher";
  }, [role]);

  const openMaintenanceCount = useMemo(
    () =>
      maintenanceRecords.filter((m) => {
        const s = normalizeStatus(m.status);
        return s === "scheduled" || s === "in_progress";
      }).length,
    [maintenanceRecords],
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Live Monitoring"
        subtitle="Real-time truck GPS tracking, fleet registry, maintenance, and relief dispatch"
        icon={<Radio className="size-5" aria-hidden="true" />}
        onNavigate={onNavigate as any}
      />

      {/* Unified Live Monitoring & Fleet Management Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1" role="tablist" aria-label="Live monitoring and fleet views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "live"}
            onClick={() => setActiveTab("live")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md inline-flex items-center gap-1.5 transition-colors ${
              activeTab === "live" ? "bg-emerald-600 text-white shadow-xs" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Radio className="size-4" aria-hidden="true" />
            <span>Live Map &amp; Dispatch ({monitoredTrucks.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "fleet"}
            onClick={() => setActiveTab("fleet")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md inline-flex items-center gap-1.5 transition-colors ${
              activeTab === "fleet" ? "bg-emerald-600 text-white shadow-xs" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Wrench className="size-4" aria-hidden="true" />
            <span>
              Fleet &amp; Maintenance ({vehicles.length}
              {openMaintenanceCount > 0 ? ` · ${openMaintenanceCount} Open` : ""})
            </span>
          </button>
        </div>
      </div>

      {activeTab === "fleet" ? (
        <FleetMaintenancePanel canManage={canManageFleet} />
      ) : (
        <>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {overflowError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{overflowError}</div>}
      {overflowNotice && (
        <div role="status" className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{overflowNotice}</span>
          <button type="button" onClick={() => setOverflowNotice(null)} className="p-1 text-emerald-700 hover:text-emerald-900" aria-label="Dismiss notice">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Operational Status KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fleet Active</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1">
            {kpis.online} <span className="text-sm font-normal text-gray-500">/ {kpis.total}</span>
          </div>
          <div className="text-emerald-700 font-medium text-xs mt-1 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span>GPS Reporting</span>
          </div>
        </div>
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">On Route</div>
          <div className="text-2xl sm:text-3xl font-bold text-emerald-700 tabular-nums mt-1">
            {kpis.onRoute}
          </div>
          <div className="text-gray-600 text-xs mt-1">Collecting waste</div>
        </div>
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Returning / Unloading</div>
          <div className="text-2xl sm:text-3xl font-bold text-amber-700 tabular-nums mt-1">
            {kpis.returningLandfill}
          </div>
          <div className="text-amber-800 font-medium text-xs mt-1">SWMO Landfill</div>
        </div>
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Stopped / Delayed</div>
          <div className="text-2xl sm:text-3xl font-bold text-red-700 tabular-nums mt-1">
            {kpis.stopped}
          </div>
          <div className="text-red-700 font-medium text-xs mt-1">Idle &gt;20s</div>
        </div>
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-gray-200 col-span-2 sm:col-span-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Collection Areas</div>
          <div className="text-2xl sm:text-3xl font-bold text-indigo-700 tabular-nums mt-1">
            {loading ? "..." : collectionAreas.length}
          </div>
          <div className="text-indigo-700 text-xs mt-1">Official SWMO Routes</div>
        </div>
      </div>

      {/* Inline Overflow & Relief Dispatch Panel (surfaces active overflow events without leaving Live Monitoring) */}
      {(activeOverflowEvents.length > 0 || visibleOverflowLog.length > 0) && (
        <div className={`rounded-xl border shadow-xs overflow-hidden bg-white ${activeOverflowEvents.length > 0 ? "border-amber-300" : "border-gray-200"}`}>
          <div className={`px-4 sm:px-5 py-3.5 border-b flex flex-wrap items-center justify-between gap-3 ${activeOverflowEvents.length > 0 ? "bg-amber-50/80 border-amber-200" : "bg-gray-50/70 border-gray-200"}`}>
            <div className="flex items-center gap-2.5">
              <ArrowRightLeft className={`size-5 ${activeOverflowEvents.length > 0 ? "text-amber-700" : "text-emerald-700"}`} />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900 text-sm sm:text-base">Overflow &amp; Relief Dispatches</h3>
                  {activeOverflowEvents.length > 0 && (
                    <span className="inline-flex items-center rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                      {activeOverflowEvents.length} Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600">
                  Real-time truck capacity alerts and uncollected stop transfers across the fleet.
                </p>
              </div>
            </div>
            {visibleOverflowLog.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowOverflowLog((prev) => !prev)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {showOverflowLog ? "Hide Event Log" : `Event Log (${visibleOverflowLog.length})`}
                </button>
                {activeOverflowEvents.length === 0 && (
                  <button
                    type="button"
                    onClick={handleClearTodayOverflowLog}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Clear Log
                  </button>
                )}
              </div>
            )}
          </div>

          {activeOverflowEvents.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 text-left text-gray-600 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Full Truck</th>
                    <th className="px-4 py-2.5 font-semibold">Route</th>
                    <th className="px-4 py-2.5 font-semibold">Stops</th>
                    <th className="px-4 py-2.5 font-semibold">Relief Truck</th>
                    <th className="px-4 py-2.5 font-semibold">Method</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeOverflowEvents.map((event) => {
                    const sourceVeh = event.source_vehicle_id != null ? vehicleById.get(String(event.source_vehicle_id)) : null;
                    const targetVeh = event.target_vehicle_id != null ? vehicleById.get(String(event.target_vehicle_id)) : null;
                    const sourceDrv = event.source_driver_id != null ? driverById.get(String(event.source_driver_id)) : null;
                    const targetDrv = event.target_driver_id != null ? driverById.get(String(event.target_driver_id)) : null;
                    const sourceRoute = event.source_route_id != null ? routeById.get(String(event.source_route_id)) : null;
                    return (
                      <React.Fragment key={event.id}>
                        <tr>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{sourceVeh?.label ?? `Truck ${event.source_vehicle_id}`}</p>
                            <p className="text-xs text-gray-500">{sourceDrv?.name ?? "Driver"}</p>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{sourceRoute?.name ?? "—"}</td>
                          <td className="px-4 py-3 text-gray-700 tabular-nums">{event.bins_count}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{targetVeh?.label ?? (event.target_vehicle_id ? `Truck ${event.target_vehicle_id}` : "Unassigned")}</p>
                            <p className="text-xs text-gray-500">
                              {targetDrv?.name ?? "No driver"}
                              {event.distance_km != null ? ` · ${event.distance_km} km` : ""}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {event.reassignment_metadata?.algorithm === "nearest-baseline" ? (
                                <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                                  Nearest Available
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                  <Sparkles className="size-3 text-emerald-600" /> Dynamic Engine
                                </span>
                              )}
                              {event.reassignment_metadata?.isMultiTruck && (
                                <span className="inline-flex items-center rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                                  Split {event.reassignment_metadata.splitIndex ?? 1}/{event.reassignment_metadata.splitCount ?? 2}
                                </span>
                              )}
                              {event.reassignment_metadata?.capacityValidated === false && (
                                <span
                                  className="inline-flex items-center rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                                  title={event.reassignment_metadata.capacityValidationNote || "Estimated from route progress"}
                                >
                                  Est. Capacity
                                </span>
                              )}
                            </div>
                            {event.reassignment_metadata?.evaluations?.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setExpandedEventId(expandedEventId === event.id ? null : event.id)}
                                className="block text-[10px] text-emerald-700 hover:underline mt-0.5"
                              >
                                {expandedEventId === event.id ? "Hide scores" : "View scores"}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium capitalize text-amber-800">
                              {event.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canManageFleet ? (
                              <div className="flex flex-wrap justify-end gap-1.5">
                                {event.status === "dispatched" && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={overflowBusy}
                                      onClick={() => void runOverflowAction(() => acceptOverflow(event.id), "Overflow dispatch accepted.")}
                                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      <CheckCircle2 className="size-3.5" /> Accept
                                    </button>
                                    <button
                                      type="button"
                                      disabled={overflowBusy}
                                      onClick={() => void runOverflowAction(() => declineOverflow(event.id), "Overflow dispatch declined.")}
                                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      <XCircle className="size-3.5" /> Decline
                                    </button>
                                    <button
                                      type="button"
                                      disabled={overflowBusy}
                                      onClick={() => void runOverflowAction(() => completeOverflow(event.id), "Overflow event resolved.")}
                                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      Dismiss
                                    </button>
                                  </>
                                )}
                                {event.status === "accepted" && (
                                  <button
                                    type="button"
                                    disabled={overflowBusy}
                                    onClick={() => void runOverflowAction(() => completeOverflow(event.id), "Overflow collection marked completed.")}
                                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    <CheckCircle2 className="size-3.5" /> Complete
                                  </button>
                                )}
                                {(event.status === "pending" || event.status === "declined") && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={overflowBusy}
                                      onClick={() => {
                                        if (reassigningEventId === event.id) {
                                          setReassigningEventId(null);
                                          setReassignVehicleId("");
                                        } else {
                                          setReassigningEventId(event.id);
                                          setReassignVehicleId("");
                                        }
                                      }}
                                      className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                                    >
                                      <ArrowRightLeft className="size-3.5" /> Reassign
                                    </button>
                                    <button
                                      type="button"
                                      disabled={overflowBusy}
                                      onClick={() => void runOverflowAction(() => completeOverflow(event.id), "Overflow event resolved.")}
                                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      <CheckCircle2 className="size-3.5" /> Resolve
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  disabled={overflowBusy}
                                  onClick={() => setConfirmDeleteOverflowId(event.id)}
                                  className="inline-flex items-center justify-center rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                  aria-label="Delete overflow dispatch"
                                  title="Delete overflow dispatch"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-500 capitalize">{event.status}</span>
                            )}
                          </td>
                        </tr>
                        {reassigningEventId === event.id && canManageFleet && (() => {
                          const algoStops: UncollectedStop[] = (event.overflow_bins ?? []).map((ob, idx) => ({
                            id: `stop-${ob.bin_id}`,
                            binId: ob.bin_id,
                            coordinate: { lat: Number(ob.lat ?? 0), lng: Number(ob.lng ?? 0) },
                            stopOrder: ob.stop_order ?? idx + 1,
                            location: ob.location || "Stop",
                            capacityPercent: ob.capacity_percent ?? null,
                          }));
                          const evalRes = findMultiCriteriaOptimalTruck(
                            String(event.source_vehicle_id ?? ""),
                            algoStops,
                            event.id,
                          );
                          const rankedOptions = [...evalRes.evaluations]
                            .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.rank - b.rank)
                            .map((ev) => ({
                              value: ev.vehicleId,
                              disabled: !ev.eligible,
                              label: ev.eligible
                                ? `#${ev.rank} ${ev.label} · ${ev.driverName} (${ev.remainingCapacityPercent}% free, +${ev.additionalDistanceKm} km)`
                                : `${ev.label} · Unavailable (${ev.ineligibleReason})`,
                            }));
                          return (
                            <tr className="bg-amber-50/50">
                              <td colSpan={7} className="px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <span className="text-xs font-medium text-amber-900 block">
                                      Assign relief truck for {sourceVeh?.label ?? `Truck ${event.source_vehicle_id}`} ({event.bins_count} stops):
                                    </span>
                                    {evalRes.capacityValidationNote && (
                                      <span className="text-[11px] text-amber-700">{evalRes.capacityValidationNote}</span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={overflowBusy || evalRes.assignments.length === 0}
                                      onClick={() => void handleConfirmReassignOverflow(event.id, "AUTO")}
                                      className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      <Sparkles className="size-3" /> Auto-Assign Optimal
                                    </button>
                                    <CustomSelect
                                      value={reassignVehicleId}
                                      onChange={(val) => setReassignVehicleId(String(val))}
                                      size="sm"
                                      placeholder="Select eligible relief truck..."
                                      options={rankedOptions}
                                    />
                                    <button
                                      type="button"
                                      disabled={overflowBusy || !reassignVehicleId}
                                      onClick={() => void handleConfirmReassignOverflow(event.id)}
                                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      Dispatch Relief
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReassigningEventId(null);
                                        setReassignVehicleId("");
                                      }}
                                      className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })()}
                        {expandedEventId === event.id && event.reassignment_metadata?.evaluations && (
                          <tr className="bg-gray-50/80">
                            <td colSpan={7} className="px-4 py-3">
                              <div className="text-xs space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-gray-800 flex items-center gap-1.5">
                                    <Scale className="size-3.5 text-gray-500" /> Candidate Truck Evaluation Breakdown
                                  </span>
                                  <span className="text-gray-500 text-[11px]">
                                    Detour: +{event.reassignment_metadata.additionalDistanceKm ?? 0} km
                                  </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                  {(event.reassignment_metadata.evaluations as any[]).map((cand: any) => (
                                    <div
                                      key={cand.vehicleId}
                                      className={`p-2 rounded border text-[11px] ${
                                        cand.rank === 1 ? "bg-emerald-50 border-emerald-300 text-emerald-950" : "bg-white border-gray-200 text-gray-700"
                                      }`}
                                    >
                                      <div className="flex justify-between font-semibold">
                                        <span>{cand.label}</span>
                                        <span>
                                          {!cand.eligible
                                            ? "Excluded"
                                            : cand.rank === 1
                                              ? "Selected (#1)"
                                              : `#${cand.rank}`}
                                        </span>
                                      </div>
                                      <div className="mt-1 text-gray-600">
                                        {!cand.eligible
                                          ? cand.ineligibleReason || "Ineligible for reassignment"
                                          : `Dist: ${cand.distanceToStopsKm} km · Detour: +${cand.additionalDistanceKm} km · Load: ${cand.projectedLoadPercent}% · Score: ${cand.compositeScore}`}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {showOverflowLog && visibleOverflowLog.length > 0 && (
            <div className="p-4 border-t border-gray-200 bg-gray-50/50">
              <OverflowEventLog entries={visibleOverflowLog} loading={loading} />
            </div>
          )}
        </div>
      )}

        {/* Interactive Map Card */}
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/70">
            <div className="flex items-center gap-2.5">
              <MapPin className="size-5 text-emerald-700 shrink-0" />
              <div>
                <h3 className="font-semibold text-gray-900 text-base">Live Fleet Map</h3>
                <p className="text-xs text-gray-600">
                  Real-time truck driver GPS positions and operational status.
                </p>
              </div>
            </div>
          </div>

          <div className="relative">
            <LiveFleetMap
              markers={mapMarkers}
              routes={liveMapRoutes}
              loading={loading}
              onMarkerClick={(key) => {
                if (key.startsWith("truck:")) {
                  const vId = key.replace(/^truck:/, "");
                  const t = monitoredTrucks.find((item) => String(item.vehicleId) === vId);
                  if (t) handleSelectTruck(t);
                }
              }}
              showLandfill={mapDefaults.showLandfillOnLiveMap}
              emptyMessage="No active truck GPS locations."
              className="relative h-[480px] sm:h-[560px] w-full overflow-hidden bg-gray-100"
            />

            {/* Map Legend */}
            <div className="absolute left-3 bottom-3 z-10 rounded-lg bg-white/95 px-3 py-2.5 shadow-md text-xs text-gray-700 space-y-1.5 max-w-[280px] border border-gray-200">
              <div className="font-semibold text-gray-900 text-[11px] uppercase tracking-wider">Fleet Status Legend</div>
              <div className="flex items-center gap-2 text-[11px]">
                <Truck className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>Truck On Route (Active collection)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <Recycle className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                <span>Returning to Landfill / Disposal</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <OctagonAlert className="size-3.5 shrink-0 text-red-600" aria-hidden="true" />
                <span>Truck Stopped / Delayed GPS (&gt;{operationsConfig.gpsDelayedSeconds}s)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <Truck className="size-3.5 shrink-0 text-blue-600" aria-hidden="true" />
                <span>Available / Idle Truck</span>
              </div>
            </div>
          </div>
        </div>

        {/* Selected Truck Detail Drawer */}
        {selectedTruck && (
          <div className="bg-white rounded-xl shadow-md border-2 border-emerald-500/80 p-5 sm:p-6 transition-all">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-gray-200 pb-4">
              <div className="flex items-start gap-3.5">
                <div className="size-11 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-800 shrink-0">
                  <Truck className="size-6" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-900">{selectedTruck.vehicleName}</h3>
                    {selectedTruck.vehicleCode !== selectedTruck.vehicleName && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700">
                        ID: {selectedTruck.vehicleCode}
                      </span>
                    )}
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700">
                      Plate: {selectedTruck.vehiclePlate ?? "Unavailable"}
                    </span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                        selectedTruck.assignedRoute
                          ? selectedTruck.isReturningToLandfill
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      Route Status: {selectedTruck.routeStatusLabel}
                    </span>
                  </div>
                  <div className="flex items-center flex-wrap gap-3 mt-1.5 text-xs text-gray-600">
                    <span>
                      Driver: <strong className="text-gray-900">{selectedTruck.driverName}</strong>
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <span className={`size-2 rounded-full ${selectedTruck.isOnline ? "bg-emerald-500" : "bg-gray-400"}`} />
                      <span>{selectedTruck.isOnline ? "Online" : "Offline"}</span>
                    </span>
                    <span>•</span>
                    <span>
                      Last GPS:{" "}
                      {selectedTruck.lastGpsUpdate
                        ? `${relativeTime(selectedTruck.lastGpsUpdate)} (${formatDateTime(selectedTruck.lastGpsUpdate)})`
                        : "No GPS signal"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedTruckId(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5">
              <div className="bg-gray-50 p-3.5 rounded-lg border border-gray-100 text-xs space-y-1">
                <div className="text-gray-500 font-medium">Assigned Collection Area</div>
                <div className="text-sm font-bold text-gray-900">
                  {selectedTruck.assignedAreaName ||
                    selectedTruck.assignedAreaCode ||
                    (selectedTruck.assignedRoute ? "Area unavailable" : "Unassigned")}
                </div>
              </div>

              <div className="bg-gray-50 p-3.5 rounded-lg border border-gray-100 text-xs space-y-1">
                <div className="text-gray-500 font-medium">Assigned Route</div>
                <div className="text-sm font-bold text-gray-900">
                  {selectedTruck.assignedRoute
                    ? `${selectedTruck.assignedRoute.name} (#${selectedTruck.assignedRoute.id})`
                    : "No assigned route"}
                </div>
                <div className="text-[11px] text-gray-500">Status: {selectedTruck.routeStatusLabel}</div>
              </div>

              <div className="bg-gray-50 p-3.5 rounded-lg border border-gray-100 text-xs space-y-1">
                <div className="text-gray-500 font-medium">Speed & Coordinates</div>
                <div className="text-sm font-bold font-mono text-gray-900">
                  {selectedTruck.speedKph.toFixed(0)} km/h
                  {selectedTruck.latitude && selectedTruck.longitude && (
                    <span className="text-xs font-normal text-gray-500 block">
                      {selectedTruck.latitude.toFixed(4)}, {selectedTruck.longitude.toFixed(4)}
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 p-3.5 rounded-lg border border-gray-100 text-xs space-y-1.5">
                <div className="text-gray-500 font-medium flex items-center justify-between">
                  <span>Collection Progress</span>
                  <span>{selectedTruck.progressPercent}%</span>
                </div>
                <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all duration-300"
                    style={{ width: `${selectedTruck.progressPercent}%` }}
                  />
                </div>
                <div className="text-[11px] text-gray-500">
                  {selectedTruck.completedStops} of {selectedTruck.totalStops} stops completed
                </div>
              </div>
            </div>

            {selectedTruck.assignedRoute &&
              selectedTruck.driverId &&
              ["active", "in_progress", "started", "accepted", "en_route", "pending", "planned"].includes(
                normalizeStatus(selectedTruck.assignedRoute.status),
              ) &&
              selectedTruck.completedStops < selectedTruck.totalStops && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  {!confirmFullTruck ? (
                    <button
                      type="button"
                      onClick={() => setConfirmFullTruck(true)}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700"
                    >
                      <AlertTriangle className="size-4" />
                      Dispatch Relief Truck (Overflow Reassignment)
                    </button>
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                      <p className="text-xs sm:text-sm text-amber-900 font-medium">
                        Dispatch a relief truck for the remaining {selectedTruck.totalStops - selectedTruck.completedStops} uncollected stop(s) on {selectedTruck.assignedRoute.name}?
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setSelectedAlgorithm("multi-criteria")}
                          className={`p-2 rounded-md border text-left font-medium transition-colors ${
                            selectedAlgorithm === "multi-criteria"
                              ? "bg-emerald-600 text-white border-emerald-700"
                              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-center gap-1 font-bold">
                            <Sparkles className="size-3" /> Optimal Route &amp; Capacity
                          </div>
                          <span className="text-[10px] opacity-90 block mt-0.5">Balances distance, detour, and capacity</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedAlgorithm("nearest-baseline")}
                          className={`p-2 rounded-md border text-left font-medium transition-colors ${
                            selectedAlgorithm === "nearest-baseline"
                              ? "bg-gray-800 text-white border-gray-900"
                              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          <div className="font-bold">Nearest Available</div>
                          <span className="text-[10px] opacity-90 block mt-0.5">Assigns closest idle truck</span>
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={overflowBusy}
                          onClick={() => void handleDispatchSelectedTruckOverflow()}
                          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {overflowBusy ? "Dispatching..." : "Confirm Relief Dispatch"}
                        </button>
                        <button
                          type="button"
                          disabled={overflowBusy}
                          onClick={() => setConfirmFullTruck(false)}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>
        )}

        {/* Live Fleet Directory & Filters */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Active Trucks Directory</h3>
              <p className="text-xs text-gray-600">Real-time driver connectivity, route progress, and collection status.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="size-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search truck, driver, area..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg text-gray-700 w-44 sm:w-56 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <CustomSelect
                size="sm"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "ALL", label: "All Statuses" },
                  { value: "ONLINE", label: "Online Drivers" },
                  { value: "ON_ROUTE", label: "On Route" },
                  { value: "LANDFILL", label: "Returning to Landfill" },
                  { value: "STOPPED", label: "Stopped / Delayed" },
                  { value: "OFFLINE", label: "Offline" },
                ]}
                className="min-w-[165px]"
                ariaLabel="Filter by truck status"
              />

              <CustomSelect
                size="sm"
                value={areaFilter}
                onChange={setAreaFilter}
                options={[
                  { value: "ALL", label: "All Areas" },
                  ...collectionAreas.map((a) => ({ value: a.areaCode, label: a.areaName })),
                ]}
                className="min-w-[230px]"
                ariaLabel="Filter by collection area"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTrucks.map((truck) => {
              const isSelected = String(truck.vehicleId) === String(selectedTruckId);

              return (
                <div
                  key={truck.vehicleId}
                  onClick={() => handleSelectTruck(truck)}
                  className={`bg-white rounded-xl border p-5 cursor-pointer transition-all hover:shadow-md ${
                    isSelected ? "ring-2 ring-emerald-500 border-emerald-500 shadow-sm" : "border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                        <Truck className="size-4 text-emerald-700" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-gray-900 text-sm">{truck.vehicleName}</h4>
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              truck.isOnline ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            <span className={`size-1.5 rounded-full ${truck.isOnline ? "bg-emerald-500" : "bg-gray-400"}`} />
                            <span>{truck.isOnline ? "Online" : "Offline"}</span>
                          </span>
                        </div>
                        <p className="text-xs text-gray-600">
                          {truck.driverName}
                          {truck.vehiclePlate ? ` • ${truck.vehiclePlate}` : ""}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        truck.operationalStatus === "on_route"
                          ? "bg-emerald-100 text-emerald-800"
                          : truck.operationalStatus === "returning_to_landfill"
                            ? "bg-amber-100 text-amber-800"
                            : truck.operationalStatus === "stopped"
                              ? "bg-red-100 text-red-800"
                              : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {truck.routeStatusLabel}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs text-gray-600 mb-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500 shrink-0">Vehicle ID:</span>
                      <span className="font-medium text-gray-800 truncate">{truck.vehicleCode}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500 shrink-0">Collection Area:</span>
                      <span className="font-semibold text-gray-900 truncate">
                        {truck.assignedAreaName ||
                          truck.assignedAreaCode ||
                          (truck.assignedRoute ? "Area unavailable" : "Unassigned")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500 shrink-0">Assigned Route:</span>
                      <span
                        className="font-medium text-gray-800 truncate max-w-[180px]"
                        title={truck.assignedRoute ? `${truck.assignedRoute.name} (#${truck.assignedRoute.id})` : "No assigned route"}
                      >
                        {truck.assignedRoute ? `${truck.assignedRoute.name} (#${truck.assignedRoute.id})` : "No assigned route"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500 shrink-0">Route Status:</span>
                      <span className="font-medium text-gray-800">{truck.routeStatusLabel}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500 shrink-0">Last GPS Update:</span>
                      <span className="font-medium text-gray-700">
                        {truck.lastGpsUpdate ? relativeTime(truck.lastGpsUpdate) : "No GPS signal"}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {truck.assignedRoute ? (
                    <div className="pt-2.5 border-t border-gray-100 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-gray-500">
                        <span>Collection Progress</span>
                        <span className="font-semibold text-gray-900">
                          {truck.completedStops}/{truck.totalStops} stops ({truck.progressPercent}%)
                        </span>
                      </div>
                      <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full transition-all duration-300"
                          style={{ width: `${truck.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2.5 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
                      <span>Collection Progress</span>
                      <span>No active route</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-100 text-xs">
                    <span className="text-gray-500 font-mono text-[11px]">
                      {truck.speedKph.toFixed(0)} km/h
                    </span>
                    <span className="text-emerald-700 font-medium hover:underline flex items-center gap-1 text-[11px]">
                      <span>Locate on map</span>
                      <span>→</span>
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredTrucks.length === 0 && (
              <div className="col-span-full rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 text-sm">
                No active trucks match the selected filters.
              </div>
            )}
          </div>
        </div>
        </>
      )}

      <ConfirmModal
        isOpen={Boolean(confirmDeleteOverflowId)}
        onClose={() => setConfirmDeleteOverflowId(null)}
        onConfirm={handleConfirmDeleteOverflow}
        title="Delete Overflow Dispatch"
        message="Permanently delete this overflow dispatch record from the database? If you only want to close it while keeping history, use Resolve/Dismiss instead."
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
