/**
 * Helpers for PostgREST queries that include optional columns from newer SQL migrations
 * (e.g. `vehicles.load_percent` and `overflow_events.reassignment_metadata`) so the mobile
 * app remains functional if the Supabase schema cache has not yet been updated.
 */

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
