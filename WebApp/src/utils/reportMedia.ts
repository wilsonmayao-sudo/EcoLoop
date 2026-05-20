import { supabase } from "../services/supabaseClient";

const REPORT_IMAGES_BUCKET = "report-images";

/**
 * Returns a URL suitable for <img src>. Handles full public URLs from mobile
 * and plain storage object paths.
 */
export function resolveReportImageUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  if (/^https?:\/\//i.test(s)) return s;
  const path = s.replace(new RegExp(`^${REPORT_IMAGES_BUCKET}/`), "").replace(/^\//, "");
  if (path === "") return null;
  const { data } = supabase.storage.from(REPORT_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function parseReportCoordinate(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}
