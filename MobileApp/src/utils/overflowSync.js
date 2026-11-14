export function normalizeNonEmptyId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  return trimmed;
}

export function normalizeRouteStatus(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function isOpenRouteStatus(status) {
  const norm = normalizeRouteStatus(status);
  return norm === "active" || norm === "in_progress" || norm === "pending" || norm === "planned";
}

export function isOverflowRouteRecord(route) {
  if (!route) return false;
  const method = normalizeRouteStatus(route.optimization_method);
  if (method === "overflow_reassignment" || method === "dynamic-reassignment+mapbox") {
    return true;
  }
  return String(route.name ?? "")
    .toLowerCase()
    .includes("overflow");
}

export function getEventTargetRouteId(event) {
  if (!event) return null;
  const direct = normalizeNonEmptyId(event.target_route_id);
  if (direct) return direct;
  const fromMeta = normalizeNonEmptyId(event?.reassignment_metadata?.target_route_id);
  if (fromMeta) return fromMeta;
  if (Array.isArray(event?.overflow_bins) && event.overflow_bins[0]?._meta?.target_route_id != null) {
    return normalizeNonEmptyId(event.overflow_bins[0]._meta.target_route_id);
  }
  return null;
}

export function extractOverflowBinIds(overflowBins) {
  if (!Array.isArray(overflowBins)) return [];
  const seen = new Set();
  const ids = [];
  for (const entry of overflowBins) {
    if (typeof entry === "string" || typeof entry === "number") {
      const primId = normalizeNonEmptyId(entry);
      if (primId && !seen.has(primId)) {
        seen.add(primId);
        ids.push(primId);
      }
      continue;
    }
    const idStr = normalizeNonEmptyId(entry?.bin_id ?? entry?.binId ?? entry?.id);
    if (!idStr || seen.has(idStr)) continue;
    seen.add(idStr);
    ids.push(idStr);
  }
  return ids;
}

export function eventBelongsToDriverAsTarget(event, driverId, vehicleId = null) {
  const driverStr = normalizeNonEmptyId(driverId);
  const vehStr = normalizeNonEmptyId(vehicleId);
  const targetDriverStr = normalizeNonEmptyId(event?.target_driver_id);
  const targetVehStr = normalizeNonEmptyId(event?.target_vehicle_id);

  if (targetDriverStr) {
    return driverStr != null && targetDriverStr === driverStr;
  }
  return vehStr != null && targetVehStr != null && targetVehStr === vehStr;
}

export function eventBelongsToDriverAsSource(event, driverId, vehicleId = null) {
  const driverStr = normalizeNonEmptyId(driverId);
  const vehStr = normalizeNonEmptyId(vehicleId);
  const sourceDriverStr = normalizeNonEmptyId(event?.source_driver_id);
  const sourceVehStr = normalizeNonEmptyId(event?.source_vehicle_id);

  if (sourceDriverStr) {
    return driverStr != null && sourceDriverStr === driverStr;
  }
  return vehStr != null && sourceVehStr != null && sourceVehStr === vehStr;
}

function getEventSortTime(ev) {
  const ts = ev?.accepted_at ?? ev?.dispatched_at ?? ev?.created_at ?? null;
  const ms = ts ? new Date(ts).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

export function selectActiveDriverRoute(
  driverRoutes,
  activeOverflowEvents = [],
  allPickups = [],
  preferredRouteId = null,
) {
  const routes = Array.isArray(driverRoutes) ? driverRoutes : [];
  if (routes.length === 0) return null;

  const openRoutes = routes.filter((r) => isOpenRouteStatus(r.status));
  const pickups = Array.isArray(allPickups) ? allPickups : [];
  const pendingPickups = pickups.filter((p) => normalizeRouteStatus(p.deliveryStatus) !== "completed");
  const preferredIdStr = normalizeNonEmptyId(preferredRouteId);

  // Priority 1: Active accepted overflow dispatch route
  const sortedOverflowEvents = [...(Array.isArray(activeOverflowEvents) ? activeOverflowEvents : [])]
    .filter((ev) => normalizeRouteStatus(ev?.status) === "accepted")
    .sort((a, b) => getEventSortTime(b) - getEventSortTime(a));

  for (const ev of sortedOverflowEvents) {
    const evTargetRouteId = getEventTargetRouteId(ev);
    const evBinSet = new Set(extractOverflowBinIds(ev.overflow_bins));

    if (evTargetRouteId) {
      const explicitOpen = openRoutes.find((r) => String(r.id) === evTargetRouteId);
      if (explicitOpen) return explicitOpen;
    }

    const overflowOpenRoutes = openRoutes.filter((r) => isOverflowRouteRecord(r));
    if (overflowOpenRoutes.length > 0) {
      if (evBinSet.size > 0) {
        const matchingByBin = overflowOpenRoutes.find((r) =>
          pickups.some(
            (p) => String(p.routeId) === String(r.id) && evBinSet.has(String(p.binId)),
          ),
        );
        if (matchingByBin) return matchingByBin;
      }
      return overflowOpenRoutes[0];
    }

    if (evBinSet.size > 0) {
      const routeWithPendingOverflowBin = openRoutes.find((r) =>
        pendingPickups.some(
          (p) => String(p.routeId) === String(r.id) && evBinSet.has(String(p.binId)),
        ),
      );
      if (routeWithPendingOverflowBin) return routeWithPendingOverflowBin;
    }
  }

  // Also honor explicit open Overflow Assistance Route even if event cache lags momentarily
  const openOverflowRoute =
    (preferredIdStr
      ? openRoutes.find((r) => String(r.id) === preferredIdStr && isOverflowRouteRecord(r))
      : null) ?? openRoutes.find((r) => isOverflowRouteRecord(r));
  if (openOverflowRoute) return openOverflowRoute;

  if (preferredIdStr) {
    const preferredOpen = openRoutes.find((r) => String(r.id) === preferredIdStr);
    if (preferredOpen && normalizeRouteStatus(preferredOpen.status) !== "pending") {
      return preferredOpen;
    }
  }

  // Priority 2-4: Regular active/started -> active -> pending/planned
  return (
    openRoutes.find((r) => {
      const st = normalizeRouteStatus(r.status);
      return (st === "active" || st === "in_progress") && Boolean(r.started_at);
    }) ??
    openRoutes.find((r) => {
      const st = normalizeRouteStatus(r.status);
      return st === "active" || st === "in_progress";
    }) ??
    openRoutes.find((r) => {
      const st = normalizeRouteStatus(r.status);
      return st === "pending" || st === "planned";
    }) ??
    routes.find((r) => normalizeRouteStatus(r.status) === "completed") ??
    routes[0] ??
    null
  );
}

export function resolveLinkedOverflowEvent(currentRoute, activeOverflowEvents = [], allPickups = []) {
  if (!currentRoute) return null;
  const accepted = [...(Array.isArray(activeOverflowEvents) ? activeOverflowEvents : [])]
    .filter((ev) => normalizeRouteStatus(ev?.status) === "accepted")
    .sort((a, b) => getEventSortTime(b) - getEventSortTime(a));

  if (accepted.length === 0) return null;

  const routeIdStr = String(currentRoute.id);
  const directMatch = accepted.find((ev) => getEventTargetRouteId(ev) === routeIdStr);
  if (directMatch) return directMatch;

  const routeBinIds = new Set(
    (Array.isArray(allPickups) ? allPickups : [])
      .filter((p) => String(p.routeId) === routeIdStr)
      .map((p) => String(p.binId)),
  );

  if (routeBinIds.size > 0) {
    const binMatch = accepted.find((ev) =>
      extractOverflowBinIds(ev.overflow_bins).some((bid) => routeBinIds.has(bid)),
    );
    if (binMatch) return binMatch;
  }

  return isOverflowRouteRecord(currentRoute) ? accepted[0] : null;
}

export function sortPickupsForActiveRoute(pickups, linkedOverflowEvent = null) {
  const list = Array.isArray(pickups) ? [...pickups] : [];
  if (list.length <= 1) return list;

  const overflowOrderMap = new Map();
  if (linkedOverflowEvent) {
    extractOverflowBinIds(linkedOverflowEvent.overflow_bins).forEach((binIdStr, idx) => {
      overflowOrderMap.set(binIdStr, idx);
    });
  }

  return list.sort((a, b) => {
    const aOv = overflowOrderMap.has(String(a.binId))
      ? overflowOrderMap.get(String(a.binId))
      : Number.POSITIVE_INFINITY;
    const bOv = overflowOrderMap.has(String(b.binId))
      ? overflowOrderMap.get(String(b.binId))
      : Number.POSITIVE_INFINITY;
    if (aOv !== bOv) return aOv - bOv;

    const aOrder = Number.isFinite(Number(a.stopOrder)) ? Number(a.stopOrder) : 9999;
    const bOrder = Number.isFinite(Number(b.stopOrder)) ? Number(b.stopOrder) : 9999;
    return aOrder - bOrder;
  });
}

export function deriveRouteState(route) {
  if (!route) return "none";
  const st = normalizeRouteStatus(route.status);
  if (st === "pending" || st === "planned") return "pending";
  if ((st === "active" || st === "in_progress") && !route.started_at) return "accepted";
  if ((st === "active" || st === "in_progress") && route.started_at) return "in_progress";
  if (st === "completed") return "completed";
  return "none";
}

export function formatOverflowSyncState({
  driverId,
  vehicleId = null,
  driverRoutes = [],
  overflowEvents = [],
  allPickups = [],
  preferredRouteId = null,
}) {
  const allEvents = Array.isArray(overflowEvents) ? overflowEvents : [];
  const pickups = Array.isArray(allPickups) ? allPickups : [];
  const pendingPickupsAll = pickups.filter((p) => normalizeRouteStatus(p.deliveryStatus) !== "completed");

  const targetDispatched = allEvents
    .filter(
      (ev) =>
        normalizeRouteStatus(ev?.status) === "dispatched" &&
        eventBelongsToDriverAsTarget(ev, driverId, vehicleId),
    )
    .sort((a, b) => getEventSortTime(b) - getEventSortTime(a));

  const incomingOverflowEvent = targetDispatched[0] ?? null;

  const targetAccepted = allEvents
    .filter(
      (ev) =>
        normalizeRouteStatus(ev?.status) === "accepted" &&
        eventBelongsToDriverAsTarget(ev, driverId, vehicleId),
    )
    .sort((a, b) => getEventSortTime(b) - getEventSortTime(a));

  const openRouteIdSet = new Set(
    (Array.isArray(driverRoutes) ? driverRoutes : [])
      .filter((r) => isOpenRouteStatus(r.status))
      .map((r) => String(r.id)),
  );

  // Filter accepted events that still belong to an open route or have uncompleted stops
  const activeOverflowEvents = targetAccepted.filter((ev) => {
    const targetRouteId = getEventTargetRouteId(ev);
    if (targetRouteId && openRouteIdSet.has(targetRouteId)) return true;
    const evBins = new Set(extractOverflowBinIds(ev.overflow_bins));
    if (evBins.size === 0) return false;
    return pendingPickupsAll.some((p) => evBins.has(String(p.binId)));
  });

  const sourceActive = allEvents
    .filter((ev) => {
      const st = normalizeRouteStatus(ev?.status);
      if (st !== "pending" && st !== "dispatched" && st !== "accepted") return false;
      return eventBelongsToDriverAsSource(ev, driverId, vehicleId);
    })
    .sort((a, b) => getEventSortTime(b) - getEventSortTime(a));

  const currentRoute = selectActiveDriverRoute(
    driverRoutes,
    activeOverflowEvents,
    pickups,
    preferredRouteId,
  );
  const routeState = deriveRouteState(currentRoute);
  const linkedOverflowEvent = resolveLinkedOverflowEvent(currentRoute, activeOverflowEvents, pickups);
  const isOverflowRouteActive = Boolean(
    currentRoute && (isOverflowRouteRecord(currentRoute) || linkedOverflowEvent),
  );

  const routeAssignedPickups = currentRoute
    ? sortPickupsForActiveRoute(
        pickups.filter((p) => String(p.routeId) === String(currentRoute.id)),
        linkedOverflowEvent,
      )
    : [];
  const routePendingPickups = routeAssignedPickups.filter(
    (p) => normalizeRouteStatus(p.deliveryStatus) !== "completed",
  );

  return {
    incomingOverflowEvent,
    activeOverflowEvents,
    activeOverflowEvent: linkedOverflowEvent ?? activeOverflowEvents[0] ?? null,
    activeSourceOverflowEvent: sourceActive[0] ?? null,
    currentRoute,
    routeState,
    routeAssignedPickups,
    routePendingPickups,
    isOverflowRouteActive,
  };
}
