/**
 * Centralized defaults, parsers, validators, runtime store, and formatters
 * for EcoLoop WebApp system settings stored in `public.system_settings`.
 */

export interface SystemSettingRecord {
  key: string;
  value: unknown;
  description?: string | null;
}

export interface OrganizationSetting {
  name: string;
  city: string;
  systemTitle: string;
  supportContact: string;
}

export type TimeFormatOption = "12h" | "24h";
export type DateFormatOption = "medium" | "iso" | "short";
export type DistanceUnitOption = "km" | "m";
export type VolumeUnitOption = "m3" | "L";
export type MassUnitOption = "kg" | "t";

export interface DisplayPreferencesSetting {
  timezone: string;
  timeFormat: TimeFormatOption;
  dateFormat: DateFormatOption;
  distanceUnit: DistanceUnitOption;
  volumeUnit: VolumeUnitOption;
  massUnit: MassUnitOption;
}

export interface DepotSetting {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface LandfillSetting {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  google_maps_url: string;
}

export interface OperationsConfigSetting {
  operatingHoursStart: string;
  operatingHoursEnd: string;
  gpsDelayedSeconds: number;
  gpsStoppedSeconds: number;
  driverOfflineSeconds: number;
  landfillProximityMeters: number;
  stopHandlingMinutes: number;
  preferTrafficRouting: boolean;
}

export type MapboxStyleId =
  | "streets-v12"
  | "navigation-day-v1"
  | "outdoors-v12"
  | "satellite-streets-v12";

export interface MapDefaultsSetting {
  centerLatitude: number;
  centerLongitude: number;
  defaultZoom: number;
  mapboxStyle: MapboxStyleId;
  showLandfillOnLiveMap: boolean;
}

export type IdleTimeoutOption = 0 | 15 | 30 | 60 | 120;

export interface SecurityConfigSetting {
  idleTimeoutMinutes: IdleTimeoutOption;
  minPasswordLength: number;
}

export interface ResolvedSystemSettings {
  organization: OrganizationSetting;
  displayPreferences: DisplayPreferencesSetting;
  depot: DepotSetting;
  landfill: LandfillSetting;
  operationsConfig: OperationsConfigSetting;
  mapDefaults: MapDefaultsSetting;
  securityConfig: SecurityConfigSetting;
}

export const SYSTEM_SETTING_KEYS = {
  ORGANIZATION: "organization",
  DISPLAY_PREFERENCES: "display_preferences",
  DEPOT: "depot",
  LANDFILL: "landfill",
  OPERATIONS_CONFIG: "operations_config",
  MAP_DEFAULTS: "map_defaults",
  SECURITY_CONFIG: "security_config",
} as const;

export const SYSTEM_SETTING_DESCRIPTIONS: Record<string, string> = {
  organization: "Municipal SWMO identity, system branding title, and operator support contact.",
  display_preferences: "Default timezone, date/time formatting, and measurement display units for WebApp.",
  depot: "Primary SWMO dispatch depot location used for route planning origin/destination.",
  landfill: "Sanitary landfill disposal facility coordinates and Google Maps reference link.",
  operations_config: "Operating window, fleet telemetry staleness thresholds, landfill radius, and routing heuristics.",
  map_defaults: "Default Mapbox style, viewport center, zoom level, and Live Fleet Map facility marker visibility.",
  security_config: "Web dashboard idle session timeout and administrator-issued password minimum length policy.",
};

export const DEFAULT_ORGANIZATION_SETTING: OrganizationSetting = {
  name: "Naga City Solid Waste Management Office",
  city: "Naga City",
  systemTitle: "EcoLoop",
  supportContact: "",
};

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferencesSetting = {
  timezone: "Asia/Manila",
  timeFormat: "12h",
  dateFormat: "medium",
  distanceUnit: "km",
  volumeUnit: "m3",
  massUnit: "kg",
};

export const DEFAULT_DEPOT_SETTING: DepotSetting = {
  id: "depot-swmo",
  name: "SWMO Motorpool & Dispatch Depot",
  latitude: 13.6218,
  longitude: 123.1948,
};

export const DEFAULT_LANDFILL_SETTING: LandfillSetting = {
  id: "landfill-swmo",
  name: "SWMO - Sanitary Landfill",
  address: "San Isidro, Naga City, Camarines Sur",
  latitude: 13.6212151,
  longitude: 123.2576126,
  google_maps_url: "https://www.google.com/maps/place/SWMO+-+SANITARY+LANDFILL/@13.6212151,123.2576126,17z",
};

export const DEFAULT_OPERATIONS_CONFIG: OperationsConfigSetting = {
  operatingHoursStart: "05:00",
  operatingHoursEnd: "17:00",
  gpsDelayedSeconds: 20,
  gpsStoppedSeconds: 60,
  driverOfflineSeconds: 120,
  landfillProximityMeters: 850,
  stopHandlingMinutes: 3,
  preferTrafficRouting: true,
};

export const DEFAULT_MAP_DEFAULTS: MapDefaultsSetting = {
  centerLatitude: 13.6218,
  centerLongitude: 123.1948,
  defaultZoom: 13,
  mapboxStyle: "streets-v12",
  showLandfillOnLiveMap: false,
};

export const DEFAULT_SECURITY_CONFIG: SecurityConfigSetting = {
  idleTimeoutMinutes: 0,
  minPasswordLength: 8,
};

export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Asia/Manila", label: "Asia/Manila (PHT, UTC+8)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT, UTC+8)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST, UTC+9)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
];

export const MAPBOX_STYLE_OPTIONS: Array<{ value: MapboxStyleId; label: string }> = [
  { value: "streets-v12", label: "Streets (Default Municipal)" },
  { value: "navigation-day-v1", label: "Navigation Day (High Road Contrast)" },
  { value: "outdoors-v12", label: "Outdoors (Terrain & Landmarks)" },
  { value: "satellite-streets-v12", label: "Satellite Streets (Aerial Hybrid)" },
];

export const IDLE_TIMEOUT_OPTIONS: Array<{ value: IdleTimeoutOption; label: string }> = [
  { value: 0, label: "Disabled (Stay signed in until manual sign out)" },
  { value: 15, label: "15 minutes of inactivity" },
  { value: 30, label: "30 minutes of inactivity" },
  { value: 60, label: "60 minutes (1 hour) of inactivity" },
  { value: 120, label: "120 minutes (2 hours) of inactivity" },
];

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeOrganizationSetting(raw: unknown): OrganizationSetting {
  const rec = asRecord(raw);
  return {
    name: asString(rec.name, DEFAULT_ORGANIZATION_SETTING.name).trim() || DEFAULT_ORGANIZATION_SETTING.name,
    city: asString(rec.city, DEFAULT_ORGANIZATION_SETTING.city).trim() || DEFAULT_ORGANIZATION_SETTING.city,
    systemTitle:
      asString(rec.systemTitle, DEFAULT_ORGANIZATION_SETTING.systemTitle).trim() ||
      DEFAULT_ORGANIZATION_SETTING.systemTitle,
    supportContact: asString(rec.supportContact, DEFAULT_ORGANIZATION_SETTING.supportContact).trim(),
  };
}

export function normalizeDisplayPreferences(raw: unknown): DisplayPreferencesSetting {
  const rec = asRecord(raw);
  const timeFormat = rec.timeFormat === "24h" ? "24h" : "12h";
  const dateFormat: DateFormatOption =
    rec.dateFormat === "iso" || rec.dateFormat === "short" ? rec.dateFormat : "medium";
  const distanceUnit: DistanceUnitOption = rec.distanceUnit === "m" ? "m" : "km";
  const volumeUnit: VolumeUnitOption = rec.volumeUnit === "L" ? "L" : "m3";
  const massUnit: MassUnitOption = rec.massUnit === "t" ? "t" : "kg";
  const timezoneRaw = asString(rec.timezone, DEFAULT_DISPLAY_PREFERENCES.timezone).trim();
  const timezone = isValidTimeZone(timezoneRaw) ? timezoneRaw : DEFAULT_DISPLAY_PREFERENCES.timezone;

  return { timezone, timeFormat, dateFormat, distanceUnit, volumeUnit, massUnit };
}

export function normalizeDepotSetting(raw: unknown): DepotSetting {
  const rec = asRecord(raw);
  return {
    id: asString(rec.id, DEFAULT_DEPOT_SETTING.id).trim() || DEFAULT_DEPOT_SETTING.id,
    name: asString(rec.name, DEFAULT_DEPOT_SETTING.name).trim() || DEFAULT_DEPOT_SETTING.name,
    latitude: clampNumber(asFiniteNumber(rec.latitude, DEFAULT_DEPOT_SETTING.latitude), -90, 90),
    longitude: clampNumber(asFiniteNumber(rec.longitude, DEFAULT_DEPOT_SETTING.longitude), -180, 180),
  };
}

export function normalizeLandfillSetting(raw: unknown): LandfillSetting {
  const rec = asRecord(raw);
  return {
    id: asString(rec.id, DEFAULT_LANDFILL_SETTING.id).trim() || DEFAULT_LANDFILL_SETTING.id,
    name: asString(rec.name, DEFAULT_LANDFILL_SETTING.name).trim() || DEFAULT_LANDFILL_SETTING.name,
    address: asString(rec.address, DEFAULT_LANDFILL_SETTING.address).trim() || DEFAULT_LANDFILL_SETTING.address,
    latitude: clampNumber(asFiniteNumber(rec.latitude, DEFAULT_LANDFILL_SETTING.latitude), -90, 90),
    longitude: clampNumber(asFiniteNumber(rec.longitude, DEFAULT_LANDFILL_SETTING.longitude), -180, 180),
    google_maps_url:
      asString(rec.google_maps_url, DEFAULT_LANDFILL_SETTING.google_maps_url).trim() ||
      DEFAULT_LANDFILL_SETTING.google_maps_url,
  };
}

export function normalizeOperationsConfig(raw: unknown): OperationsConfigSetting {
  const rec = asRecord(raw);
  const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const startRaw = asString(rec.operatingHoursStart, DEFAULT_OPERATIONS_CONFIG.operatingHoursStart);
  const endRaw = asString(rec.operatingHoursEnd, DEFAULT_OPERATIONS_CONFIG.operatingHoursEnd);

  const gpsDelayedSeconds = Math.round(
    clampNumber(asFiniteNumber(rec.gpsDelayedSeconds, DEFAULT_OPERATIONS_CONFIG.gpsDelayedSeconds), 5, 300),
  );
  const gpsStoppedSeconds = Math.round(
    clampNumber(
      asFiniteNumber(rec.gpsStoppedSeconds, DEFAULT_OPERATIONS_CONFIG.gpsStoppedSeconds),
      gpsDelayedSeconds + 5,
      600,
    ),
  );
  const driverOfflineSeconds = Math.round(
    clampNumber(
      asFiniteNumber(rec.driverOfflineSeconds, DEFAULT_OPERATIONS_CONFIG.driverOfflineSeconds),
      gpsStoppedSeconds,
      1800,
    ),
  );

  return {
    operatingHoursStart: timePattern.test(startRaw) ? startRaw : DEFAULT_OPERATIONS_CONFIG.operatingHoursStart,
    operatingHoursEnd: timePattern.test(endRaw) ? endRaw : DEFAULT_OPERATIONS_CONFIG.operatingHoursEnd,
    gpsDelayedSeconds,
    gpsStoppedSeconds,
    driverOfflineSeconds,
    landfillProximityMeters: Math.round(
      clampNumber(
        asFiniteNumber(rec.landfillProximityMeters, DEFAULT_OPERATIONS_CONFIG.landfillProximityMeters),
        100,
        5000,
      ),
    ),
    stopHandlingMinutes: Math.round(
      clampNumber(asFiniteNumber(rec.stopHandlingMinutes, DEFAULT_OPERATIONS_CONFIG.stopHandlingMinutes), 1, 30),
    ),
    preferTrafficRouting:
      typeof rec.preferTrafficRouting === "boolean"
        ? rec.preferTrafficRouting
        : DEFAULT_OPERATIONS_CONFIG.preferTrafficRouting,
  };
}

export function normalizeMapDefaults(raw: unknown): MapDefaultsSetting {
  const rec = asRecord(raw);
  const styleCandidate = rec.mapboxStyle;
  const mapboxStyle: MapboxStyleId =
    styleCandidate === "navigation-day-v1" ||
    styleCandidate === "outdoors-v12" ||
    styleCandidate === "satellite-streets-v12"
      ? styleCandidate
      : "streets-v12";

  return {
    centerLatitude: clampNumber(asFiniteNumber(rec.centerLatitude, DEFAULT_MAP_DEFAULTS.centerLatitude), -90, 90),
    centerLongitude: clampNumber(asFiniteNumber(rec.centerLongitude, DEFAULT_MAP_DEFAULTS.centerLongitude), -180, 180),
    defaultZoom: Number(clampNumber(asFiniteNumber(rec.defaultZoom, DEFAULT_MAP_DEFAULTS.defaultZoom), 11, 18).toFixed(1)),
    mapboxStyle,
    showLandfillOnLiveMap:
      typeof rec.showLandfillOnLiveMap === "boolean"
        ? rec.showLandfillOnLiveMap
        : DEFAULT_MAP_DEFAULTS.showLandfillOnLiveMap,
  };
}

export function normalizeSecurityConfig(raw: unknown): SecurityConfigSetting {
  const rec = asRecord(raw);
  const idleRaw = asFiniteNumber(rec.idleTimeoutMinutes, DEFAULT_SECURITY_CONFIG.idleTimeoutMinutes);
  const allowedTimeouts: IdleTimeoutOption[] = [0, 15, 30, 60, 120];
  const idleTimeoutMinutes = allowedTimeouts.includes(idleRaw as IdleTimeoutOption)
    ? (idleRaw as IdleTimeoutOption)
    : DEFAULT_SECURITY_CONFIG.idleTimeoutMinutes;

  return {
    idleTimeoutMinutes,
    minPasswordLength: Math.round(
      clampNumber(asFiniteNumber(rec.minPasswordLength, DEFAULT_SECURITY_CONFIG.minPasswordLength), 8, 20),
    ),
  };
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveAllSystemSettings(records: SystemSettingRecord[]): ResolvedSystemSettings {
  const map = new Map<string, unknown>();
  for (const row of records) {
    map.set(row.key, row.value);
  }
  return {
    organization: normalizeOrganizationSetting(map.get(SYSTEM_SETTING_KEYS.ORGANIZATION)),
    displayPreferences: normalizeDisplayPreferences(map.get(SYSTEM_SETTING_KEYS.DISPLAY_PREFERENCES)),
    depot: normalizeDepotSetting(map.get(SYSTEM_SETTING_KEYS.DEPOT)),
    landfill: normalizeLandfillSetting(map.get(SYSTEM_SETTING_KEYS.LANDFILL)),
    operationsConfig: normalizeOperationsConfig(map.get(SYSTEM_SETTING_KEYS.OPERATIONS_CONFIG)),
    mapDefaults: normalizeMapDefaults(map.get(SYSTEM_SETTING_KEYS.MAP_DEFAULTS)),
    securityConfig: normalizeSecurityConfig(map.get(SYSTEM_SETTING_KEYS.SECURITY_CONFIG)),
  };
}

let runtimeSettings: ResolvedSystemSettings = resolveAllSystemSettings([]);
const runtimeListeners = new Set<() => void>();

export function getRuntimeSystemSettings(): ResolvedSystemSettings {
  return runtimeSettings;
}

export function syncRuntimeSystemSettings(records: SystemSettingRecord[]): ResolvedSystemSettings {
  runtimeSettings = resolveAllSystemSettings(records);
  runtimeListeners.forEach((listener) => listener());
  return runtimeSettings;
}

export function subscribeRuntimeSettings(listener: () => void): () => void {
  runtimeListeners.add(listener);
  return () => {
    runtimeListeners.delete(listener);
  };
}

export function getMapboxStyleUrl(styleId?: MapboxStyleId): string {
  const id = styleId ?? runtimeSettings.mapDefaults.mapboxStyle;
  return `mapbox://styles/mapbox/${id}`;
}

export function getConfiguredLandfill() {
  const lf = runtimeSettings.landfill;
  return {
    id: lf.id,
    name: lf.name,
    address: lf.address,
    lat: lf.latitude,
    lng: lf.longitude,
    googleMapsUrl: lf.google_maps_url,
  };
}

export function formatDateOnly(value?: string | null, override?: DisplayPreferencesSetting): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  const prefs = override ?? runtimeSettings.displayPreferences;

  try {
    if (prefs.dateFormat === "iso") {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: prefs.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    }
    return new Intl.DateTimeFormat(undefined, {
      timeZone: prefs.timezone,
      dateStyle: prefs.dateFormat === "short" ? "short" : "medium",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
  }
}

export function formatDateTime(value?: string | null, override?: DisplayPreferencesSetting): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  const prefs = override ?? runtimeSettings.displayPreferences;

  try {
    const datePart = formatDateOnly(value, prefs);
    const timePart = new Intl.DateTimeFormat(undefined, {
      timeZone: prefs.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: prefs.timeFormat === "12h",
    }).format(date);
    return `${datePart}, ${timePart}`;
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
}

export function relativeTime(value?: string | null): string {
  if (!value) return "Not recorded";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Not recorded";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
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

export function formatDistanceDisplay(distanceMeters: number, override?: DisplayPreferencesSetting): string {
  const prefs = override ?? runtimeSettings.displayPreferences;
  const safeMeters = Number.isFinite(distanceMeters) ? distanceMeters : 0;
  if (prefs.distanceUnit === "m") {
    return `${Math.round(safeMeters).toLocaleString()} m`;
  }
  return `${(safeMeters / 1000).toFixed(1)} km`;
}

export function formatDistanceKmValue(distanceKm: number, override?: DisplayPreferencesSetting): string {
  const safeKm = Number.isFinite(distanceKm) ? distanceKm : 0;
  return formatDistanceDisplay(safeKm * 1000, override);
}

export function formatMassDisplay(massKg: number, override?: DisplayPreferencesSetting): string {
  const prefs = override ?? runtimeSettings.displayPreferences;
  const safeKg = Number.isFinite(massKg) ? massKg : 0;
  if (prefs.massUnit === "t") {
    return `${(safeKg / 1000).toFixed(2)} t`;
  }
  return `${Math.round(safeKg).toLocaleString()} kg`;
}

export function formatVolumeDisplay(volumeLiters: number, override?: DisplayPreferencesSetting): string {
  const prefs = override ?? runtimeSettings.displayPreferences;
  const safeLiters = Number.isFinite(volumeLiters) ? volumeLiters : 0;
  if (prefs.volumeUnit === "L") {
    return `${Math.round(safeLiters).toLocaleString()} L`;
  }
  return `${(safeLiters / 1000).toFixed(1)} m³`;
}

/** Field-level validation for draft forms inside SystemSettings. */
export type SettingFieldErrors = Record<string, string>;

export function validateGeneralDraft(
  org: OrganizationSetting,
  prefs: DisplayPreferencesSetting,
): SettingFieldErrors {
  const errors: SettingFieldErrors = {};
  if (!org.name.trim()) errors["organization.name"] = "Organization name is required.";
  if (!org.city.trim()) errors["organization.city"] = "Municipality or city name is required.";
  if (!org.systemTitle.trim()) errors["organization.systemTitle"] = "System display title is required.";
  if (!isValidTimeZone(prefs.timezone)) errors["display.timezone"] = "Select a valid IANA timezone.";
  return errors;
}

export function validateOperationsDraft(
  depot: DepotSetting,
  landfill: LandfillSetting,
  ops: OperationsConfigSetting,
): SettingFieldErrors {
  const errors: SettingFieldErrors = {};
  if (!depot.name.trim()) errors["depot.name"] = "Depot name is required.";
  if (!Number.isFinite(depot.latitude) || depot.latitude < -90 || depot.latitude > 90) {
    errors["depot.latitude"] = "Latitude must be between -90 and 90.";
  }
  if (!Number.isFinite(depot.longitude) || depot.longitude < -180 || depot.longitude > 180) {
    errors["depot.longitude"] = "Longitude must be between -180 and 180.";
  }

  if (!landfill.name.trim()) errors["landfill.name"] = "Landfill site name is required.";
  if (!landfill.address.trim()) errors["landfill.address"] = "Landfill address is required.";
  if (!Number.isFinite(landfill.latitude) || landfill.latitude < -90 || landfill.latitude > 90) {
    errors["landfill.latitude"] = "Latitude must be between -90 and 90.";
  }
  if (!Number.isFinite(landfill.longitude) || landfill.longitude < -180 || landfill.longitude > 180) {
    errors["landfill.longitude"] = "Longitude must be between -180 and 180.";
  }
  if (landfill.google_maps_url.trim()) {
    try {
      const parsed = new URL(landfill.google_maps_url.trim());
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        errors["landfill.google_maps_url"] = "Enter an http(s) Maps URL.";
      }
    } catch {
      errors["landfill.google_maps_url"] = "Enter a valid URL (or leave blank to omit).";
    }
  }

  const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timePattern.test(ops.operatingHoursStart)) {
    errors["ops.operatingHoursStart"] = "Use HH:MM 24-hour format.";
  }
  if (!timePattern.test(ops.operatingHoursEnd)) {
    errors["ops.operatingHoursEnd"] = "Use HH:MM 24-hour format.";
  }
  if (
    timePattern.test(ops.operatingHoursStart) &&
    timePattern.test(ops.operatingHoursEnd) &&
    ops.operatingHoursEnd <= ops.operatingHoursStart
  ) {
    errors["ops.operatingHoursEnd"] = "End time must be after operating start time.";
  }

  if (!Number.isFinite(ops.gpsDelayedSeconds) || ops.gpsDelayedSeconds < 5 || ops.gpsDelayedSeconds > 300) {
    errors["ops.gpsDelayedSeconds"] = "GPS delayed threshold must be between 5 and 300 seconds.";
  }
  if (
    !Number.isFinite(ops.gpsStoppedSeconds) ||
    ops.gpsStoppedSeconds <= ops.gpsDelayedSeconds ||
    ops.gpsStoppedSeconds > 600
  ) {
    errors["ops.gpsStoppedSeconds"] = "GPS stale/stopped threshold must be greater than GPS delayed and at most 600s.";
  }
  if (
    !Number.isFinite(ops.driverOfflineSeconds) ||
    ops.driverOfflineSeconds < ops.gpsStoppedSeconds ||
    ops.driverOfflineSeconds > 1800
  ) {
    errors["ops.driverOfflineSeconds"] =
      "Driver offline threshold must be at least GPS stale/stopped seconds and at most 1800s.";
  }
  if (
    !Number.isFinite(ops.landfillProximityMeters) ||
    ops.landfillProximityMeters < 100 ||
    ops.landfillProximityMeters > 5000
  ) {
    errors["ops.landfillProximityMeters"] = "Landfill arrival radius must be between 100 and 5000 meters.";
  }
  if (!Number.isFinite(ops.stopHandlingMinutes) || ops.stopHandlingMinutes < 1 || ops.stopHandlingMinutes > 30) {
    errors["ops.stopHandlingMinutes"] = "Stop handling allowance must be between 1 and 30 minutes.";
  }

  return errors;
}

export function validateMapDefaultsDraft(mapDefaults: MapDefaultsSetting): SettingFieldErrors {
  const errors: SettingFieldErrors = {};
  if (!Number.isFinite(mapDefaults.centerLatitude) || mapDefaults.centerLatitude < -90 || mapDefaults.centerLatitude > 90) {
    errors["map.centerLatitude"] = "Center latitude must be between -90 and 90.";
  }
  if (
    !Number.isFinite(mapDefaults.centerLongitude) ||
    mapDefaults.centerLongitude < -180 ||
    mapDefaults.centerLongitude > 180
  ) {
    errors["map.centerLongitude"] = "Center longitude must be between -180 and 180.";
  }
  if (!Number.isFinite(mapDefaults.defaultZoom) || mapDefaults.defaultZoom < 11 || mapDefaults.defaultZoom > 18) {
    errors["map.defaultZoom"] = "Default zoom must be between 11 and 18.";
  }
  return errors;
}

export function validateSecurityDraft(security: SecurityConfigSetting): SettingFieldErrors {
  const errors: SettingFieldErrors = {};
  if (
    !Number.isFinite(security.minPasswordLength) ||
    security.minPasswordLength < 8 ||
    security.minPasswordLength > 20
  ) {
    errors["security.minPasswordLength"] = "Minimum password length must be between 8 and 20 characters.";
  }
  return errors;
}
