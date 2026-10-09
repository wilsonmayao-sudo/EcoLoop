import { supabase } from "../lib/supabase";
import { haversineMeters } from "../utils/geoNav";

export const LIVE_LOCATION_MIN_INTERVAL_MS = 3000;
export const LIVE_LOCATION_HISTORY_INTERVAL_MS = 15000;
export const LIVE_LOCATION_MIN_DISTANCE_M = 8;
export const LIVE_LOCATION_HISTORY_DISTANCE_M = 40;
export const LIVE_LOCATION_MAX_ACCURACY_M = 75;
export const LIVE_LOCATION_MAX_AGE_MS = 2 * 60 * 1000;

export function normalizeNumericId(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeGpsFix(loc) {
  if (!loc?.coords) return null;
  const latitude = Number(loc.coords.latitude);
  const longitude = Number(loc.coords.longitude);
  const accuracy = loc.coords.accuracy == null ? null : Number(loc.coords.accuracy);
  const timestamp = loc.timestamp ?? Date.now();

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001) return null;
  if (accuracy != null && Number.isFinite(accuracy) && accuracy > LIVE_LOCATION_MAX_ACCURACY_M) return null;
  if (Date.now() - timestamp > LIVE_LOCATION_MAX_AGE_MS) return null;

  return {
    lat: latitude,
    lng: longitude,
    accuracy,
    speedKph: Number.isFinite(loc.coords.speed) && loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed * 3.6 : null,
    headingDeg: Number.isFinite(loc.coords.heading) && loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null,
    ts: timestamp,
  };
}

export function shouldPublishLiveLocation({ current, lastSent, statusKey, lastStatusKey, minIntervalMs = LIVE_LOCATION_MIN_INTERVAL_MS, minDistanceM = LIVE_LOCATION_MIN_DISTANCE_M }) {
  if (!current) return false;
  if (!lastSent) return true;
  if (statusKey !== lastStatusKey) return true;
  const elapsed = current.ts - lastSent.ts;
  if (elapsed >= minIntervalMs) return true;
  const moved = haversineMeters({ lat: current.lat, lng: current.lng }, { lat: lastSent.lat, lng: lastSent.lng });
  return moved >= minDistanceM;
}

export function shouldRecordLocationHistory(current, lastHistory) {
  if (!current) return false;
  if (!lastHistory) return true;
  if (current.ts - lastHistory.ts >= LIVE_LOCATION_HISTORY_INTERVAL_MS) return true;
  const moved = haversineMeters({ lat: current.lat, lng: current.lng }, { lat: lastHistory.lat, lng: lastHistory.lng });
  return moved >= LIVE_LOCATION_HISTORY_DISTANCE_M;
}

export async function publishDriverLocation({ driverId, vehicleId, routeId, location, includeHistory = false }) {
  const normalizedDriverId = normalizeNumericId(driverId);
  const normalizedVehicleId = normalizeNumericId(vehicleId);
  const normalizedRouteId = normalizeNumericId(routeId);

  if (!normalizedDriverId || !location) return;

  const recordedAt = new Date(location.ts ?? Date.now()).toISOString();
  const payload = {
    driver_id: normalizedDriverId,
    route_id: normalizedRouteId,
    latitude: Number(location.lat.toFixed(7)),
    longitude: Number(location.lng.toFixed(7)),
    speed_kph: location.speedKph == null ? null : Number(location.speedKph.toFixed(2)),
    heading_deg: location.headingDeg == null ? null : Number(location.headingDeg.toFixed(1)),
  };

  if (includeHistory) {
    const { error } = await supabase.from("vehicle_gps_logs").insert({
      ...payload,
      vehicle_id: normalizedVehicleId,
      accuracy_m: location.accuracy == null ? null : Number(location.accuracy.toFixed(1)),
      recorded_at: recordedAt,
    });
    if (error) throw error;
  }

  if (!normalizedVehicleId) return;

  const { error } = await supabase.from("vehicle_locations_latest").upsert(
    {
      ...payload,
      vehicle_id: normalizedVehicleId,
      updated_at: recordedAt,
    },
    { onConflict: "vehicle_id" },
  );
  if (error) throw error;
}

export async function clearDriverLatestLocation({ driverId }) {
  const normalizedDriverId = normalizeNumericId(driverId);
  if (!normalizedDriverId) return;

  const { error } = await supabase
    .from("vehicle_locations_latest")
    .delete()
    .eq("driver_id", normalizedDriverId);
  if (error) throw error;
}
