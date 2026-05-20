import { haversineMeters } from "./geo";
import { isValidCoordinate } from "./costModel";
import type { Coordinate } from "./types";

interface ClusterCandidate<T> {
  item: T;
  angle: number;
  distanceMeters: number;
}

function angleFromDepot(depot: Coordinate, coordinate: Coordinate): number {
  const latDelta = coordinate.lat - depot.lat;
  const lngDelta = (coordinate.lng - depot.lng) * Math.cos((depot.lat * Math.PI) / 180);
  return Math.atan2(latDelta, lngDelta);
}

function rotateAtLargestAngularGap<T>(items: ClusterCandidate<T>[]): ClusterCandidate<T>[] {
  if (items.length < 2) return items;

  let largestGap = -1;
  let rotateIndex = 0;
  for (let i = 0; i < items.length; i++) {
    const current = items[i].angle;
    const next = items[(i + 1) % items.length].angle + (i === items.length - 1 ? Math.PI * 2 : 0);
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      rotateIndex = (i + 1) % items.length;
    }
  }

  return [...items.slice(rotateIndex), ...items.slice(0, rotateIndex)];
}

export function clusterStopsByDepotSweep<T>(
  items: T[],
  depot: Coordinate,
  bucketCount: number,
  getCoordinate: (item: T) => Coordinate,
): T[][] {
  const safeBucketCount = Math.max(0, Math.min(bucketCount, items.length));
  if (safeBucketCount === 0 || !isValidCoordinate(depot)) return [];

  const candidates = items
    .map((item) => {
      const coordinate = getCoordinate(item);
      if (!isValidCoordinate(coordinate)) return null;
      return {
        item,
        angle: angleFromDepot(depot, coordinate),
        distanceMeters: haversineMeters(depot, coordinate),
      };
    })
    .filter(Boolean) as ClusterCandidate<T>[];

  if (candidates.length === 0) return [];

  const ordered = rotateAtLargestAngularGap(
    candidates.sort((a, b) => a.angle - b.angle || a.distanceMeters - b.distanceMeters),
  );
  const actualBucketCount = Math.min(safeBucketCount, ordered.length);
  const baseSize = Math.floor(ordered.length / actualBucketCount);
  const extra = ordered.length % actualBucketCount;

  const buckets: T[][] = [];
  let cursor = 0;
  for (let bucket = 0; bucket < actualBucketCount; bucket++) {
    const size = baseSize + (bucket < extra ? 1 : 0);
    buckets.push(ordered.slice(cursor, cursor + size).map((candidate) => candidate.item));
    cursor += size;
  }

  return buckets;
}
