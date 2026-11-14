/**
 * Helpers for PostgREST queries that include optional columns from newer SQL migrations
 * (e.g. `vehicles.load_percent` and `overflow_events.reassignment_metadata`) so the mobile
 * app remains functional if the Supabase schema cache has not yet been updated.
 */

export function normalizeNonEmptyId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  return trimmed;
}

export function isInvalidEnumError(error, enumValue) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const details = String(error.details ?? "").toLowerCase();
  const combined = `${msg} ${details}`;

  const isEnumFailure = code === "22P02" || combined.includes("invalid input value for enum");
  if (!isEnumFailure) return false;
  if (!enumValue) return true;
  return combined.includes(String(enumValue).toLowerCase());
}

export function isMissingRpcError(error) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const details = String(error.details ?? "").toLowerCase();
  const combined = `${msg} ${details}`;

  return (
    code === "PGRST202" ||
    code === "42883" ||
    combined.includes("could not find the function") ||
    (combined.includes("function") && combined.includes("does not exist"))
  );
}

export function isMissingColumnSchemaError(error, columnName) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const details = String(error.details ?? "").toLowerCase();
  const combined = `${msg} ${details}`;

  const isColumnNotFound =
    code === "PGRST204" ||
    code === "42703" ||
    combined.includes("schema cache") ||
    combined.includes("does not exist") ||
    combined.includes("could not find the");

  if (!isColumnNotFound) return false;
  if (!columnName) return true;
  return combined.includes(String(columnName).toLowerCase());
}

export async function updateVehicleWithFallback(supabaseClient, vehicleId, payload) {
  const res = await supabaseClient.from("vehicles").update(payload).eq("id", vehicleId);
  if (
    res?.error &&
    Object.prototype.hasOwnProperty.call(payload, "load_percent") &&
    isMissingColumnSchemaError(res.error, "load_percent")
  ) {
    const { load_percent: _ignored, ...rest } = payload;
    if (Object.keys(rest).length === 0) {
      return { data: null, error: null, omittedColumns: ["load_percent"] };
    }
    const retry = await supabaseClient.from("vehicles").update(rest).eq("id", vehicleId);
    return { ...retry, omittedColumns: ["load_percent"] };
  }
  return res;
}

export async function selectCandidateVehiclesWithFallback(supabaseClient, vehicleIds) {
  if (!Array.isArray(vehicleIds) || vehicleIds.length === 0) {
    return { data: [], error: null };
  }
  const res = await supabaseClient
    .from("vehicles")
    .select("id, label, load_percent, status")
    .in("id", vehicleIds);
  if (res?.error && isMissingColumnSchemaError(res.error, "load_percent")) {
    return supabaseClient
      .from("vehicles")
      .select("id, label, status")
      .in("id", vehicleIds);
  }
  return res;
}

export async function insertOverflowEventWithFallback(supabaseClient, eventPayload) {
  const res = await supabaseClient.from("overflow_events").insert(eventPayload);
  if (
    res?.error &&
    Object.prototype.hasOwnProperty.call(eventPayload, "reassignment_metadata") &&
    isMissingColumnSchemaError(res.error, "reassignment_metadata")
  ) {
    const { reassignment_metadata: _ignored, ...rest } = eventPayload;
    return supabaseClient.from("overflow_events").insert(rest);
  }
  return res;
}

export async function updateDriverStatusWithFallback(
  supabaseClient,
  driverId,
  preferredStatus,
  fallbackStatus = "on_route",
) {
  const res = await supabaseClient.from("drivers").update({ status: preferredStatus }).eq("id", driverId);
  if (res?.error && fallbackStatus && isInvalidEnumError(res.error, preferredStatus)) {
    const retry = await supabaseClient.from("drivers").update({ status: fallbackStatus }).eq("id", driverId);
    return { ...retry, fallbackStatusUsed: fallbackStatus };
  }
  return res;
}

export async function updateDeliveriesStatusWithFallback(supabaseClient, deliveryIds, preferredStatus) {
  if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
    return { data: null, error: null };
  }
  const res = await supabaseClient.from("deliveries").update({ status: preferredStatus }).in("id", deliveryIds);
  if (res?.error && isInvalidEnumError(res.error, preferredStatus)) {
    // Keep existing valid delivery_status when older DB schema lacks overflow_uncollected enum value.
    return { data: null, error: null, omittedStatus: preferredStatus };
  }
  return res;
}

export async function insertNotificationWithFallback(supabaseClient, payload, fallbackCategory = "route") {
  const res = await supabaseClient.from("notifications").insert(payload);
  if (res?.error && payload?.category && isInvalidEnumError(res.error, payload.category)) {
    return supabaseClient.from("notifications").insert({ ...payload, category: fallbackCategory });
  }
  return res;
}
