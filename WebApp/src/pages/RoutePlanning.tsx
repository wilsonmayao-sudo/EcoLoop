import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Bell, ChevronDown, ChevronUp, Eye, Loader2, MapPin, Plus, Trash2, X } from "lucide-react";
import ConfirmModal from "../components/feedback/ConfirmModal";
import Toast from "../components/feedback/Toast";
import PageHeader from "../components/layout/PageHeader";
import { formatDistanceKm, formatDurationMinutes } from "../utils/routing/geo";
import TrafficRouteMapPreview, { type RoutePreviewStop } from "../components/maps/TrafficRouteMapPreview";
import {
  fetchStreetRouteWithFeedback,
  isMapboxDirectionsConfigured,
  type LngLat,
} from "../services/streetRouteService";
import {
  createRouteAssignment,
  findRouteAssignmentConflict,
  generateRouteRequestKey,
  type ExistingOpenRouteCandidate,
} from "../services/routeAssignmentService";
import { supabase } from "../services/supabaseClient";
import { formatDateOnly, normalizeStatus, useLiveData, type PageType } from "../hooks/useLiveData";
import CustomSelect from "../components/ui/CustomSelect";
import {
  doesAreaMatchScheduleDay,
  doesScheduleMatchDay,
  formatScheduleDaysLabel,
  SCHEDULE_DAY_CODES,
} from "../utils/scheduleDays";
import {
  cleanCollectionAreaTitle,
  formatAreaScheduleLabel,
  formatCollectionAreaDisplay,
} from "../utils/areaDisplay";

function labelRouteStatus(status: string) {
  const n = (status ?? "").toLowerCase();
  if (n === "planned" || n === "pending") return "Pending";
  if (n === "active") return "Active";
  if (n === "completed") return "Completed";
  return status;
}

function routeStatusBadgeClass(status: string) {
  const n = (status ?? "").toLowerCase();
  if (n === "active") return "bg-green-100 text-green-700";
  if (n === "completed") return "bg-gray-100 text-gray-700";
  if (n === "planned" || n === "pending") return "bg-blue-100 text-blue-700";
  return "bg-gray-100 text-gray-700";
}

function labelOptimizationSource(route: Route) {
  if (route.costSource === "mapbox-directions" || route.costSource === "mapbox-traffic" || route.optimizationUsedTraffic) {
    return "Mapbox Directions";
  }
  if (route.costSource === "osrm" || route.optimizationMethod === "osrm") return "Road Directions (OSRM)";
  return "Saved Route";
}

async function notifyDriverRouteAssigned(params: {
  routeId: string;
  routeName: string;
  stopCount: number;
  driverAuthUserId: string | null | undefined;
}) {
  const { routeId, routeName, stopCount, driverAuthUserId } = params;
  if (!driverAuthUserId) return;
  try {
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("source_table", "routes")
      .eq("source_id", String(routeId))
      .eq("user_auth_id", driverAuthUserId)
      .eq("read", false)
      .limit(1);

    if (existing && existing.length > 0) return;

    const { error } = await supabase.from("notifications").insert({
      user_auth_id: driverAuthUserId,
      user_id: driverAuthUserId,
      role: "truck_driver",
      title: "New Route Assigned",
      message: `Route "${routeName}" has ${stopCount} stop${stopCount === 1 ? "" : "s"} (Pending). Open EcoLoop to accept it when ready.`,
      type: "info",
      category: "route",
      source_table: "routes",
      source_id: String(routeId),
      read: false,
      created_at: new Date().toISOString(),
    });
    if (error) console.warn("[EcoLoop] notifyDriverRouteAssigned:", error.message);
  } catch (err: any) {
    console.warn("[EcoLoop] notifyDriverRouteAssigned:", err?.message ?? err);
  }
}

interface RoutePlanningProps {
  onNavigate?: (page: PageType) => void;
}

interface Route {
  id: string;
  name: string;
  status: "pending" | "active" | "completed" | string;
  areaCode?: string | null;
  scheduledDays?: string[] | null;
  shiftLabel?: string | null;
  wasteCategory?: string | null;
  stops: number;
  distance: string;
  duration: string;
  distanceKm?: number;
  durationMinutes?: number;
  truck: string;
  driverId?: string | number | null;
  vehicleId?: string | number | null;
  coordinates?: [number, number];
  optimizedStops?: string[];
  stopDetails?: RoutePreviewStop[];
  /** Set when route directions were generated via Mapbox Directions API. */
  optimizationUsedTraffic?: boolean;
  optimizationMethod?: string;
  costSource?: string;
  generatedAt?: string;
  assignmentUpdatedAt?: string;
}

interface KnownBin {
  id: string | number;
  code: string;
  location: string;
  barangay?: string | null;
  areaCode?: string | null;
  scheduleDays?: string[] | null;
  scheduleTimeWindow?: string | null;
  collectionStatus?: string | null;
  coordinateStatus?: string | null;
  coordinates: [number, number];
}

interface Driver {
  id: string | number;
  name: string;
  status: string;
  auth_user_id?: string | null;
  assigned_vehicle_id?: string | number | null;
  last_seen_at?: string | null;
}

/**
 * Synchronizes vehicle <-> route/driver references when a route is created, reassigned, or deleted.
 * Clears stale vehicle route_id links before attaching the newly assigned vehicle.
 */
async function syncVehicleRouteAssignment(params: {
  routeId: string;
  driverId?: string | number | null;
  assignedVehicleId?: string | number | null;
}) {
  const { routeId, driverId, assignedVehicleId } = params;
  const routeKey = String(routeId);

  try {
    let targetVehicleId: string | number | null = assignedVehicleId ?? null;
    if (targetVehicleId == null && driverId != null) {
      const { data: driverVehicle } = await supabase
        .from("vehicles")
        .select("id")
        .eq("driver_id", String(driverId))
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (driverVehicle?.id != null) {
        targetVehicleId = driverVehicle.id;
      }
    }

    let clearQuery = supabase.from("vehicles").update({ route_id: null }).eq("route_id", routeKey);
    if (targetVehicleId != null) {
      clearQuery = clearQuery.neq("id", targetVehicleId);
    }
    await clearQuery;

    if (targetVehicleId != null) {
      const numericVehicleId = Number(targetVehicleId);
      const vehicleUpdates: Record<string, string | null> = { route_id: routeKey };
      if (driverId != null) {
        vehicleUpdates.driver_id = String(driverId);
      }
      await supabase.from("vehicles").update(vehicleUpdates).eq("id", targetVehicleId);

      if (Number.isFinite(numericVehicleId)) {
        await supabase.from("routes").update({ vehicle_id: numericVehicleId }).eq("id", routeId);
      }
    } else {
      await supabase.from("routes").update({ vehicle_id: null }).eq("id", routeId);
    }
  } catch (err: any) {
    console.warn("[EcoLoop] syncVehicleRouteAssignment:", err?.message ?? err);
  }
}
const DRIVER_ONLINE_STALE_MS = 60 * 1000;

function isDriverOnline(
  driver: Driver,
  onlineIds: Set<string>,
  currentNowMs: number,
  staleThresholdMs = DRIVER_ONLINE_STALE_MS,
): boolean {
  if (!driver || !driver.id) return false;
  const normalizedStatus = (driver.status ?? "").toLowerCase().trim();
  if (normalizedStatus === "inactive" || normalizedStatus === "suspended" || normalizedStatus === "offline") {
    return false;
  }

  // 1. Check Realtime Presence (active WebSocket presence)
  if (onlineIds.has(String(driver.id))) {
    return true;
  }

  // 2. Check fresh heartbeat via last_seen_at
  if (driver.last_seen_at) {
    const lastSeenMs = new Date(driver.last_seen_at).getTime();
    if (Number.isFinite(lastSeenMs)) {
      const diff = currentNowMs - lastSeenMs;
      if (diff >= 0 && diff <= staleThresholdMs) {
        return true;
      }
    }
  }

  // If status cannot be determined or stale -> offline
  return false;
}

function isValidRouteCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

const WEEKDAY_CODES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const FILTER_DAY_CODES = SCHEDULE_DAY_CODES;

export default function RoutePlanning({ onNavigate }: RoutePlanningProps) {
  const { depotSetting, landfillSetting, operationsConfig, collectionSchedules, createNotifications } = useLiveData();
  const driverStaleThresholdMs = operationsConfig.gpsStoppedSeconds * 1000;
  const DEPOT = useMemo(
    () => ({ id: depotSetting.id ?? "DEPOT", coordinate: { lat: Number(depotSetting.latitude), lng: Number(depotSetting.longitude) } }),
    [depotSetting.id, depotSetting.latitude, depotSetting.longitude],
  );
  const previewDepot = useMemo(
    () => ({ lat: DEPOT.coordinate.lat, lng: DEPOT.coordinate.lng, label: depotSetting.name || "Dispatch Depot" }),
    [DEPOT.coordinate.lat, DEPOT.coordinate.lng, depotSetting.name],
  );
  const [routes, setRoutes] = useState([] as Route[]);
  const [knownBins, setKnownBins] = useState([] as KnownBin[]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [alertRecipient, setAlertRecipient] = useState("all");
  const [alertError, setAlertError] = useState<string | null>(null);
  const [showAlertToast, setShowAlertToast] = useState(false);
  const [showRouteDetails, setShowRouteDetails] = useState<Route | null>(null);
  const [showMapModal, setShowMapModal] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [routeToDelete, setRouteToDelete] = useState<string | null>(null);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [onlineDriverIds, setOnlineDriverIds] = useState<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingRoute, setIsCreatingRoute] = useState(false);
  const [createStatusMessage, setCreateStatusMessage] = useState<string | null>(null);
  const [routeToast, setRouteToast] = useState<{ message: string; type: "success" | "info" | "warning" | "error" } | null>(null);
  const createSubmitLockRef = useRef(false);
  const createRequestKeyRef = useRef<string | null>(null);
  const syncInflightRef = useRef<Promise<void> | null>(null);
  const realtimeSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newRoute, setNewRoute] = useState({
    name: "",
    truck: "",
    areaCode: "",
    scheduledDays: [] as string[],
    shiftLabel: "",
    wasteCategory: "",
  });
  const [selectedBinIds, setSelectedBinIds] = useState<string[]>([]);

  const todayCode = useMemo(() => WEEKDAY_CODES[new Date().getDay()] ?? "Mon", []);
  const [scheduleDayFilter, setScheduleDayFilter] = useState<string>(todayCode);
  const [scheduleAreaFilter, setScheduleAreaFilter] = useState<string>("AREA-1");
  const [scheduleBarangayFilter, setScheduleBarangayFilter] = useState<string>("ALL");
  const [scheduleCoordFilter, setScheduleCoordFilter] = useState<string>("ALL");
  const [isScheduleExpanded, setIsScheduleExpanded] = useState<boolean>(true);
  const [isRoutesExpanded, setIsRoutesExpanded] = useState<boolean>(true);

  const scheduleAreaSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        areaCode: string;
        areaName: string;
        shiftLabel: string;
        wasteCategory: string;
        assignedTruckNote: string;
        specialInstructions: string;
        monitorName: string;
        daysOfWeek: Set<string>;
        barangays: Set<string>;
        matchedBinIds: Set<string>;
        schedules: Array<{ days_of_week: string[]; is_active: boolean; barangay: string | null }>;
        hasActiveSchedule: boolean;
      }
    >();
    collectionSchedules.forEach((row) => {
      let entry = map.get(row.area_code);
      if (!entry) {
        entry = {
          areaCode: row.area_code,
          areaName: row.area_name,
          shiftLabel: row.shift_label ?? "",
          wasteCategory: row.waste_category ?? "",
          assignedTruckNote: row.assigned_truck_note ?? "",
          specialInstructions: row.special_instructions ?? "",
          monitorName: row.monitor_name ?? "",
          daysOfWeek: new Set<string>(),
          barangays: new Set<string>(),
          matchedBinIds: new Set<string>(),
          schedules: [],
          hasActiveSchedule: false,
        };
        map.set(row.area_code, entry);
      }
      const rowIsActive = row.is_active !== false;
      if (rowIsActive) entry.hasActiveSchedule = true;
      entry.schedules.push({
        days_of_week: row.days_of_week ?? [],
        is_active: rowIsActive,
        barangay: row.barangay ?? null,
      });
      (row.days_of_week ?? []).forEach((d) => entry!.daysOfWeek.add(d));
      if (row.barangay && row.stop_type !== "disposal") entry.barangays.add(row.barangay);
      if (row.bin_id != null) entry.matchedBinIds.add(String(row.bin_id));
    });
    return Array.from(map.values())
      .map((item) => {
        const cleanTitle = cleanCollectionAreaTitle(item.areaCode, item.areaName);
        const scheduleLabel = formatAreaScheduleLabel(item.schedules);
        const displayTitle = formatCollectionAreaDisplay(item.areaCode, item.areaName, item.schedules);
        return {
          ...item,
          areaName: cleanTitle,
          scheduleLabel,
          displayTitle,
        };
      })
      .sort((a, b) => a.areaCode.localeCompare(b.areaCode, undefined, { numeric: true }));
  }, [collectionSchedules]);

  const filteredAreaSummaries = useMemo(() => {
    return scheduleAreaSummaries.filter((area) => {
      if (!area.hasActiveSchedule) return false;
      const matchingRows =
        scheduleBarangayFilter === "ALL"
          ? area.schedules
          : area.schedules.filter((s) => (s.barangay ?? "") === scheduleBarangayFilter);
      return doesAreaMatchScheduleDay(matchingRows, scheduleDayFilter);
    });
  }, [scheduleAreaSummaries, scheduleBarangayFilter, scheduleDayFilter]);

  useEffect(() => {
    if (
      scheduleAreaFilter !== "ALL" &&
      !filteredAreaSummaries.some((area) => area.areaCode === scheduleAreaFilter)
    ) {
      setScheduleAreaFilter("ALL");
    }
  }, [filteredAreaSummaries, scheduleAreaFilter]);

  const scheduleBarangayOptions = useMemo(() => {
    const set = new Set<string>();
    collectionSchedules.forEach((row) => {
      if (row.is_active !== false && doesScheduleMatchDay(row.days_of_week, scheduleDayFilter) && row.barangay) {
        set.add(row.barangay);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [collectionSchedules, scheduleDayFilter]);

  const filteredScheduleRows = useMemo(() => {
    return collectionSchedules.filter((row) => {
      if (row.is_active === false) return false;
      if (scheduleAreaFilter !== "ALL" && row.area_code !== scheduleAreaFilter) return false;
      if (!doesScheduleMatchDay(row.days_of_week, scheduleDayFilter)) return false;
      if (scheduleBarangayFilter !== "ALL" && (row.barangay ?? "") !== scheduleBarangayFilter) return false;
      if (scheduleCoordFilter !== "ALL" && row.coordinate_status !== scheduleCoordFilter) return false;
      return true;
    });
  }, [collectionSchedules, scheduleAreaFilter, scheduleBarangayFilter, scheduleCoordFilter, scheduleDayFilter]);

  const activeAreaSummary = useMemo(
    () => filteredAreaSummaries.find((item) => item.areaCode === scheduleAreaFilter) ?? null,
    [filteredAreaSummaries, scheduleAreaFilter],
  );

  const applyAreaTemplateToCreateModal = (areaCode: string) => {
    const areaSummary = scheduleAreaSummaries.find((item) => item.areaCode === areaCode);
    if (!areaSummary) return;
    const knownBinIdSet = new Set(knownBins.map((bin) => String(bin.id)));
    const orderedIds: string[] = [];
    const seenIds = new Set<string>();

    // Preserve official collection_schedules stop_order first
    collectionSchedules
      .filter((row) => row.area_code === areaCode && row.bin_id != null)
      .sort((a, b) => a.stop_order - b.stop_order)
      .forEach((row) => {
        const id = String(row.bin_id);
        if (knownBinIdSet.has(id) && !seenIds.has(id)) {
          seenIds.add(id);
          orderedIds.push(id);
        }
      });

    // Append any active bins tagged with this areaCode not explicitly linked by bin_id
    knownBins.forEach((bin) => {
      const id = String(bin.id);
      if (bin.areaCode === areaCode && !seenIds.has(id)) {
        seenIds.add(id);
        orderedIds.push(id);
      }
    });

    const dayTag = scheduleDayFilter !== "ALL" ? scheduleDayFilter : todayCode;
    createRequestKeyRef.current = null;
    setNewRoute((prev) => ({
      ...prev,
      name: `${areaSummary.areaName} (${dayTag})`.slice(0, 72),
      areaCode: areaSummary.areaCode,
      scheduledDays: [dayTag],
      shiftLabel: areaSummary.shiftLabel,
      wasteCategory: areaSummary.wasteCategory,
    }));
    setSelectedBinIds(orderedIds);
    setOptimizationError(null);
    setShowCreateModal(true);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const driverOptions = useMemo(
    () =>
      drivers.map((driver) => {
        const isOnline = isDriverOnline(driver, onlineDriverIds, nowMs, driverStaleThresholdMs);
        return {
          value: driver.name,
          label: driver.name,
          colorClassName: isOnline ? "bg-emerald-500" : "bg-gray-400",
        };
      }),
    [driverStaleThresholdMs, drivers, onlineDriverIds, nowMs],
  );
  const alertRecipientOptions = useMemo(
    () => [
      { value: "all", label: "All drivers" },
      ...drivers
        .filter((driver) => Boolean(driver.auth_user_id))
        .map((driver) => ({ value: String(driver.id), label: driver.name })),
    ],
    [drivers],
  );

  const syncFromSupabase = useCallback(async (options?: { silent?: boolean }) => {
    if (syncInflightRef.current) {
      return syncInflightRef.current;
    }

    const task = (async () => {
      if (!options?.silent) {
        setIsLoading(true);
      }
      try {
        const [{ data: binsData, error: binsError }, { data: driversData, error: driversError }, { data: routesData, error: routesError }] =
          await Promise.all([
            supabase
              .from("bins")
              .select("id, code, location, barangay, area_code, schedule_days, schedule_time_window, collection_status, coordinate_status, latitude, longitude, is_active, status")
              .order("id", { ascending: true }),
            supabase.from("drivers").select("id, name, status, auth_user_id, assigned_vehicle_id, last_seen_at").order("name", { ascending: true }),
            supabase
              .from("routes")
              .select(
                "id, name, status, area_code, scheduled_days, shift_label, waste_category, distance_km, duration_minutes, driver_id, vehicle_id, center_lat, center_lng, generated_at, assignment_updated_at, started_at, completed_at, optimization_method, cost_source, used_mapbox_traffic",
              )
              .order("created_at", { ascending: false }),
          ]);

        if (binsError) throw binsError;
        if (driversError) throw driversError;
        if (routesError) throw routesError;

        const mappedDrivers: Driver[] = (driversData ?? []).map((driver) => ({
          id: driver.id,
          name: driver.name,
          status: driver.status ?? "offline",
          auth_user_id: driver.auth_user_id ?? null,
          assigned_vehicle_id: driver.assigned_vehicle_id ?? null,
          last_seen_at: driver.last_seen_at ?? null,
        }));
        setDrivers(mappedDrivers);

        const mappedBins: KnownBin[] = (binsData ?? []).reduce<KnownBin[]>((acc, bin: any) => {
          const normalizedStatus = String(bin.status ?? "active").toLowerCase();
          if (bin.is_active === false || normalizedStatus === "disabled" || normalizedStatus === "inactive") {
            return acc;
          }
          const latitude = Number(bin.latitude);
          const longitude = Number(bin.longitude);
          if (!isValidRouteCoordinate(latitude, longitude)) return acc;
          acc.push({
            id: bin.id,
            code: bin.code ?? `BIN-${bin.id}`,
            location: bin.location,
            barangay: bin.barangay ?? null,
            areaCode: bin.area_code ?? null,
            scheduleDays: bin.schedule_days ?? null,
            scheduleTimeWindow: bin.schedule_time_window ?? null,
            collectionStatus: bin.collection_status ?? "pending",
            coordinateStatus: bin.coordinate_status ?? "verified",
            coordinates: [latitude, longitude],
          });
          return acc;
        }, []);
        setKnownBins(mappedBins);

        const routeIds = (routesData ?? []).map((route) => route.id);
        let stopMap = new Map<string, string[]>();
        let stopDetailsMap = new Map<string, RoutePreviewStop[]>();
        if (routeIds.length > 0) {
          const { data: stopsData, error: stopsError } = await supabase
            .from("route_stops")
            .select("route_id, stop_order, bin_id, bins(id, code, location, latitude, longitude)")
            .in("route_id", routeIds)
            .order("stop_order", { ascending: true });
          if (stopsError) throw stopsError;
          (stopsData ?? []).forEach((stop: any) => {
            const key = String(stop.route_id);
            const code = stop.bins?.code ?? `BIN-${stop.bin_id}`;
            const existingCodes = stopMap.get(key) ?? [];
            existingCodes.push(code);
            stopMap.set(key, existingCodes);

            const lat = Number(stop.bins?.latitude);
            const lng = Number(stop.bins?.longitude);
            if (isValidRouteCoordinate(lat, lng)) {
              const existingDetails = stopDetailsMap.get(key) ?? [];
              existingDetails.push({
                id: String(stop.bins?.id ?? stop.bin_id),
                label: code,
                location: stop.bins?.location ?? undefined,
                lat,
                lng,
              });
              stopDetailsMap.set(key, existingDetails);
            }
          });
        }

        setRoutes(
          (routesData ?? []).map((route: any) => {
            const driver = mappedDrivers.find((item) => String(item.id) === String(route.driver_id));
            const distanceKm = Number(route.distance_km ?? 0);
            const durationMinutes = Number(route.duration_minutes ?? 0);
            return {
              id: String(route.id),
              name: route.name,
              status: route.status,
              areaCode: route.area_code ?? null,
              scheduledDays: route.scheduled_days ?? null,
              shiftLabel: route.shift_label ?? null,
              wasteCategory: route.waste_category ?? null,
              stops: stopMap.get(String(route.id))?.length ?? 0,
              distance: formatDistanceKm(distanceKm * 1000),
              duration: formatDurationMinutes(durationMinutes),
              distanceKm,
              durationMinutes,
              truck: driver?.name ?? "Unassigned",
              driverId: route.driver_id ?? null,
              vehicleId: route.vehicle_id ?? null,
              coordinates: [Number(route.center_lat ?? DEPOT.coordinate.lat), Number(route.center_lng ?? DEPOT.coordinate.lng)],
              optimizedStops: stopMap.get(String(route.id)) ?? [],
              stopDetails: stopDetailsMap.get(String(route.id)) ?? [],
              optimizationUsedTraffic: Boolean(route.used_mapbox_traffic),
              optimizationMethod: route.optimization_method ?? undefined,
              costSource: route.cost_source ?? undefined,
              generatedAt: route.generated_at,
              assignmentUpdatedAt: route.assignment_updated_at,
            };
          }),
        );
      } catch {
        if (!options?.silent) {
          setOptimizationError("Could not load route planning data. Please refresh and try again.");
        }
      } finally {
        setIsLoading(false);
        syncInflightRef.current = null;
      }
    })();

    syncInflightRef.current = task;
    return task;
  }, [DEPOT.coordinate.lat, DEPOT.coordinate.lng]);

  const scheduleRealtimeSync = useCallback(() => {
    if (realtimeSyncTimerRef.current) {
      clearTimeout(realtimeSyncTimerRef.current);
    }
    realtimeSyncTimerRef.current = setTimeout(() => {
      realtimeSyncTimerRef.current = null;
      void syncFromSupabase({ silent: true });
    }, 250);
  }, [syncFromSupabase]);

  useEffect(() => {
    void syncFromSupabase();
    const channel = supabase
      .channel("dispatcher-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "routes" }, scheduleRealtimeSync)
      .on("postgres_changes", { event: "*", schema: "public", table: "route_stops" }, scheduleRealtimeSync)
      .on("postgres_changes", { event: "*", schema: "public", table: "bins" }, scheduleRealtimeSync)
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, scheduleRealtimeSync)
      .subscribe();

    const presenceChannel = supabase.channel("drivers-presence");
    const syncPresence = () => {
      const state = presenceChannel.presenceState();
      const onlineIds = new Set<string>();
      Object.entries(state).forEach(([key, presences]) => {
        if (Array.isArray(presences) && presences.length > 0) {
          onlineIds.add(String(key));
          presences.forEach((p: any) => {
            if (p.driver_id != null) onlineIds.add(String(p.driver_id));
            if (p.driverId != null) onlineIds.add(String(p.driverId));
          });
        }
      });
      setOnlineDriverIds(onlineIds);
    };

    presenceChannel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          syncPresence();
        }
      });

    return () => {
      if (realtimeSyncTimerRef.current) {
        clearTimeout(realtimeSyncTimerRef.current);
      }
      supabase.removeChannel(channel);
      supabase.removeChannel(presenceChannel);
    };
  }, [scheduleRealtimeSync, syncFromSupabase]);

  // Speculatively warm the street directions cache while dispatcher selects stops & driver in the modal
  useEffect(() => {
    if (!showCreateModal || selectedBinIds.length === 0) return;
    const binsById = new Map<string, KnownBin>(knownBins.map((bin) => [String(bin.id), bin]));
    const selectedBins = selectedBinIds
      .map((id) => binsById.get(id))
      .filter((bin): bin is KnownBin => Boolean(bin));
    if (selectedBins.length === 0) return;

    const timer = setTimeout(() => {
      const waypoints: LngLat[] = [
        [DEPOT.coordinate.lng, DEPOT.coordinate.lat],
        ...selectedBins.map((bin): LngLat => [bin.coordinates[1], bin.coordinates[0]]),
      ];
      void fetchStreetRouteWithFeedback("prefetch", waypoints);
    }, 300);

    return () => clearTimeout(timer);
  }, [DEPOT.coordinate.lat, DEPOT.coordinate.lng, knownBins, selectedBinIds, showCreateModal]);

  const buildRouteFromBins = async (
    routeName: string,
    orderedBins: KnownBin[],
    assignedDriver: string,
  ): Promise<{ route: Route | null; error?: string }> => {
    const waypoints: LngLat[] = [
      [DEPOT.coordinate.lng, DEPOT.coordinate.lat],
      ...orderedBins.map((bin): LngLat => [bin.coordinates[1], bin.coordinates[0]]),
    ];

    const directions = await fetchStreetRouteWithFeedback(
      `draft-${orderedBins.map((b) => b.id).join("-")}`,
      waypoints,
    );
    if (!directions.result) {
      return {
        route: null,
        error: directions.error ?? "Unable to generate road directions from Mapbox Directions API.",
      };
    }

    const totalDistanceMeters = directions.result.distanceMeters;
    const estimatedDurationMinutes = Math.max(1, Math.round(directions.result.durationSeconds / 60));
    const latSum = orderedBins.reduce((acc, bin) => acc + bin.coordinates[0], 0);
    const lngSum = orderedBins.reduce((acc, bin) => acc + bin.coordinates[1], 0);
    const routeCenter: [number, number] = [
      Number((latSum / orderedBins.length).toFixed(6)),
      Number((lngSum / orderedBins.length).toFixed(6)),
    ];

    const now = new Date().toLocaleString();
    const distanceKm = Number((totalDistanceMeters / 1000).toFixed(2));
    const usedMapbox = directions.result.source === "mapbox-directions";

    return {
      route: {
        id: "",
        name: routeName,
        status: "pending",
        stops: orderedBins.length,
        distance: formatDistanceKm(totalDistanceMeters),
        duration: formatDurationMinutes(estimatedDurationMinutes),
        distanceKm,
        durationMinutes: estimatedDurationMinutes,
        truck: assignedDriver,
        coordinates: routeCenter,
        optimizedStops: orderedBins.map((bin) => String(bin.id)),
        generatedAt: now,
        assignmentUpdatedAt: now,
        optimizationUsedTraffic: usedMapbox,
        optimizationMethod: "mapbox-directions",
        costSource: directions.result.source,
      },
    };
  };

  const moveSelectedBin = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= selectedBinIds.length) return;
    setSelectedBinIds((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const openRouteCandidates = useMemo<ExistingOpenRouteCandidate[]>(
    () =>
      routes.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        area_code: r.areaCode ?? null,
        scheduled_days: r.scheduledDays ?? null,
        shift_label: r.shiftLabel ?? null,
        driver_id: r.driverId ?? null,
        vehicle_id: r.vehicleId ?? null,
        driver_name: r.truck !== "Unassigned" ? r.truck : null,
      })),
    [routes],
  );

  const selectedCreateDriver = useMemo(
    () => drivers.find((driver) => driver.name === newRoute.truck) ?? null,
    [drivers, newRoute.truck],
  );

  const liveCreateConflict = useMemo(() => {
    if (!showCreateModal || (!newRoute.areaCode && !newRoute.name.trim() && !selectedCreateDriver)) {
      return null;
    }
    return findRouteAssignmentConflict(openRouteCandidates, {
      name: newRoute.name,
      areaCode: newRoute.areaCode || null,
      scheduledDays: newRoute.scheduledDays,
      shiftLabel: newRoute.shiftLabel || null,
      driverId: selectedCreateDriver?.id ?? "",
      driverName: selectedCreateDriver?.name ?? newRoute.truck,
      vehicleId: selectedCreateDriver?.assigned_vehicle_id ?? null,
    });
  }, [
    newRoute.areaCode,
    newRoute.name,
    newRoute.scheduledDays,
    newRoute.shiftLabel,
    newRoute.truck,
    openRouteCandidates,
    selectedCreateDriver,
    showCreateModal,
  ]);

  const closeCreateModalSafe = () => {
    if (createSubmitLockRef.current || isCreatingRoute) return;
    createRequestKeyRef.current = null;
    setOptimizationError(null);
    setShowCreateModal(false);
  };

  const handleCreateRoute = async () => {
    // Synchronous re-entrancy guard stops double-clicks, rapid clicks, and Enter key repeats immediately
    if (createSubmitLockRef.current) return;

    const trimmedName = newRoute.name.trim();
    if (!trimmedName) {
      setOptimizationError("Route name is required.");
      return;
    }

    const selectedDriver = drivers.find((driver) => driver.name === newRoute.truck);
    if (!newRoute.truck || !selectedDriver) {
      setOptimizationError("Please select a valid driver.");
      return;
    }

    const binsById = new Map<string, KnownBin>(knownBins.map((bin) => [String(bin.id), bin]));
    const selectedBins = selectedBinIds
      .map((id) => binsById.get(id))
      .filter((bin): bin is KnownBin => Boolean(bin));
    if (selectedBins.length === 0) {
      setOptimizationError("Select at least one live bin for this route.");
      return;
    }

    const conflict = findRouteAssignmentConflict(openRouteCandidates, {
      name: trimmedName,
      areaCode: newRoute.areaCode || null,
      scheduledDays: newRoute.scheduledDays,
      shiftLabel: newRoute.shiftLabel || null,
      driverId: selectedDriver.id,
      driverName: selectedDriver.name,
      vehicleId: selectedDriver.assigned_vehicle_id ?? null,
    });
    if (conflict) {
      setOptimizationError(conflict.message);
      return;
    }

    createSubmitLockRef.current = true;
    setIsCreatingRoute(true);
    setOptimizationError(null);
    setCreateStatusMessage("Generating road route...");

    if (!createRequestKeyRef.current) {
      createRequestKeyRef.current = generateRouteRequestKey();
    }
    const requestKey = createRequestKeyRef.current;

    try {
      const { route, error: routeError } = await buildRouteFromBins(trimmedName, selectedBins, newRoute.truck);
      if (!route) {
        setOptimizationError(routeError ?? "Unable to generate route directions. Please try again.");
        return;
      }

      setCreateStatusMessage("Creating Route...");
      const numericVehicleId =
        selectedDriver.assigned_vehicle_id != null && Number.isFinite(Number(selectedDriver.assigned_vehicle_id))
          ? Number(selectedDriver.assigned_vehicle_id)
          : null;

      const result = await createRouteAssignment({
        requestKey,
        name: route.name,
        status: "pending",
        areaCode: newRoute.areaCode || null,
        scheduledDays: newRoute.scheduledDays.length > 0 ? newRoute.scheduledDays : null,
        shiftLabel: newRoute.shiftLabel || null,
        wasteCategory: newRoute.wasteCategory || null,
        distanceKm:
          route.distanceKm ??
          (route.distance.trim().endsWith(" m")
            ? Number(route.distance.replace(/[^\d.]/g, "")) / 1000
            : Number(route.distance.replace(/[^\d.]/g, ""))),
        durationMinutes: route.durationMinutes ?? 1,
        driverId: selectedDriver.id,
        driverName: selectedDriver.name,
        driverAuthUserId: selectedDriver.auth_user_id,
        vehicleId: numericVehicleId,
        centerLat: route.coordinates?.[0] ?? DEPOT.coordinate.lat,
        centerLng: route.coordinates?.[1] ?? DEPOT.coordinate.lng,
        optimizationMethod: route.optimizationMethod,
        costSource: route.costSource,
        usedMapboxTraffic: route.optimizationUsedTraffic === true,
        binIds: route.optimizedStops ?? selectedBins.map((b) => String(b.id)),
      });

      if (!result.ok) {
        if (result.conflict || !result.timedOut) {
          // Non-timeout conflict or validation failure: release requestKey on draft change cleanly
          createRequestKeyRef.current = null;
        }
        setOptimizationError(result.error ?? "Could not create this route. Please check your selections and try again.");
        return;
      }

      createRequestKeyRef.current = null;
      setNewRoute({ name: "", truck: "", areaCode: "", scheduledDays: [], shiftLabel: "", wasteCategory: "" });
      setSelectedBinIds([]);
      setOptimizationError(null);
      setShowCreateModal(false);
      setRouteToast({
        message: result.recoveredFromTimeout
          ? "Route assignment was already confirmed on the server."
          : result.idempotent
            ? "Route assignment saved (duplicate request prevented)."
            : `Route "${route.name}" created and assigned.`,
        type: result.recoveredFromTimeout ? "info" : "success",
      });
      void syncFromSupabase({ silent: true });
    } catch (err: any) {
      setOptimizationError(err?.message || "Could not create this route. Please check your selections and try again.");
    } finally {
      createSubmitLockRef.current = false;
      setIsCreatingRoute(false);
      setCreateStatusMessage(null);
    }
  };

  const sendFleetAlert = async () => {
    const message = alertMessage.trim();
    setAlertError(null);
    if (!message) {
      setAlertError("Alert message is required.");
      return;
    }

    const linkedDrivers = drivers.filter((driver) => Boolean(driver.auth_user_id));
    if (linkedDrivers.length === 0) {
      setAlertError("No truck drivers have an EcoLoop account linked to their profile.");
      return;
    }

    const recipients = alertRecipient === "all"
      ? linkedDrivers
      : linkedDrivers.filter((driver) => String(driver.id) === alertRecipient);
    if (recipients.length === 0) {
      setAlertError("The selected driver does not have a linked EcoLoop account.");
      return;
    }

    try {
      await createNotifications(
        recipients.map((driver) => ({
          user_auth_id: String(driver.auth_user_id),
          title: "Dispatch Alert",
          message,
          type: "warning",
          category: "system",
          source_table: "route_planning",
          read: false,
        })),
      );
      setAlertMessage("");
      setAlertRecipient("all");
      setShowAlertModal(false);
      setShowAlertToast(true);
    } catch (error: any) {
      setAlertError(error?.message ?? "Unable to send alert.");
    }
  };

  const handleDriverAssignment = async (routeId: string, driverName: string) => {
    const route = routes.find((item) => item.id === routeId);
    if (route && !["pending", "planned"].includes(normalizeStatus(route.status))) {
      setOptimizationError("This route has already been accepted and cannot be reassigned.");
      return;
    }
    const nextDriver = drivers.find((driver) => driver.name === driverName);
    if (!nextDriver) return;
    const driverId = String(nextDriver.id);
    const numericVehicleId =
      nextDriver.assigned_vehicle_id != null && Number.isFinite(Number(nextDriver.assigned_vehicle_id))
        ? Number(nextDriver.assigned_vehicle_id)
        : null;
    const { error } = await supabase
      .from("routes")
      .update({
        driver_id: driverId,
        vehicle_id: numericVehicleId,
        assignment_updated_at: new Date().toISOString(),
        status: "pending",
        started_at: null,
        completed_at: null,
      })
      .eq("id", routeId);
    if (error) {
      setOptimizationError("Could not update the driver assignment. Please try again.");
      return;
    }
    await syncVehicleRouteAssignment({
      routeId: String(routeId),
      driverId: nextDriver.id,
      assignedVehicleId: nextDriver.assigned_vehicle_id,
    });
    const { error: delErr } = await supabase
      .from("deliveries")
      .update({ driver_id: driverId })
      .eq("route_id", routeId)
      .neq("status", "completed");
    if (delErr) {
      setOptimizationError("The driver was updated, but related deliveries may need a moment to refresh. Reload the page if counts look wrong.");
    }
    await notifyDriverRouteAssigned({
      routeId,
      routeName: routes.find((r) => r.id === routeId)?.name ?? "Route",
      stopCount: routes.find((r) => r.id === routeId)?.stops ?? 0,
      driverAuthUserId: nextDriver.auth_user_id,
    });
    await syncFromSupabase();
  };

  const handleDeleteRoute = (id: string) => {
    setRouteToDelete(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!routeToDelete) return;
    setOptimizationError(null);
    await supabase.from("vehicles").update({ route_id: null }).eq("route_id", String(routeToDelete));
    const { error } = await supabase.from("routes").delete().eq("id", routeToDelete);
    if (error) {
      setOptimizationError("Could not delete this route. Please try again.");
      throw error;
    }
    await syncFromSupabase();
  };

  const getStatusColor = (status: string) => routeStatusBadgeClass(status);

  useEffect(() => {
    const anyModalOpen = showAlertModal || showCreateModal || showMapModal || showRouteDetails != null;
    if (!anyModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAlertModal(false);
        if (!createSubmitLockRef.current && !isCreatingRoute) {
          createRequestKeyRef.current = null;
          setOptimizationError(null);
          setShowCreateModal(false);
        }
        setShowMapModal(false);
        setShowRouteDetails(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCreatingRoute, showAlertModal, showCreateModal, showMapModal, showRouteDetails]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Route Planning"
        subtitle="City of Naga Waste Collection Management"
        description={
          isMapboxDirectionsConfigured()
            ? "Routes use Mapbox Directions API for road-following paths, distance, and travel time."
            : "Routes use road-following directions for distance and travel duration."
        }
        icon={<MapPin className="size-5" aria-hidden="true" />}
        onNavigate={onNavigate as any}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold tracking-wide uppercase text-gray-500">Total Routes</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight tabular-nums mt-1.5">{routes.length}</div>
          <div className="text-emerald-700 font-medium text-xs mt-1">All saved routes</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold tracking-wide uppercase text-gray-500">Active Routes</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight tabular-nums mt-1.5">{routes.filter((route) => normalizeStatus(route.status) === "active").length}</div>
          <div className="text-blue-700 font-medium text-xs mt-1">In progress</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold tracking-wide uppercase text-gray-500">Pending Routes</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight tabular-nums mt-1.5">
            {routes.filter((route) => ["pending", "planned"].includes(normalizeStatus(route.status))).length}
          </div>
          <div className="text-amber-800 font-medium text-xs mt-1">Awaiting driver accept</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold tracking-wide uppercase text-gray-500">Completed Today</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight tabular-nums mt-1.5">{routes.filter((route) => normalizeStatus(route.status) === "completed").length}</div>
          <div className="text-emerald-700 font-medium text-xs mt-1">Completed routes</div>
        </div>
      </div>

      {/* Dispatcher Actions */}
      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={() => {
            setAlertError(null);
            setShowAlertModal(true);
          }}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
        >
          <Bell className="size-4" aria-hidden="true" />
          Send Alert
        </button>
        <button
          type="button"
          onClick={() => {
            createRequestKeyRef.current = null;
            setOptimizationError(null);
            setShowCreateModal(true);
          }}
          className="inline-flex min-h-[40px] items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          <Plus className="size-4" aria-hidden="true" />
          Create Route
        </button>
      </div>

        {showAlertModal && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 px-4" onClick={() => setShowAlertModal(false)}>
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="size-5 text-red-600" />
                  <h3 className="text-gray-900">Send Alert to Truck Drivers</h3>
                </div>
                <button onClick={() => setShowAlertModal(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <X className="size-5" />
                </button>
              </div>
              <div className="mb-4">
                <label className="mb-1.5 block text-sm text-gray-700">Send to</label>
                <CustomSelect
                  value={alertRecipient}
                  options={alertRecipientOptions}
                  onChange={(value) => {
                    setAlertRecipient(value);
                    setAlertError(null);
                  }}
                  ariaLabel="Choose alert recipient"
                />
              </div>
              <textarea
                className="min-h-28 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                placeholder="Alert message"
                value={alertMessage}
                onChange={(event) => setAlertMessage(event.target.value)}
              />
              {alertError && <p className="mt-2 text-sm text-red-600">{alertError}</p>}
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setShowAlertModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={() => void sendFleetAlert()} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700">
                  Send Alert
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Garbage Collection Schedule */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setIsScheduleExpanded((prev) => !prev)}
            aria-expanded={isScheduleExpanded}
            className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-gray-50/80 transition-colors"
          >
            <div>
              <h3 className="text-base font-semibold text-gray-900">Garbage Collection Schedule</h3>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                {isScheduleExpanded
                  ? "Official SWMO collection schedule by area, barangay, day, and time."
                  : `${filteredScheduleRows.length} scheduled stop${filteredScheduleRows.length === 1 ? "" : "s"} across ${filteredAreaSummaries.length} collection area${filteredAreaSummaries.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 shrink-0">
              <span>{isScheduleExpanded ? "Collapse" : "Expand"}</span>
              {isScheduleExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </span>
          </button>

          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
              isScheduleExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <div className="px-4 sm:px-6 py-3.5 border-t border-gray-200 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setScheduleDayFilter("ALL")}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      scheduleDayFilter === "ALL" ? "bg-emerald-600 text-white" : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    All Days
                  </button>
                  {FILTER_DAY_CODES.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setScheduleDayFilter(day)}
                      className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                        scheduleDayFilter === day ? "bg-emerald-600 text-white" : "text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <CustomSelect
                    size="sm"
                    value={scheduleAreaFilter}
                    onChange={setScheduleAreaFilter}
                    options={[
                      { value: "ALL", label: `All SWMO Areas (${filteredAreaSummaries.length})` },
                      ...filteredAreaSummaries.map((area) => ({
                        value: area.areaCode,
                        label: area.displayTitle,
                      })),
                    ]}
                    className="min-w-[230px]"
                    ariaLabel="Filter schedule by SWMO Area"
                  />
                  <CustomSelect
                    size="sm"
                    value={scheduleBarangayFilter}
                    onChange={setScheduleBarangayFilter}
                    options={[
                      { value: "ALL", label: "All Barangays" },
                      ...scheduleBarangayOptions.map((brgy) => ({ value: brgy, label: brgy })),
                    ]}
                    className="min-w-[165px]"
                    ariaLabel="Filter schedule by barangay"
                  />
                  <CustomSelect
                    size="sm"
                    value={scheduleCoordFilter}
                    onChange={setScheduleCoordFilter}
                    options={[
                      { value: "ALL", label: `All Stops (${filteredScheduleRows.length})` },
                      { value: "verified_bin", label: "Matched Live Bins Only" },
                      { value: "verified_landfill", label: "Sanitary Landfill Stops" },
                      { value: "needs_verification", label: "Needs Coordinate Verification" },
                    ]}
                    className="min-w-[195px]"
                    ariaLabel="Filter schedule by coordinate verification"
                  />
                  {scheduleAreaFilter !== "ALL" && activeAreaSummary && (
                    <button
                      type="button"
                      onClick={() => applyAreaTemplateToCreateModal(scheduleAreaFilter)}
                      className="h-9 px-3 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
                    >
                      Plan Route for {activeAreaSummary.areaName}
                    </button>
                  )}
                </div>
              </div>

              {activeAreaSummary && (
                <div className="px-4 sm:px-6 py-3.5 bg-gray-50 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs sm:text-sm">
                  <div>
                    <span className="text-gray-500 block text-xs">Area & Shift</span>
                    <span className="font-medium text-gray-900">{activeAreaSummary.displayTitle}</span>
                    {activeAreaSummary.shiftLabel && <span className="block text-gray-700">{activeAreaSummary.shiftLabel}</span>}
                  </div>
                  <div>
                    <span className="text-gray-500 block text-xs">Covered Barangays</span>
                    <span className="text-gray-900">
                      {Array.from(activeAreaSummary.barangays).join(", ") || "Citywide"}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-xs">Waste Category</span>
                    <span className="text-gray-900">{activeAreaSummary.wasteCategory || "Standard SWMO Collection"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-xs">Assigned Truck & Monitor</span>
                    <span className="text-gray-900">
                      {[
                        activeAreaSummary.assignedTruckNote ? `Truck: ${activeAreaSummary.assignedTruckNote}` : null,
                        activeAreaSummary.monitorName ? `Monitor: ${activeAreaSummary.monitorName}` : null,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "Assigned per dispatcher"}
                    </span>
                    {activeAreaSummary.specialInstructions && (
                      <span className="block text-xs text-gray-600 mt-0.5">{activeAreaSummary.specialInstructions}</span>
                    )}
                  </div>
                </div>
              )}

              {(() => {
                const preparedScheduleRows = filteredScheduleRows.map((row) => {
                  const matchedBin = row.bin_id != null ? knownBins.find((b) => String(b.id) === String(row.bin_id)) : null;
                  const timeDisplay =
                    scheduleDayFilter !== "ALL" && row.day_times && row.day_times[scheduleDayFilter]
                      ? row.day_times[scheduleDayFilter]
                      : row.scheduled_time || "Per shift";
                  const dayDisplay = formatScheduleDaysLabel(row.days_of_week);
                  const statusInfo = matchedBin
                    ? {
                        dotClass: "bg-emerald-500",
                        textClass: "text-gray-800",
                        label: `${matchedBin.code} (${(matchedBin.collectionStatus ?? "pending").replace(/^'+|'+$/g, "")})`,
                      }
                    : row.coordinate_status === "verified_landfill"
                      ? {
                          dotClass: "bg-blue-500",
                          textClass: "text-gray-800",
                          label: "Sanitary Landfill",
                        }
                      : {
                          dotClass: "bg-amber-400",
                          textClass: "text-gray-600",
                          label: "Needs GPS Pin",
                        };

                  return { row, timeDisplay, dayDisplay, statusInfo };
                });

                const timeHeader = scheduleDayFilter === "ALL" ? "Collection Time" : `${scheduleDayFilter} Time`;

                return (
                  <>
                    {/* Mobile stacked layout (no horizontal drag) */}
                    <div className="md:hidden border-t border-gray-200 divide-y divide-gray-200">
                      {preparedScheduleRows.map(({ row, timeDisplay, dayDisplay, statusInfo }) => (
                        <div key={row.id} className="p-4 space-y-2.5 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-gray-900 break-words">
                                {row.area_code} #{row.stop_order} — {row.location_name}
                              </div>
                              {row.special_instructions && (
                                <div className="text-gray-500 mt-0.5 break-words">{row.special_instructions}</div>
                              )}
                            </div>
                            <span className={`inline-flex items-center gap-1.5 shrink-0 font-medium ${statusInfo.textClass}`}>
                              <span className={`size-2 rounded-full shrink-0 ${statusInfo.dotClass}`} />
                              <span>{statusInfo.label}</span>
                            </span>
                          </div>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-gray-700">
                            <div>
                              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Barangay</dt>
                              <dd className="break-words">{row.barangay ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Collection Day</dt>
                              <dd className="break-words">{dayDisplay}</dd>
                            </div>
                            <div>
                              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{timeHeader}</dt>
                              <dd className="font-mono break-words">{timeDisplay}</dd>
                            </div>
                            <div>
                              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Waste Category</dt>
                              <dd className="break-words">{row.waste_category || "—"}</dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Assigned Truck</dt>
                              <dd className="break-words">{row.assigned_truck_note || "—"}</dd>
                            </div>
                          </dl>
                        </div>
                      ))}
                      {preparedScheduleRows.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                          No scheduled stops match the selected filters.
                        </div>
                      )}
                    </div>

                    {/* Tablet & Desktop table fit cleanly within available width */}
                    <div className="hidden md:block border-t border-gray-200">
                      <table className="w-full table-fixed text-xs lg:text-sm">
                        <colgroup>
                          <col className="w-[26%]" />
                          <col className="w-[13%]" />
                          <col className="w-[12%]" />
                          <col className="w-[12%]" />
                          <col className="w-[13%]" />
                          <col className="w-[12%]" />
                          <col className="w-[12%]" />
                        </colgroup>
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600 align-bottom">Collection Area</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600 align-bottom">Barangay</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600 align-bottom">Collection Day</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600 align-bottom">{timeHeader}</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600 align-bottom">Waste Category</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600 align-bottom">Assigned Truck</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600 align-bottom">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {preparedScheduleRows.map(({ row, timeDisplay, dayDisplay, statusInfo }) => (
                            <tr key={row.id} className="hover:bg-gray-50/70 align-top">
                              <td className="px-3 py-2.5 text-gray-900 break-words">
                                <div className="font-medium text-gray-900 leading-snug">
                                  {row.area_code} #{row.stop_order} — {row.location_name}
                                </div>
                                {row.special_instructions && (
                                  <div className="text-xs text-gray-500 mt-0.5 leading-snug">{row.special_instructions}</div>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-gray-700 break-words leading-snug">
                                {row.barangay ?? "—"}
                              </td>
                              <td className="px-3 py-2.5 text-gray-700 break-words leading-snug">
                                {dayDisplay}
                              </td>
                              <td className="px-3 py-2.5 text-gray-700 font-mono text-xs break-words leading-snug">
                                {timeDisplay}
                              </td>
                              <td className="px-3 py-2.5 text-gray-700 break-words leading-snug">
                                {row.waste_category || "—"}
                              </td>
                              <td className="px-3 py-2.5 text-gray-700 break-words leading-snug">
                                {row.assigned_truck_note || "—"}
                              </td>
                              <td className="px-3 py-2.5 text-xs leading-snug">
                                <span className={`inline-flex items-start gap-1.5 ${statusInfo.textClass}`}>
                                  <span className={`size-2 rounded-full shrink-0 mt-1 ${statusInfo.dotClass}`} />
                                  <span className="break-words">{statusInfo.label}</span>
                                </span>
                              </td>
                            </tr>
                          ))}
                          {preparedScheduleRows.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                                No scheduled stops match the selected filters.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </section>

        {/* Routes Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setIsRoutesExpanded((prev) => !prev)}
            aria-expanded={isRoutesExpanded}
            className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-gray-50/80 transition-colors"
          >
            <div>
              <h3 className="text-gray-900 font-semibold">Current Routes</h3>
              {!isRoutesExpanded && (
                <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                  {routes.length} saved route{routes.length === 1 ? "" : "s"}
                </p>
              )}
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 shrink-0">
              <span>{isRoutesExpanded ? "Collapse" : "Expand"}</span>
              {isRoutesExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </span>
          </button>
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
              isRoutesExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <div className="overflow-x-auto border-t border-gray-200">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Route ID</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Name</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Status</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Stops</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Distance</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Duration</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Assigned Driver</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {routes.map((route) => (
                  <tr key={route.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-900">{route.id}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div>{route.name}</div>
                      {(route.areaCode || route.shiftLabel) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {route.areaCode && (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700">
                              {route.areaCode}
                            </span>
                          )}
                          {route.shiftLabel && <span className="text-xs text-gray-500">{route.shiftLabel}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs ${getStatusColor(route.status)}`}>
                        {labelRouteStatus(route.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{route.stops}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{route.distance}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{route.duration}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <CustomSelect
                        size="sm"
                        value={route.truck}
                        onChange={(driverName) => void handleDriverAssignment(route.id, driverName)}
                        options={[{ value: "Unassigned", label: "Unassigned" }, ...driverOptions]}
                        disabled={!["pending", "planned"].includes(normalizeStatus(route.status))}
                        className="w-40"
                        ariaLabel="Assigned driver"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowRouteDetails(route)}
                          className="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                          title="View Route Details"
                        >
                          <Eye className="size-4" />
                        </button>
                        <button 
                          onClick={() => {
                            setSelectedRoute(route);
                            setShowMapModal(true);
                          }}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="View on Map"
                        >
                          <MapPin className="size-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteRoute(route.id)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete Route"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>
            </div>
          </div>
        </div>

        {/* Create Route Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] px-4" onClick={closeCreateModalSafe}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-route-modal-title"
              className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 id="create-route-modal-title" className="text-base font-semibold text-gray-900">Create New Route</h3>
                <button
                  type="button"
                  onClick={closeCreateModalSafe}
                  disabled={isCreatingRoute}
                  aria-label="Close modal"
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCreateRoute();
                }}
              >
                <div>
                  <label htmlFor="create-route-area" className="block text-sm text-gray-600 mb-1">Load SWMO Schedule Area (Optional)</label>
                  <CustomSelect
                    id="create-route-area"
                    value={newRoute.areaCode}
                    disabled={isCreatingRoute}
                    onChange={(code) => {
                      createRequestKeyRef.current = null;
                      setOptimizationError(null);
                      if (!code) {
                        setNewRoute((prev) => ({ ...prev, areaCode: "", scheduledDays: [], shiftLabel: "", wasteCategory: "" }));
                        return;
                      }
                      applyAreaTemplateToCreateModal(code);
                    }}
                    options={[
                      { value: "", label: "Custom route (select bins manually)" },
                      ...scheduleAreaSummaries.map((area) => ({
                        value: area.areaCode,
                        label: `${area.displayTitle} (${area.matchedBinIds.size} matched bins)`,
                      })),
                    ]}
                    ariaLabel="Load SWMO Schedule Area"
                  />
                </div>
                <div>
                  <label htmlFor="create-route-day" className="block text-sm text-gray-600 mb-1">Schedule Day</label>
                  <CustomSelect
                    id="create-route-day"
                    value={newRoute.scheduledDays[0] ?? ""}
                    disabled={isCreatingRoute}
                    onChange={(chosenDay) => {
                      createRequestKeyRef.current = null;
                      setOptimizationError(null);
                      setNewRoute((prev) => {
                        let nextName = prev.name;
                        if (prev.areaCode && chosenDay) {
                          if (/\((Mon|Tue|Wed|Thu|Fri|Sat|Sun)\)/.test(nextName)) {
                            nextName = nextName.replace(/\((Mon|Tue|Wed|Thu|Fri|Sat|Sun)\)/, `(${chosenDay})`);
                          }
                        }
                        return {
                          ...prev,
                          name: nextName,
                          scheduledDays: chosenDay ? [chosenDay] : [],
                        };
                      });
                    }}
                    options={[
                      { value: "", label: "Any / Flexible schedule" },
                      ...FILTER_DAY_CODES.map((day) => ({
                        value: day,
                        label: day === todayCode ? `${day} (Today)` : day,
                      })),
                    ]}
                    ariaLabel="Schedule Day"
                  />
                </div>
                <div>
                  <label htmlFor="create-route-name" className="block text-sm text-gray-600 mb-1">Route Name</label>
                  <input
                    id="create-route-name"
                    type="text"
                    disabled={isCreatingRoute}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:cursor-not-allowed"
                    placeholder="Enter route name"
                    value={newRoute.name}
                    onChange={(e) => {
                      createRequestKeyRef.current = null;
                      setOptimizationError(null);
                      setNewRoute({ ...newRoute, name: e.target.value });
                    }}
                  />
                </div>
                {newRoute.areaCode && (
                  <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs text-indigo-900 space-y-0.5">
                    <div className="font-medium">
                      Linked Schedule: {newRoute.areaCode}
                      {newRoute.scheduledDays.length > 0 ? ` (${newRoute.scheduledDays.join(", ")})` : ""}
                    </div>
                    {newRoute.shiftLabel && <div>Shift: {newRoute.shiftLabel}</div>}
                    {newRoute.wasteCategory && <div>Category: {newRoute.wasteCategory}</div>}
                  </div>
                )}
                {liveCreateConflict && (
                  <div
                    role="alert"
                    className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900 flex items-start gap-2"
                  >
                    <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="font-semibold">Conflicting Route Assignment</div>
                      <p className="mt-0.5">{liveCreateConflict.message}</p>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Route Stops From Live Bins</label>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2 space-y-2">
                    {knownBins.map((bin) => (
                      <label key={bin.id} className="flex items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          disabled={isCreatingRoute}
                          checked={selectedBinIds.includes(String(bin.id))}
                          onChange={(event) => {
                            createRequestKeyRef.current = null;
                            setOptimizationError(null);
                            setSelectedBinIds((prev) =>
                              event.target.checked ? [...prev, String(bin.id)] : prev.filter((id) => id !== String(bin.id)),
                            );
                          }}
                        />
                        <span>
                          {bin.code} - {bin.location}
                          {bin.barangay ? ` (${bin.barangay})` : ""}
                          {bin.areaCode ? ` [${bin.areaCode}]` : ""}
                        </span>
                      </label>
                    ))}
                    {!isLoading && knownBins.length === 0 && <p className="text-sm text-gray-500">No bin records available.</p>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Selected stops: {selectedBinIds.length} (sent to Mapbox Directions in the order below)
                  </p>
                  {selectedBinIds.length > 0 && (
                    <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 space-y-1">
                      {selectedBinIds.map((binId, idx) => {
                        const bin = knownBins.find((b) => String(b.id) === binId);
                        if (!bin) return null;
                        return (
                          <div key={binId} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-xs border border-gray-200">
                            <span className="truncate text-gray-800">
                              <span className="font-semibold text-emerald-700">#{idx + 1}</span> {bin.code} — {bin.location}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  createRequestKeyRef.current = null;
                                  moveSelectedBin(idx, -1);
                                }}
                                disabled={isCreatingRoute || idx === 0}
                                title="Move Stop Up"
                                className="p-0.5 text-gray-500 hover:text-gray-800 disabled:opacity-30"
                              >
                                <ArrowUp className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  createRequestKeyRef.current = null;
                                  moveSelectedBin(idx, 1);
                                }}
                                disabled={isCreatingRoute || idx === selectedBinIds.length - 1}
                                title="Move Stop Down"
                                className="p-0.5 text-gray-500 hover:text-gray-800 disabled:opacity-30"
                              >
                                <ArrowDown className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Assign Truck</label>
                  <CustomSelect
                    value={newRoute.truck}
                    disabled={isCreatingRoute}
                    onChange={(driverName) => {
                      createRequestKeyRef.current = null;
                      setOptimizationError(null);
                      setNewRoute({ ...newRoute, truck: driverName });
                    }}
                    options={driverOptions}
                    placeholder="Select driver"
                    ariaLabel="Assign truck"
                  />
                </div>
                <p className="text-xs text-gray-500">New routes are created as <span className="font-medium">Pending</span> until the driver accepts them in the mobile app.</p>
                {optimizationError && (
                  <p role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                    {optimizationError}
                  </p>
                )}
                {isLoading && <p className="text-sm text-gray-500">Loading route data…</p>}
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={closeCreateModalSafe}
                    disabled={isCreatingRoute}
                    className="flex-1 min-h-[42px] px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingRoute}
                    aria-busy={isCreatingRoute}
                    className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isCreatingRoute ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        <span>{createStatusMessage || "Creating Route..."}</span>
                      </>
                    ) : (
                      <span>Create Route</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Map Modal */}
        {showMapModal && selectedRoute && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={() => setShowMapModal(false)}>
            <div className="bg-white rounded-lg shadow-2xl w-[900px] h-[700px] flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <div>
                  <h3 className="text-gray-900 mb-1">{selectedRoute.name}</h3>
                  <p className="text-sm text-gray-600">Route overview</p>
                </div>
                <button 
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" 
                  onClick={() => setShowMapModal(false)}
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Route Details */}
              <div className="flex items-center gap-6 px-6 py-4 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Status:</span>
                  <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(selectedRoute.status)}`}>
                    {labelRouteStatus(selectedRoute.status)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Stops:</span>
                  <span className="text-sm text-gray-900">{selectedRoute.stops}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Distance:</span>
                  <span className="text-sm text-gray-900">{selectedRoute.distance}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Duration:</span>
                  <span className="text-sm text-gray-900">{selectedRoute.duration}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${selectedRoute.optimizationUsedTraffic ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {labelOptimizationSource(selectedRoute)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Truck:</span>
                  <span className="text-sm text-gray-900">{selectedRoute.truck}</span>
                </div>
              </div>

              <div className="flex-1 relative min-h-0 bg-gray-100">
                <TrafficRouteMapPreview
                  lat={selectedRoute.coordinates![0]}
                  lng={selectedRoute.coordinates![1]}
                  zoom={13}
                  routeId={selectedRoute.id}
                  depot={previewDepot}
                  stops={selectedRoute.stopDetails ?? []}
                  className="absolute inset-0 h-full w-full"
                />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
                <div className="text-sm text-gray-600">
                  <div>Planned stop sequence: {selectedRoute.optimizedStops && selectedRoute.optimizedStops.length > 0 ? selectedRoute.optimizedStops.join(" → ") : "—"}</div>
                  <div className="text-xs text-emerald-700 font-medium mt-0.5">
                    Disposal destination: {landfillSetting.name} ({landfillSetting.address})
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${selectedRoute.coordinates![0]},${selectedRoute.coordinates![1]}`;
                      window.open(mapsUrl, '_blank');
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    Open Route in Maps
                  </button>
                  <button
                    onClick={() => {
                      const fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${landfillSetting.latitude},${landfillSetting.longitude}`;
                      window.open(landfillSetting.google_maps_url || fallbackUrl, '_blank');
                    }}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm"
                  >
                    SWMO Landfill Map
                  </button>
                  <button
                    onClick={() => setShowMapModal(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Route Details Modal */}
        {showRouteDetails && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]" onClick={() => setShowRouteDetails(null)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-900">Dispatcher Route Details</h3>
                <button onClick={() => setShowRouteDetails(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                  <X className="size-5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-500">Route</span><div className="text-gray-900">{showRouteDetails.id} - {showRouteDetails.name}</div></div>
                <div><span className="text-gray-500">Status</span><div className="text-gray-900">{labelRouteStatus(showRouteDetails.status)}</div></div>
                <div>
                  <span className="text-gray-500">Driver</span>
                  <div className="flex items-center gap-2 text-gray-900">
                    {showRouteDetails.truck && showRouteDetails.truck !== "Unassigned" && (
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          (() => {
                            const drv = drivers.find((d) => d.name === showRouteDetails.truck);
                            return drv && isDriverOnline(drv, onlineDriverIds, nowMs, driverStaleThresholdMs)
                              ? "bg-emerald-500"
                              : "bg-gray-400";
                          })()
                        }`}
                      />
                    )}
                    <span>{showRouteDetails.truck}</span>
                  </div>
                </div>
                <div><span className="text-gray-500">Stops</span><div className="text-gray-900">{showRouteDetails.stops}</div></div>
                <div><span className="text-gray-500">Distance</span><div className="text-gray-900">{showRouteDetails.distance}</div></div>
                <div><span className="text-gray-500">Duration</span><div className="text-gray-900">{showRouteDetails.duration}</div></div>
                <div><span className="text-gray-500">Generated</span><div className="text-gray-900">{showRouteDetails.generatedAt ?? "Not recorded"}</div></div>
                <div><span className="text-gray-500">Last Assignment Update</span><div className="text-gray-900">{showRouteDetails.assignmentUpdatedAt ?? "Not recorded"}</div></div>
              </div>
              <div className="mt-4 text-sm">
                <span className="text-gray-500">Stop Sequence</span>
                <div className="text-gray-900 mt-1">{showRouteDetails.optimizedStops?.join(" -> ") ?? "No stops available"}</div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <ConfirmModal
            isOpen={showDeleteConfirm}
            onClose={() => {
              setShowDeleteConfirm(false);
              setRouteToDelete(null);
            }}
            onConfirm={() => confirmDelete()}
            title="Delete Route"
            message="Are you sure you want to delete this route?"
            variant="danger"
            confirmText="Delete"
          />
        )}
        {showAlertToast && <Toast message="Alert sent to truck drivers." type="success" onClose={() => setShowAlertToast(false)} />}
        {routeToast && <Toast message={routeToast.message} type={routeToast.type} onClose={() => setRouteToast(null)} />}
    </div>
  );
}
