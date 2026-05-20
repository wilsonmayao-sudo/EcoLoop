import type { Coordinate } from "./types";

const EARTH_RADIUS_METERS = 6371000;
const AVG_COLLECTION_SPEED_KMPH = 20;
/** Minutes added per stop for service time (used with Matrix travel times). */
export const STOP_HANDLING_MINUTES = 3;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineMeters(from: Coordinate, to: Coordinate): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function estimateDurationMinutes(distanceMeters: number, stopCount: number): number {
  const travelMinutes = (distanceMeters / 1000 / AVG_COLLECTION_SPEED_KMPH) * 60;
  return Math.max(1, Math.round(travelMinutes + stopCount * STOP_HANDLING_MINUTES));
}

export function formatDistanceKm(distanceMeters: number): string {
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

export function formatDurationMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

