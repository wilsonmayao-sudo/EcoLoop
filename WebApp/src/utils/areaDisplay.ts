import {
  SCHEDULE_DAY_CODES,
  extractNormalizedScheduleDays,
  isDailySchedule,
  type ScheduleDayCode,
} from "./scheduleDays";

export interface ScheduleDayRowLike {
  days_of_week?: string[] | null;
  is_active?: boolean | null;
}

const UPPERCASE_DESCRIPTORS = new Set(["CBD", "MRF", "SWMO", "AM", "PM"]);

export function formatAreaCodeTitle(areaCode?: string | null): string {
  const code = (areaCode ?? "").trim();
  if (!code) return "Collection Area";

  const areaMatch = code.match(/^AREA[-\s–—]*(\d+)\s*([A-Za-z]*)$/i);
  if (areaMatch) {
    return `Area ${areaMatch[1]}${areaMatch[2].toUpperCase()}`;
  }

  const upper = code.toUpperCase();
  if (upper === "COMPACTOR") return "Compactor Truck Route";
  if (upper === "FLEET-CLEARING" || upper === "FLEET CLEARING") return "Fleet Clearing";

  return code
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDescriptorCasing(text: string): string {
  return text.replace(/\(([A-Z\s/&-]{3,})\)/g, (_full, inner: string) => {
    const formatted = inner
      .trim()
      .toLowerCase()
      .replace(/\b([a-z]+)/g, (word) => {
        const up = word.toUpperCase();
        return UPPERCASE_DESCRIPTORS.has(up) ? up : word.charAt(0).toUpperCase() + word.slice(1);
      });
    return `(${formatted})`;
  });
}

function normalizeDedupKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Produces a clean collection area display title without duplicating area names
 * or stale embedded "(Daily)" markers while keeping database values untouched.
 */
export function cleanCollectionAreaTitle(
  areaCode?: string | null,
  rawAreaName?: string | null,
): string {
  const canonicalBase = areaCode?.trim() ? formatAreaCodeTitle(areaCode) : "";
  const raw = (rawAreaName ?? "").trim();
  if (!raw) return canonicalBase || "Collection Area";

  // Remove embedded Daily tokens from the title; schedule cadence is derived from live schedule records.
  let cleaned = raw
    .replace(/\(\s*daily\s*\)/gi, " ")
    .replace(/(?:^|[\s\-–—:,•])\bdaily\b(?=$|[\s\-–—:,•])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Deduplicate repeated dash-separated segments such as "Area 1 - Area 1".
  const dashSegments = cleaned
    .split(/\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (dashSegments.length > 1) {
    const seenKeys = new Set<string>();
    const uniqueSegments: string[] = [];
    for (const seg of dashSegments) {
      const key = normalizeDedupKey(seg);
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      uniqueSegments.push(seg);
    }
    cleaned = uniqueSegments.join(" — ");
  }

  if (!canonicalBase) {
    return normalizeDescriptorCasing(cleaned.replace(/^[-–—:\s]+|[-–—:\s]+$/g, ""));
  }

  // Strip repeated canonical prefixes from the start of the raw area name.
  let remainder = cleaned;
  const codePattern = areaCode
    ? areaCode.trim().replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/\\-/g, "[-\\s–—]*")
    : "";
  const canonicalPattern = canonicalBase
    .replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
    .replace(/^Area\s+(\d+)([A-Z]*)$/i, "Area\\s*[-–—]?\\s*$1\\s*$2");

  const prefixRegex = new RegExp(
    `^(?:${[canonicalPattern, codePattern].filter(Boolean).join("|")})(?:\\s*[-–—:,]+\\s*|\\s+|$)`,
    "i",
  );

  let guard = 0;
  while (guard < 4 && prefixRegex.test(remainder)) {
    const next = remainder.replace(prefixRegex, "").trim();
    if (next === remainder) break;
    remainder = next;
    guard += 1;
  }

  remainder = normalizeDescriptorCasing(remainder.replace(/^[-–—:\s]+|[-–—:\s]+$/g, ""));
  if (!remainder) return canonicalBase;

  if (normalizeDedupKey(remainder) === normalizeDedupKey(canonicalBase)) {
    return canonicalBase;
  }

  // Handle descriptive titles like "Area 13 (6-10:00 p.m...) All Mainline Only"
  if (remainder.startsWith("(")) {
    return `${canonicalBase} ${remainder}`;
  }
  return `${canonicalBase} — ${remainder}`;
}

/**
 * Formats the area's collection cadence strictly from actual schedule rows.
 * Outputs "Daily" only when an active schedule row confirms daily collection.
 */
export function formatAreaScheduleLabel(schedules: ScheduleDayRowLike[]): string {
  if (!schedules || schedules.length === 0) return "";

  const activeRows = schedules.filter((row) => row.is_active !== false);
  const rows = activeRows.length > 0 ? activeRows : schedules;

  if (rows.some((row) => isDailySchedule(row.days_of_week))) {
    return "Daily";
  }

  const unionDays = new Set<ScheduleDayCode>();
  const patternSets: Set<ScheduleDayCode>[] = [];

  for (const row of rows) {
    const days = extractNormalizedScheduleDays(row.days_of_week);
    if (days.length === 0) continue;
    days.forEach((d) => unionDays.add(d));
    const key = days.join(",");
    if (!patternSets.some((set) => SCHEDULE_DAY_CODES.filter((d) => set.has(d)).join(",") === key)) {
      patternSets.push(new Set(days));
    }
  }

  if (unionDays.size === 0) return "";

  if (unionDays.size < SCHEDULE_DAY_CODES.length) {
    return SCHEDULE_DAY_CODES.filter((day) => unionDays.has(day)).join(", ");
  }

  // Distinct subdivision rows collectively touch all 7 days without any Daily schedule:
  // remove strict subsets (e.g. "Tue, Wed" covered by "Tue, Thu, Sat" / "Mon, Wed, Fri, Sun") when clearer.
  const maximalPatterns = patternSets.filter(
    (set, idx) =>
      !patternSets.some(
        (other, otherIdx) =>
          otherIdx !== idx &&
          other.size > set.size &&
          Array.from(set).every((day) => other.has(day)),
      ),
  );

  return maximalPatterns
    .map((set) => SCHEDULE_DAY_CODES.filter((day) => set.has(day)).join(", "))
    .join(" / ");
}

/**
 * Formats a consistent collection area label combining clean title + verified schedule cadence.
 */
export function formatCollectionAreaDisplay(
  areaCode?: string | null,
  rawAreaName?: string | null,
  schedules: ScheduleDayRowLike[] = [],
): string {
  const title = cleanCollectionAreaTitle(areaCode, rawAreaName);
  const scheduleLabel = formatAreaScheduleLabel(schedules);
  return scheduleLabel ? `${title} • ${scheduleLabel}` : title;
}
