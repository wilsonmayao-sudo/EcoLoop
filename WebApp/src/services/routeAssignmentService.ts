import { supabase } from "./supabaseClient";

export const OPEN_ROUTE_STATUSES = ["pending", "planned", "active"] as const;
const DEFAULT_CREATION_TIMEOUT_MS = 15000;

export interface ExistingOpenRouteCandidate {
  id: string | number;
  name: string;
  status: string;
  area_code?: string | null;
  scheduled_days?: string[] | null;
  shift_label?: string | null;
  driver_id?: string | number | null;
  vehicle_id?: string | number | null;
  driver_name?: string | null;
  request_key?: string | null;
}

export interface RouteConflictCheckInput {
  name: string;
  areaCode?: string | null;
  scheduledDays?: string[] | null;
  shiftLabel?: string | null;
  driverId: string | number;
  driverName?: string | null;
  vehicleId?: string | number | null;
  vehicleLabel?: string | null;
}

export interface RouteConflictResult {
  code: "AREA_CONFLICT" | "DUPLICATE_ROUTE_NAME" | "DRIVER_CONFLICT" | "VEHICLE_CONFLICT";
  existingRouteId: string;
  existingRouteName: string;
  existingStatus: string;
  message: string;
}

export interface CreateRouteAssignmentInput {
  requestKey: string;
  name: string;
  status?: "pending" | "planned" | "active";
  areaCode?: string | null;
  scheduledDays?: string[] | null;
  shiftLabel?: string | null;
  wasteCategory?: string | null;
  distanceKm: number;
  durationMinutes: number;
  driverId: string | number;
  driverName: string;
  driverAuthUserId?: string | null;
  vehicleId?: string | number | null;
  vehicleLabel?: string | null;
  centerLat: number;
  centerLng: number;
  optimizationMethod?: string;
  costSource?: string;
  usedMapboxTraffic?: boolean;
  binIds: Array<string | number>;
}

export interface CreateRouteAssignmentOutcome {
  ok: boolean;
  routeId?: string;
  vehicleId?: string | number | null;
  idempotent?: boolean;
  recoveredFromTimeout?: boolean;
  conflict?: boolean;
  timedOut?: boolean;
  code?: string;
  existingRouteId?: string;
  error?: string;
}

export function generateRouteRequestKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeRouteStatus(status: unknown): string {
  return String(status ?? "").trim().toLowerCase();
}

export function isOpenRouteStatus(status: unknown): boolean {
  const n = normalizeRouteStatus(status);
  return n === "pending" || n === "planned" || n === "active";
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function extractDayTag(routeName: string): string | null {
  const match = /\((Mon|Tue|Wed|Thu|Fri|Sat|Sun)\)/.exec(routeName);
  return match ? match[1] : null;
}

function schedulesOverlap(
  existingDays: string[] | null | undefined,
  existingName: string,
  candidateDays: string[] | null | undefined,
): boolean {
  const a = Array.isArray(existingDays) ? existingDays.filter(Boolean) : [];
  const b = Array.isArray(candidateDays) ? candidateDays.filter(Boolean) : [];
  if (a.length === 0 || b.length === 0) return true;

  const setA = new Set(a);
  const intersects = b.some((d) => setA.has(d));
  if (!intersects) return false;

  // Legacy routes from daily schedules often stored all 7 days while encoding the actual dispatch day in the name
  if (a.length === 7 && b.length === 1) {
    const existingTag = extractDayTag(existingName);
    if (existingTag && existingTag !== b[0]) {
      return false;
    }
  }
  return true;
}

function shiftsConflict(existingShift: string | null | undefined, candidateShift: string | null | undefined): boolean {
  const a = normalizeText(existingShift).toLowerCase();
  const b = normalizeText(candidateShift).toLowerCase();
  if (!a || !b) return true;
  return a === b;
}

/**
 * Checks whether creating a route with `candidate` conflicts with any open route (`pending`, `planned`, `active`).
 * Allows completed/cancelled history, intentional reassignments, and non-overlapping future schedules.
 */
export function findRouteAssignmentConflict(
  existingRoutes: ExistingOpenRouteCandidate[],
  candidate: RouteConflictCheckInput,
): RouteConflictResult | null {
  const openRoutes = existingRoutes.filter((r) => isOpenRouteStatus(r.status));
  const areaCode = normalizeText(candidate.areaCode).toUpperCase();
  const routeName = normalizeText(candidate.name).toLowerCase();
  const candidateDays = candidate.scheduledDays ?? [];

  if (areaCode) {
    for (const existing of openRoutes) {
      const existingArea = normalizeText(existing.area_code).toUpperCase();
      if (existingArea !== areaCode) continue;
      if (!shiftsConflict(existing.shift_label, candidate.shiftLabel)) continue;
      if (!schedulesOverlap(existing.scheduled_days, existing.name, candidateDays)) continue;

      const driverSuffix = existing.driver_name ? ` • Driver: ${existing.driver_name}` : "";
      return {
        code: "AREA_CONFLICT",
        existingRouteId: String(existing.id),
        existingRouteName: existing.name,
        existingStatus: existing.status,
        message: `Collection area ${areaCode} already has a ${normalizeRouteStatus(existing.status)} route (#${existing.id}: ${existing.name}${driverSuffix}) for this schedule.`,
      };
    }
  } else if (routeName) {
    for (const existing of openRoutes) {
      if (normalizeText(existing.name).toLowerCase() === routeName) {
        return {
          code: "DUPLICATE_ROUTE_NAME",
          existingRouteId: String(existing.id),
          existingRouteName: existing.name,
          existingStatus: existing.status,
          message: `An open route named "${existing.name}" (#${existing.id}) already exists.`,
        };
      }
    }
  }

  const candidateDriverId = String(candidate.driverId ?? "");
  if (candidateDriverId) {
    for (const existing of openRoutes) {
      if (String(existing.driver_id ?? "") !== candidateDriverId) continue;
      const existingStatus = normalizeRouteStatus(existing.status);
      if (existingStatus !== "active" && !schedulesOverlap(existing.scheduled_days, existing.name, candidateDays)) {
        continue;
      }
      return {
        code: "DRIVER_CONFLICT",
        existingRouteId: String(existing.id),
        existingRouteName: existing.name,
        existingStatus: existing.status,
        message: `Driver ${candidate.driverName || `#${candidateDriverId}`} already has a ${existingStatus} route (#${existing.id}: ${existing.name}). Complete, cancel, or reassign it before creating another.`,
      };
    }
  }

  const candidateVehicleId = candidate.vehicleId != null ? String(candidate.vehicleId) : "";
  if (candidateVehicleId) {
    for (const existing of openRoutes) {
      if (String(existing.vehicle_id ?? "") !== candidateVehicleId) continue;
      const existingStatus = normalizeRouteStatus(existing.status);
      if (existingStatus !== "active" && !schedulesOverlap(existing.scheduled_days, existing.name, candidateDays)) {
        continue;
      }
      return {
        code: "VEHICLE_CONFLICT",
        existingRouteId: String(existing.id),
        existingRouteName: existing.name,
        existingStatus: existing.status,
        message: `Truck ${candidate.vehicleLabel || `#${candidateVehicleId}`} already has a ${existingStatus} route (#${existing.id}: ${existing.name}).`,
      };
    }
  }

  return null;
}

function isMissingRpcError(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    (msg.includes("create_route_assignment") && (msg.includes("could not find") || msg.includes("does not exist")))
  );
}

function isMissingRequestKeyColumnError(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  return (code === "42703" || code === "PGRST204") && msg.includes("request_key");
}

function isTimeoutError(err: any): boolean {
  const msg = String(err?.message ?? "").toLowerCase();
  return err?.name === "AbortError" || msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
          err.name = "AbortError";
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function verifyExistingRouteByRequestKey(
  client: any,
  requestKey: string,
): Promise<{ id: string; name: string; vehicle_id?: number | null } | null> {
  const trimmed = normalizeText(requestKey);
  if (!trimmed) return null;
  try {
    const { data, error } = await client
      .from("routes")
      .select("id, name, vehicle_id")
      .eq("request_key", trimmed)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: String(data.id),
      name: String(data.name ?? ""),
      vehicle_id: data.vehicle_id ?? null,
    };
  } catch {
    return null;
  }
}

async function createRouteFallback(
  client: any,
  input: CreateRouteAssignmentInput,
  orderedBinIds: number[],
): Promise<CreateRouteAssignmentOutcome> {
  const existingByKey = await verifyExistingRouteByRequestKey(client, input.requestKey);
  if (existingByKey) {
    return {
      ok: true,
      idempotent: true,
      routeId: existingByKey.id,
      vehicleId: existingByKey.vehicle_id ?? input.vehicleId ?? null,
    };
  }

  const { data: openRows, error: conflictQueryError } = await client
    .from("routes")
    .select("id, name, status, area_code, scheduled_days, shift_label, driver_id, vehicle_id")
    .in("status", [...OPEN_ROUTE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(200);
  if (conflictQueryError) {
    return { ok: false, error: conflictQueryError.message || "Unable to verify existing active routes." };
  }

  let resolvedVehicleId: number | null =
    input.vehicleId != null && Number.isFinite(Number(input.vehicleId)) ? Number(input.vehicleId) : null;
  if (resolvedVehicleId == null) {
    const { data: driverVehicle } = await client
      .from("vehicles")
      .select("id")
      .eq("driver_id", String(input.driverId))
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (driverVehicle?.id != null && Number.isFinite(Number(driverVehicle.id))) {
      resolvedVehicleId = Number(driverVehicle.id);
    }
  }

  const conflict = findRouteAssignmentConflict((openRows ?? []) as ExistingOpenRouteCandidate[], {
    name: input.name,
    areaCode: input.areaCode,
    scheduledDays: input.scheduledDays,
    shiftLabel: input.shiftLabel,
    driverId: input.driverId,
    driverName: input.driverName,
    vehicleId: resolvedVehicleId,
    vehicleLabel: input.vehicleLabel,
  });
  if (conflict) {
    return {
      ok: false,
      conflict: true,
      code: conflict.code,
      existingRouteId: conflict.existingRouteId,
      error: conflict.message,
    };
  }

  const nowIso = new Date().toISOString();
  const baseInsertPayload: Record<string, any> = {
    request_key: input.requestKey,
    name: input.name.trim(),
    status: input.status ?? "pending",
    area_code: normalizeText(input.areaCode).toUpperCase() || null,
    scheduled_days: input.scheduledDays && input.scheduledDays.length > 0 ? input.scheduledDays : null,
    shift_label: normalizeText(input.shiftLabel) || null,
    waste_category: normalizeText(input.wasteCategory) || null,
    distance_km: input.distanceKm,
    duration_minutes: Math.max(1, Math.round(input.durationMinutes || 1)),
    driver_id: input.driverId,
    vehicle_id: resolvedVehicleId,
    center_lat: input.centerLat,
    center_lng: input.centerLng,
    generated_at: nowIso,
    assignment_updated_at: nowIso,
    optimization_method: input.optimizationMethod ?? "mapbox-directions",
    cost_source: input.costSource ?? "mapbox-directions",
    used_mapbox_traffic: Boolean(input.usedMapboxTraffic),
  };

  let insertedRoute: any = null;
  let insertErr: any = null;
  ({ data: insertedRoute, error: insertErr } = await client
    .from("routes")
    .insert(baseInsertPayload)
    .select("id")
    .single());

  if (insertErr && isMissingRequestKeyColumnError(insertErr)) {
    const { request_key: _omitted, ...legacyPayload } = baseInsertPayload;
    ({ data: insertedRoute, error: insertErr } = await client
      .from("routes")
      .insert(legacyPayload)
      .select("id")
      .single());
  }

  if (insertErr || !insertedRoute?.id) {
    if (String(insertErr?.code) === "23505") {
      const recovered = await verifyExistingRouteByRequestKey(client, input.requestKey);
      if (recovered) {
        return { ok: true, idempotent: true, routeId: recovered.id, vehicleId: recovered.vehicle_id ?? resolvedVehicleId };
      }
    }
    return {
      ok: false,
      error: insertErr?.message || "Could not create route record.",
    };
  }

  const routeId = insertedRoute.id;
  const routeKey = String(routeId);

  try {
    const stopsPayload = orderedBinIds.map((binId, idx) => ({
      route_id: routeId,
      bin_id: binId,
      stop_order: idx + 1,
    }));
    const deliveriesPayload = orderedBinIds.map((binId) => ({
      route_id: routeId,
      bin_id: binId,
      driver_id: input.driverId,
      status: "assigned",
      eta: null,
    }));

    const parallelOps: Promise<any>[] = [
      client.from("route_stops").insert(stopsPayload),
      client.from("deliveries").insert(deliveriesPayload),
    ];
    if (resolvedVehicleId != null) {
      parallelOps.push(
        client
          .from("vehicles")
          .update({ route_id: routeKey, driver_id: String(input.driverId) })
          .eq("id", resolvedVehicleId),
        client
          .from("drivers")
          .update({ assigned_vehicle_id: resolvedVehicleId })
          .eq("id", input.driverId),
      );
    }

    const results = await Promise.all(parallelOps);
    for (const res of results) {
      if (res?.error) throw res.error;
    }

    if (input.driverAuthUserId) {
      try {
        await client.from("notifications").insert({
          user_auth_id: input.driverAuthUserId,
          user_id: input.driverAuthUserId,
          role: "truck_driver",
          title: "New Route Assigned",
          message: `Route "${input.name.trim()}" has ${stopsPayload.length} stop${stopsPayload.length === 1 ? "" : "s"} (Pending). Open EcoLoop to accept it when ready.`,
          type: "info",
          category: "route",
          route_id: routeId,
          source_table: "routes",
          source_id: routeKey,
          read: false,
          created_at: nowIso,
        });
      } catch {
        // Non-fatal: route assignment itself already succeeded
      }
    }

    return { ok: true, idempotent: false, routeId: routeKey, vehicleId: resolvedVehicleId };
  } catch (err: any) {
    // Roll back partial route creation so no orphan route/vehicle binding remains
    if (resolvedVehicleId != null) {
      await client.from("vehicles").update({ route_id: null }).eq("id", resolvedVehicleId).eq("route_id", routeKey);
    }
    await client.from("routes").delete().eq("id", routeId);
    return {
      ok: false,
      error: err?.message || "Failed to save route stops cleanly. Partial route creation was rolled back.",
    };
  }
}

/**
 * Atomically creates a route and its stops/deliveries/vehicle link via `create_route_assignment` RPC,
 * with automatic timeout recovery and rollback-safe fallback if the RPC migration is not yet deployed.
 */
export async function createRouteAssignment(
  input: CreateRouteAssignmentInput,
  client: any = supabase,
  timeoutMs: number = DEFAULT_CREATION_TIMEOUT_MS,
): Promise<CreateRouteAssignmentOutcome> {
  const orderedBinIds: number[] = [];
  const seen = new Set<string>();
  for (const rawId of input.binIds) {
    const key = String(rawId);
    const num = Number(rawId);
    if (!seen.has(key) && Number.isFinite(num)) {
      seen.add(key);
      orderedBinIds.push(num);
    }
  }
  if (orderedBinIds.length === 0) {
    return { ok: false, code: "INVALID_INPUT", error: "Select at least one live bin for this route." };
  }

  const numericDriverId = Number(input.driverId);
  const numericVehicleId =
    input.vehicleId != null && Number.isFinite(Number(input.vehicleId)) ? Number(input.vehicleId) : null;

  try {
    const rpcCall = client.rpc("create_route_assignment", {
      p_request_key: input.requestKey,
      p_name: input.name.trim(),
      p_status: input.status ?? "pending",
      p_area_code: normalizeText(input.areaCode).toUpperCase() || null,
      p_scheduled_days: input.scheduledDays && input.scheduledDays.length > 0 ? input.scheduledDays : null,
      p_shift_label: normalizeText(input.shiftLabel) || null,
      p_waste_category: normalizeText(input.wasteCategory) || null,
      p_distance_km: input.distanceKm,
      p_duration_minutes: Math.max(1, Math.round(input.durationMinutes || 1)),
      p_driver_id: Number.isFinite(numericDriverId) ? numericDriverId : input.driverId,
      p_vehicle_id: numericVehicleId,
      p_center_lat: input.centerLat,
      p_center_lng: input.centerLng,
      p_optimization_method: input.optimizationMethod ?? "mapbox-directions",
      p_cost_source: input.costSource ?? "mapbox-directions",
      p_used_mapbox_traffic: Boolean(input.usedMapboxTraffic),
      p_bin_ids: orderedBinIds,
    });

    const { data, error } = await withTimeout<any>(rpcCall, timeoutMs, "Route creation");

    if (error) {
      if (isMissingRpcError(error)) {
        return await withTimeout(createRouteFallback(client, input, orderedBinIds), timeoutMs, "Route creation");
      }
      return { ok: false, error: error.message || "Could not create route assignment." };
    }

    if (data && data.success === false) {
      return {
        ok: false,
        conflict: Boolean(data.conflict),
        code: data.code,
        existingRouteId: data.existing_route_id != null ? String(data.existing_route_id) : undefined,
        error: data.message || "Route assignment conflict detected.",
      };
    }

    return {
      ok: true,
      routeId: data?.route_id != null ? String(data.route_id) : undefined,
      vehicleId: data?.vehicle_id ?? numericVehicleId,
      idempotent: Boolean(data?.idempotent),
    };
  } catch (err: any) {
    if (isTimeoutError(err)) {
      const recovered = await verifyExistingRouteByRequestKey(client, input.requestKey);
      if (recovered) {
        return {
          ok: true,
          idempotent: true,
          recoveredFromTimeout: true,
          routeId: recovered.id,
          vehicleId: recovered.vehicle_id ?? numericVehicleId,
        };
      }
      return {
        ok: false,
        timedOut: true,
        error: "The request timed out before confirmation from the server. No duplicate assignment was detected — you can safely try again.",
      };
    }
    return {
      ok: false,
      error: err?.message || "Could not create this route. Please check your selections and try again.",
    };
  }
}
