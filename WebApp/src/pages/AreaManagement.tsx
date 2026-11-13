import React, { useEffect, useMemo, useState } from "react";
import { Layers, MapPin, Truck, Clock, X, Search, Ban, RotateCcw, Route as RouteIcon, AlertTriangle, Trash2, Recycle } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import CollectionBinsPanel from "../components/areas/CollectionBinsPanel";
import LiveFleetMap, { type LiveFleetMapMarker, type LiveFleetMapRoute } from "../components/maps/LiveFleetMap";
import CustomSelect from "../components/ui/CustomSelect";
import { formatDateOnly, isBinActive, normalizeStatus, useLiveData, type BinRecord, type PageType } from "../hooks/useLiveData";
import {
  fetchStreetRouteGeometry,
  getAreaRouteColor,
  getScheduleWaypointsForArea,
  type StreetRouteResult,
} from "../services/streetRouteService";
import {
  doesAreaMatchScheduleDay,
  doesScheduleMatchDay,
  SCHEDULE_DAY_CODES,
} from "../utils/scheduleDays";
import {
  cleanCollectionAreaTitle,
  formatAreaScheduleLabel,
  formatCollectionAreaDisplay,
} from "../utils/areaDisplay";

interface AreaManagementProps {
  onNavigate?: (page: PageType) => void;
  initialTab?: "areas" | "bins";
}

interface AreaScheduleEntry {
  days_of_week: string[];
  is_active: boolean;
}

interface DerivedCollectionArea {
  areaCode: string;
  areaName: string;
  scheduleLabel: string;
  displayTitle: string;
  color: string;
  shiftLabel: string;
  wasteCategory: string;
  assignedTruckNote: string | null;
  stopsCount: number;
  barangays: string[];
  days: string[];
  schedules: AreaScheduleEntry[];
  timeWindow: string;
  isActive: boolean;
  associatedBinIds: Set<string>;
}

function formatAreaBadgeAbbr(areaCode: string): string {
  const areaMatch = areaCode.match(/^AREA-(\d+[A-Z]*)$/i);
  if (areaMatch) return `A${areaMatch[1].toUpperCase()}`;
  const upper = areaCode.toUpperCase();
  if (upper === "COMPACTOR") return "CT";
  if (upper === "FLEET-CLEARING") return "FC";
  return areaCode.slice(0, 3).toUpperCase();
}

function compareAreaCodes(a: string, b: string): number {
  const numA = a.match(/^AREA-(\d+)([A-Z]*)$/i);
  const numB = b.match(/^AREA-(\d+)([A-Z]*)$/i);
  if (numA && numB) {
    const diff = Number(numA[1]) - Number(numB[1]);
    if (diff !== 0) return diff;
    return numA[2].localeCompare(numB[2]);
  }
  if (numA) return -1;
  if (numB) return 1;
  return a.localeCompare(b);
}

export default function AreaManagement({ onNavigate, initialTab = "areas" }: AreaManagementProps) {
  const {
    bins,
    collectionSchedules,
    routes,
    drivers,
    vehicles,
    loading,
    error,
    toggleCollectionAreaActive,
  } = useLiveData();

  const [activeTab, setActiveTab] = useState<"areas" | "bins">(initialTab);
  const [binAreaOverride, setBinAreaOverride] = useState<string | null>(null);
  const [selectedAreaCode, setSelectedAreaCode] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDay, setFilterDay] = useState<string>("ALL");
  const [filterBarangay, setFilterBarangay] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "ACTIVE" | "DISABLED">("ALL");
  const [showBinMarkers, setShowBinMarkers] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [streetRoutesByArea, setStreetRoutesByArea] = useState<Record<string, StreetRouteResult>>({});
  const [unresolvedRouteAreas, setUnresolvedRouteAreas] = useState<string[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);

  const binsById = useMemo(() => {
    const map = new Map<string, BinRecord>();
    bins.forEach((b) => map.set(String(b.id), b));
    return map;
  }, [bins]);

  // Derive collection areas dynamically from official schedule & bin database records
  const derivedAreas = useMemo((): DerivedCollectionArea[] => {
    const map = new Map<
      string,
      {
        areaName: string;
        shiftLabel: string;
        wasteCategory: string;
        assignedTruckNote: string | null;
        stopsCount: number;
        barangays: Set<string>;
        days: Set<string>;
        schedules: { days_of_week: string[]; is_active: boolean }[];
        timeWindow: string;
        isActive: boolean;
        associatedBinIds: Set<string>;
      }
    >();

    collectionSchedules.forEach((row) => {
      const code = row.area_code?.trim();
      if (!code) return;

      const existing = map.get(code) ?? {
        areaName: row.area_name || code,
        shiftLabel: row.shift_label || "Scheduled",
        wasteCategory: row.waste_category || "Standard SWMO Collection",
        assignedTruckNote: row.assigned_truck_note || null,
        stopsCount: 0,
        barangays: new Set<string>(),
        days: new Set<string>(),
        schedules: [] as { days_of_week: string[]; is_active: boolean }[],
        timeWindow: row.scheduled_time || "",
        isActive: row.is_active !== false,
        associatedBinIds: new Set<string>(),
      };

      existing.stopsCount += 1;
      if (row.barangay && row.stop_type !== "dump") existing.barangays.add(row.barangay);
      (row.days_of_week ?? []).forEach((d) => existing.days.add(d));
      existing.schedules.push({
        days_of_week: row.days_of_week ?? [],
        is_active: row.is_active !== false,
      });
      if (!existing.timeWindow && row.scheduled_time) existing.timeWindow = row.scheduled_time;
      if (!existing.assignedTruckNote && row.assigned_truck_note) existing.assignedTruckNote = row.assigned_truck_note;
      if (row.is_active === false) existing.isActive = false;
      if (row.bin_id != null) existing.associatedBinIds.add(String(row.bin_id));

      map.set(code, existing);
    });

    bins.forEach((bin) => {
      const code = bin.area_code?.trim();
      if (!code) return;
      const entry = map.get(code);
      if (entry) {
        entry.associatedBinIds.add(String(bin.id));
      }
    });

    const sortedCodes = Array.from(map.keys()).sort(compareAreaCodes);
    return sortedCodes.map((code, index) => {
      const data = map.get(code)!;
      const areaName = cleanCollectionAreaTitle(code, data.areaName);
      const scheduleLabel = formatAreaScheduleLabel(data.schedules);
      const displayTitle = formatCollectionAreaDisplay(code, data.areaName, data.schedules);
      return {
        areaCode: code,
        areaName,
        scheduleLabel,
        displayTitle,
        color: getAreaRouteColor(code, index),
        shiftLabel: data.shiftLabel,
        wasteCategory: data.wasteCategory,
        assignedTruckNote: data.assignedTruckNote,
        stopsCount: data.stopsCount,
        barangays: Array.from(data.barangays).sort((a, b) => a.localeCompare(b)),
        days: Array.from(data.days),
        schedules: data.schedules,
        timeWindow: data.timeWindow,
        isActive: data.isActive,
        associatedBinIds: data.associatedBinIds,
      };
    });
  }, [bins, collectionSchedules]);

  // Derive active routes & assigned trucks by area_code
  const routeByArea = useMemo(() => {
    const map = new Map<string, { routeName: string; driverName: string; vehicleCode: string; status: string }>();
    routes.forEach((route) => {
      if (!route.area_code) return;
      const existing = map.get(route.area_code);
      const statusNorm = normalizeStatus(route.status);
      // Prefer active over pending/completed if multiple routes exist for the same area
      if (existing && normalizeStatus(existing.status) === "active" && statusNorm !== "active") return;
      const driver = drivers.find((d) => String(d.id) === String(route.driver_id));
      const vehicle = vehicles.find(
        (v) =>
          (driver?.assigned_vehicle_id != null && String(v.id) === String(driver.assigned_vehicle_id)) ||
          String(v.route_id) === String(route.id),
      );
      map.set(route.area_code, {
        routeName: route.name,
        driverName: driver?.name ?? "Unassigned",
        vehicleCode: vehicle?.label || vehicle?.code || "Unassigned",
        status: route.status ?? "pending",
      });
    });
    return map;
  }, [drivers, routes, vehicles]);

  // Resolve street-level routes via Mapbox Directions / OSRM road network
  useEffect(() => {
    if (derivedAreas.length === 0 || collectionSchedules.length === 0) return;

    let cancelled = false;
    setRoutesLoading(true);

    // Prioritize selected area first so filtering feels instantaneous
    const orderedCodes = selectedAreaCode
      ? [selectedAreaCode, ...derivedAreas.map((a) => a.areaCode).filter((c) => c !== selectedAreaCode)]
      : derivedAreas.map((a) => a.areaCode);

    const run = async () => {
      const nextMap: Record<string, StreetRouteResult> = {};
      const failed: string[] = [];
      const concurrency = 3;

      for (let i = 0; i < orderedCodes.length; i += concurrency) {
        const batch = orderedCodes.slice(i, i + concurrency);
        await Promise.all(
          batch.map(async (areaCode) => {
            const waypoints = getScheduleWaypointsForArea(areaCode, collectionSchedules, binsById);
            const result = await fetchStreetRouteGeometry(areaCode, waypoints);
            if (result) {
              nextMap[areaCode] = result;
            } else {
              failed.push(areaCode);
            }
          }),
        );
        if (cancelled) return;
        setStreetRoutesByArea((prev) => ({ ...prev, ...nextMap }));
      }

      if (!cancelled) {
        setUnresolvedRouteAreas(failed);
        setRoutesLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [binsById, collectionSchedules, derivedAreas, selectedAreaCode]);

  const allBarangays = useMemo(() => {
    const set = new Set<string>();
    derivedAreas.forEach((a) => a.barangays.forEach((b) => set.add(b)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [derivedAreas]);

  const filteredAreas = useMemo(() => {
    return derivedAreas.filter((area) => {
      if (filterStatus === "ACTIVE" && !area.isActive) return false;
      if (filterStatus === "DISABLED" && area.isActive) return false;

      if (filterDay !== "ALL") {
        if (filterStatus === "DISABLED") {
          if (!area.schedules.some((s) => doesScheduleMatchDay(s.days_of_week, filterDay))) {
            return false;
          }
        } else if (!doesAreaMatchScheduleDay(area.schedules, filterDay)) {
          return false;
        }
      }

      if (filterBarangay !== "ALL" && !area.barangays.includes(filterBarangay)) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesCode = area.areaCode.toLowerCase().includes(q);
        const matchesName = area.displayTitle.toLowerCase().includes(q);
        const matchesBrgy = area.barangays.some((b) => b.toLowerCase().includes(q));
        if (!matchesCode && !matchesName && !matchesBrgy) return false;
      }

      return true;
    });
  }, [derivedAreas, filterBarangay, filterDay, filterStatus, searchQuery]);

  useEffect(() => {
    if (selectedAreaCode && !filteredAreas.some((a) => a.areaCode === selectedAreaCode)) {
      setSelectedAreaCode(null);
    }
  }, [filteredAreas, selectedAreaCode]);

  const selectedArea = useMemo(
    () => (selectedAreaCode ? filteredAreas.find((a) => a.areaCode === selectedAreaCode) ?? null : null),
    [filteredAreas, selectedAreaCode],
  );

  const selectedAreaBins = useMemo(() => {
    if (!selectedArea) return [];
    return bins.filter((b) => isBinActive(b) && selectedArea.associatedBinIds.has(String(b.id)));
  }, [bins, selectedArea]);

  const selectedAreaRoute = useMemo(
    () => (selectedArea ? routeByArea.get(selectedArea.areaCode) ?? null : null),
    [routeByArea, selectedArea],
  );

  // Street-level map routes: show only selected area's route when isolated, or filtered areas in All Areas view
  const mapRoutes = useMemo((): LiveFleetMapRoute[] => {
    const targetAreas = selectedArea
      ? [selectedArea]
      : filteredAreas;

    return targetAreas
      .map<LiveFleetMapRoute | null>((area) => {
        const resolved = streetRoutesByArea[area.areaCode];
        if (!resolved || resolved.coordinates.length < 2) return null;
        return {
          id: area.areaCode,
          label: area.displayTitle,
          color: area.color,
          coordinates: resolved.coordinates,
          selected: selectedArea?.areaCode === area.areaCode,
        };
      })
      .filter((r): r is LiveFleetMapRoute => r !== null);
  }, [filteredAreas, selectedArea, streetRoutesByArea]);

  // Map markers: show ONLY associated active bins when an area is selected, or filtered areas' bins in All Areas view
  const mapMarkers = useMemo((): LiveFleetMapMarker[] => {
    if (!showBinMarkers) return [];
    const hasAreaFilters =
      filterDay !== "ALL" || filterBarangay !== "ALL" || filterStatus !== "ALL" || Boolean(searchQuery.trim());
    const allowedBinIds = new Set<string>();
    filteredAreas.forEach((area) => {
      area.associatedBinIds.forEach((id) => allowedBinIds.add(id));
    });

    const targetBins = selectedArea
      ? bins.filter((b) => isBinActive(b) && selectedArea.associatedBinIds.has(String(b.id)))
      : hasAreaFilters
        ? bins.filter((b) => isBinActive(b) && allowedBinIds.has(String(b.id)))
        : bins.filter((b) => isBinActive(b));

    return targetBins.map((bin) => ({
      key: `bin:${bin.id}`,
      label: `${bin.code ?? bin.id} · ${bin.location} (${bin.area_code || "Naga"})`,
      latitude: Number(bin.latitude),
      longitude: Number(bin.longitude),
      delayed: false,
      tone: selectedArea ? "green" : "blue",
      icon: "bin",
      small: true,
    }));
  }, [bins, filterBarangay, filterDay, filterStatus, filteredAreas, searchQuery, selectedArea, showBinMarkers]);

  const handleToggleAreaStatus = async () => {
    if (!selectedArea) return;
    const nextActive = !selectedArea.isActive;
    setToggling(true);
    setActionNotice(null);
    try {
      await toggleCollectionAreaActive(selectedArea.areaCode, nextActive);
      setActionNotice(
        `${selectedArea.areaCode} is now ${nextActive ? "activated" : "disabled"} for collection operations.`,
      );
    } catch (err: any) {
      setActionNotice(`Failed to update area status: ${err?.message ?? "Error"}`);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Areas & Bins"
        subtitle="Naga City SWMO street-level collection routes, schedules, and bin locations"
        icon={<Layers className="size-5" aria-hidden="true" />}
        onNavigate={onNavigate as any}
      />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {actionNotice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center justify-between">
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice(null)} aria-label="Dismiss notice" className="text-emerald-700 hover:text-emerald-900 p-1">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase text-gray-500 tracking-wide">Collection Areas</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1">
            {loading ? "..." : derivedAreas.length}
          </div>
          <div className="text-blue-700 font-medium text-xs mt-1">Official SWMO Schedules</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase text-gray-500 tracking-wide">Barangays Covered</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1">
            {loading ? "..." : allBarangays.length}
          </div>
          <div className="text-emerald-700 font-medium text-xs mt-1">Naga City Jurisdiction</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase text-gray-500 tracking-wide">Active Collection Sites</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1">
            {loading ? "..." : bins.filter((b) => isBinActive(b)).length}
          </div>
          <div className="text-emerald-700 font-medium text-xs mt-1">GPS-verified bins</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <div className="text-xs font-semibold uppercase text-gray-500 tracking-wide">Schedule Stops</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums mt-1">
            {loading ? "..." : collectionSchedules.length}
          </div>
          <div className="text-indigo-700 font-medium text-xs mt-1">Street &amp; landfill waypoints</div>
        </div>
      </div>

      {/* Unified Areas & Bins Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1" role="tablist" aria-label="Areas and Bins views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "areas"}
            onClick={() => setActiveTab("areas")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === "areas" ? "bg-emerald-600 text-white shadow-xs" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Areas &amp; Schedules ({derivedAreas.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "bins"}
            onClick={() => {
              setBinAreaOverride(null);
              setActiveTab("bins");
            }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === "bins" ? "bg-emerald-600 text-white shadow-xs" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Collection Bins ({bins.length})
          </button>
        </div>
      </div>

      {activeTab === "areas" ? (
        <>

        {/* Interactive Street-Level Route Map */}
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-gray-50/70">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <RouteIcon className="size-5 text-emerald-700" />
                <h3 className="font-semibold text-gray-900 text-base">Street-Level Collection Routes</h3>
                {selectedArea ? (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: selectedArea.color }}
                  >
                    {selectedArea.areaCode}
                  </span>
                ) : (
                  <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-gray-200 text-gray-800">
                    All Areas ({derivedAreas.length})
                  </span>
                )}
                {routesLoading && <span className="text-xs text-gray-500">Loading street paths…</span>}
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                {selectedArea
                  ? `Showing street-level route and ${selectedAreaBins.length} active bin${selectedAreaBins.length === 1 ? "" : "s"} for ${selectedArea.displayTitle}.`
                  : "Select an individual collection area to isolate its street-level route and associated bins."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <CustomSelect
                size="sm"
                value={selectedAreaCode ?? "ALL"}
                onChange={(val) => setSelectedAreaCode(val === "ALL" ? null : val)}
                options={[
                  { value: "ALL", label: `All Areas (${filteredAreas.length})` },
                  ...filteredAreas.map((area) => ({
                    value: area.areaCode,
                    label: area.displayTitle,
                  })),
                ]}
                className="min-w-[240px]"
                ariaLabel="Filter map by collection area"
              />

              <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer bg-white px-3 py-1.5 border border-gray-200 rounded-lg shadow-2xs">
                <input
                  type="checkbox"
                  checked={showBinMarkers}
                  onChange={(e) => setShowBinMarkers(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span>Show Bins</span>
              </label>

              {selectedArea && (
                <button
                  type="button"
                  onClick={() => setSelectedAreaCode(null)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  All Areas
                </button>
              )}
            </div>
          </div>

          {unresolvedRouteAreas.length > 0 && (
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-700 shrink-0" />
              <span>
                Street-level routing could not be resolved for:{" "}
                <strong>{unresolvedRouteAreas.join(", ")}</strong> (straight-line fallback is disabled).
              </span>
            </div>
          )}

          <div className="relative">
            <LiveFleetMap
              markers={mapMarkers}
              routes={mapRoutes}
              loading={loading}
              onMarkerClick={(key) => {
                const binId = key.replace(/^bin:/, "");
                const b = bins.find((bin) => String(bin.id) === binId);
                if (b?.area_code) setSelectedAreaCode(b.area_code);
              }}
              showLandfill={true}
              selectedAreaCode={selectedAreaCode}
              onRouteClick={(areaCode) => setSelectedAreaCode(areaCode)}
              emptyMessage={selectedArea ? `No active bins found for ${selectedArea.areaCode}.` : "No active bins found."}
              className="relative h-[480px] sm:h-[540px] w-full overflow-hidden bg-gray-100"
            />

            {/* Map Legend Floating Box */}
            <div className="absolute left-3 bottom-3 z-10 rounded-lg bg-white/95 px-3 py-2.5 shadow-md text-xs text-gray-700 space-y-1.5 max-w-[260px] border border-gray-200">
              <div className="font-semibold text-gray-900 text-[11px] uppercase tracking-wider">Legend</div>
              <div className="flex items-center gap-2 text-[11px]">
                <span
                  className="inline-block w-5 h-1 rounded-full shrink-0"
                  style={{ backgroundColor: selectedArea?.color ?? "#059669" }}
                />
                <span>{selectedArea ? `${selectedArea.areaCode} Street Route` : "Street-Level Collection Routes"}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <Trash2 className={`size-3.5 shrink-0 ${selectedArea ? "text-emerald-600" : "text-blue-600"}`} aria-hidden="true" />
                <span>{selectedArea ? `${selectedArea.areaCode} Active Bin` : "Active Collection Bin Site"}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <Recycle className="size-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
                <span>SWMO Sanitary Landfill</span>
              </div>
            </div>
          </div>
        </div>

        {/* Selected Area Detail Card */}
        {selectedArea ? (
          <div className="bg-white rounded-xl shadow-md border-2 border-emerald-500/80 p-5 transition-all">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-gray-200 pb-3.5">
              <div className="flex items-start gap-3">
                <div
                  className="size-9 rounded-xl flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-xs"
                  style={{ backgroundColor: selectedArea.color }}
                >
                  {formatAreaBadgeAbbr(selectedArea.areaCode)}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-bold text-gray-900">{selectedArea.displayTitle}</h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        selectedArea.isActive ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                      }`}
                    >
                      {selectedArea.isActive ? "Active Schedule" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <span className="text-[11px] text-gray-500 font-medium">Barangay:</span>
                    {selectedArea.barangays.length > 0 ? (
                      selectedArea.barangays.map((b) => (
                        <span key={b} className="text-[11px] bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded font-medium">
                          {b}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-gray-600">—</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={handleToggleAreaStatus}
                  disabled={toggling}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg border flex items-center gap-1 transition-colors ${
                    selectedArea.isActive
                      ? "text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100"
                      : "text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                  }`}
                  title={selectedArea.isActive ? "Disable area for collection" : "Activate area"}
                >
                  {selectedArea.isActive ? (
                    <>
                      <Ban className="size-3" />
                      <span>{toggling ? "…" : "Disable"}</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-3" />
                      <span>{toggling ? "…" : "Enable"}</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setSelectedAreaCode(null)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                  title="Show All Areas"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-xs">
              {/* Schedule Info */}
              <div className="rounded-lg bg-gray-50 p-3 border border-gray-100 space-y-1.5">
                <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <Clock className="size-3.5 text-emerald-600" />
                  <span>Scheduled Collection</span>
                </div>
                <div>
                  <span className="text-gray-500">Shift / Time: </span>
                  <span className="font-medium text-gray-800">
                    {selectedArea.shiftLabel}
                    {selectedArea.timeWindow ? ` (${selectedArea.timeWindow})` : ""}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Collection Days: </span>
                  <span className="font-medium text-gray-800">
                    {selectedArea.days.length === 7 ? "Daily (Mon–Sun)" : selectedArea.days.join(", ") || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Waste Category: </span>
                  <span className="font-medium text-gray-800">{selectedArea.wasteCategory}</span>
                </div>
              </div>

              {/* Fleet & Route Info */}
              <div className="rounded-lg bg-gray-50 p-3 border border-gray-100 space-y-1.5">
                <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <Truck className="size-3.5 text-blue-600" />
                  <span>Route & Assigned Truck</span>
                </div>
                <div>
                  <span className="text-gray-500">Assigned Truck: </span>
                  <span className="font-medium text-gray-800">
                    {selectedAreaRoute?.vehicleCode || selectedArea.assignedTruckNote || "Unassigned"}
                    {selectedAreaRoute?.driverName && selectedAreaRoute.driverName !== "Unassigned"
                      ? ` (${selectedAreaRoute.driverName})`
                      : ""}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Route Status: </span>
                  <span className="font-medium text-gray-800 capitalize">
                    {selectedAreaRoute ? selectedAreaRoute.status : selectedArea.isActive ? "Scheduled" : "Disabled"}
                  </span>
                  {selectedAreaRoute?.routeName && (
                    <span className="text-gray-500"> — {selectedAreaRoute.routeName}</span>
                  )}
                </div>
                <div>
                  <span className="text-gray-500">Associated Active Bins: </span>
                  <span className="font-bold text-emerald-700">{selectedAreaBins.length} active</span>
                </div>
              </div>
            </div>

            {/* Associated Active Bins List */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase text-gray-500">
                  Associated Active Bins in {selectedArea.areaCode} ({selectedAreaBins.length})
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setBinAreaOverride(selectedArea.areaCode);
                    setActiveTab("bins");
                  }}
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                >
                  Manage bins in {selectedArea.areaCode} →
                </button>
              </div>
              {selectedAreaBins.length > 0 ? (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {selectedAreaBins.map((bin) => (
                    <div
                      key={bin.id}
                      className="p-2.5 bg-gray-50 hover:bg-gray-100/80 rounded-lg border border-gray-200 text-xs flex items-center justify-between transition-colors"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                          <MapPin className="size-3 text-emerald-600 shrink-0" />
                          <span className="truncate">{bin.code ?? bin.id}</span>
                          {bin.barangay && <span className="text-[11px] font-normal text-gray-500">· {bin.barangay}</span>}
                        </div>
                        <div className="text-gray-600 text-[11px] truncate mt-0.5">{bin.location}</div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium shrink-0">
                        Active
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500 italic py-2">No active bins currently recorded for this area.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-emerald-50/60 rounded-xl border border-emerald-200 p-4 text-xs text-emerald-900 flex items-center gap-3">
            <MapPin className="size-5 text-emerald-600 shrink-0" />
            <div>
              <div className="font-semibold text-emerald-950 text-sm">All Areas View Active</div>
              <div className="text-emerald-800 mt-0.5">
                Choose a collection area from the map filter, click any street route line, or select an area card below to inspect its bins, schedule, and street-level path.
              </div>
            </div>
          </div>
        )}

        {/* Areas Directory & Filters */}
        <div className="space-y-3.5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-gray-900">All Collection Areas</h3>
              <p className="text-xs text-gray-600">
                Showing {filteredAreas.length} of {derivedAreas.length} collection area{derivedAreas.length === 1 ? "" : "s"}
                {filterDay !== "ALL" ? ` scheduled for ${filterDay} (including Daily schedules)` : ""}.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Filter collection areas by schedule day">
                <button
                  type="button"
                  onClick={() => setFilterDay("ALL")}
                  className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                    filterDay === "ALL" ? "bg-emerald-600 text-white" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  All Days
                </button>
                {SCHEDULE_DAY_CODES.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setFilterDay(day)}
                    className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                      filterDay === day ? "bg-emerald-600 text-white" : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[160px]">
                <Search className="size-3.5 text-gray-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  placeholder="Search areas..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-2.5 py-1.5 text-xs bg-white border border-gray-300 rounded-lg text-gray-700 w-full focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <CustomSelect
                size="sm"
                value={filterBarangay}
                onChange={setFilterBarangay}
                options={[
                  { value: "ALL", label: "All Barangays" },
                  ...allBarangays.map((b) => ({ value: b, label: b })),
                ]}
                className="min-w-[155px]"
                ariaLabel="Filter by barangay"
              />
              <CustomSelect
                size="sm"
                value={filterStatus}
                onChange={(val) => setFilterStatus(val as "ALL" | "ACTIVE" | "DISABLED")}
                options={[
                  { value: "ALL", label: "All Status" },
                  { value: "ACTIVE", label: "Active" },
                  { value: "DISABLED", label: "Disabled" },
                ]}
                className="min-w-[125px]"
                ariaLabel="Filter by status"
              />
            </div>
          </div>

          {filteredAreas.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-600">
              No collection areas match the selected schedule filters{filterDay !== "ALL" ? ` for ${filterDay}` : ""}.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredAreas.map((area) => {
                const isSelected = selectedAreaCode === area.areaCode;
                const areaBinsCount = bins.filter(
                  (b) => isBinActive(b) && area.associatedBinIds.has(String(b.id)),
                ).length;

                return (
                  <div
                    key={area.areaCode}
                    onClick={() => setSelectedAreaCode(area.areaCode)}
                    className={`bg-white rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm ${
                      isSelected ? "ring-2 ring-emerald-500 border-emerald-500 shadow-xs" : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="size-7 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0"
                          style={{ backgroundColor: area.color }}
                        >
                          {formatAreaBadgeAbbr(area.areaCode)}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-gray-900 text-xs leading-snug truncate">
                            {area.displayTitle}
                          </h4>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                          area.isActive
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {area.isActive ? "Active" : "Disabled"}
                      </span>
                    </div>

                    <div className="text-[11px] text-gray-600 space-y-0.5 mb-2">
                      <div className="truncate">
                        <span className="text-gray-500">Barangay: </span>
                        <span>{area.barangays.join(", ") || "—"}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Shift: </span>
                        <span>{area.shiftLabel}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-[11px]">
                      <span className="text-gray-500">
                        <strong className="text-gray-900">{areaBinsCount}</strong> active bins · {area.stopsCount} stops
                      </span>
                      <span className="text-emerald-700 font-medium hover:underline flex items-center gap-1">
                        <span>View street route</span>
                        <span>→</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </>
      ) : (
        <CollectionBinsPanel areaFilterOverride={binAreaOverride} />
      )}
    </div>
  );
}
