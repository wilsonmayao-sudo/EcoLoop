export const SCHEDULE_DAY_CODES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type ScheduleDayCode = (typeof SCHEDULE_DAY_CODES)[number];

export const SCHEDULE_DAY_LABELS: Record<ScheduleDayCode, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

const DAY_ALIAS_MAP: Record<string, ScheduleDayCode> = {
  mon: "Mon",
  monday: "Mon",
  tue: "Tue",
  tues: "Tue",
  tuesday: "Tue",
  wed: "Wed",
  wednesday: "Wed",
  thu: "Thu",
  thur: "Thu",
  thurs: "Thu",
  thursday: "Thu",
  fri: "Fri",
  friday: "Fri",
  sat: "Sat",
  saturday: "Sat",
  sun: "Sun",
  sunday: "Sun",
};

const DAILY_TOKENS = new Set([
  "daily",
  "everyday",
  "every day",
  "all days",
  "all_days",
  "mon-sun",
  "monday-sunday",
  "7 days",
]);

function expandDayToken(raw: string): Array<ScheduleDayCode | "DAILY"> {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return [];
  if (DAILY_TOKENS.has(normalized) || normalized === "all") {
    return ["DAILY"];
  }

  const direct = DAY_ALIAS_MAP[normalized];
  if (direct) return [direct];

  // Handle ranges such as "Mon-Fri" or "Mon - Sun"
  const rangeParts = normalized.split(/\s*[-–to]+\s*/).filter(Boolean);
  if (rangeParts.length === 2) {
    const startDay = DAY_ALIAS_MAP[rangeParts[0]];
    const endDay = DAY_ALIAS_MAP[rangeParts[1]];
    if (startDay && endDay) {
      const startIndex = SCHEDULE_DAY_CODES.indexOf(startDay);
      const endIndex = SCHEDULE_DAY_CODES.indexOf(endDay);
      if (startIndex <= endIndex) {
        return SCHEDULE_DAY_CODES.slice(startIndex, endIndex + 1);
      }
      return [
        ...SCHEDULE_DAY_CODES.slice(startIndex),
        ...SCHEDULE_DAY_CODES.slice(0, endIndex + 1),
      ];
    }
  }

  return [];
}

/**
 * Extracts canonical weekday codes (Mon..Sun) from stored schedule day arrays,
 * expanding "Daily" / all-day tokens to all seven days.
 */
export function extractNormalizedScheduleDays(days: string[] | null | undefined): ScheduleDayCode[] {
  if (!days || days.length === 0) return [];
  const matched = new Set<ScheduleDayCode>();

  for (const entry of days) {
    if (!entry) continue;
    const parts = entry.split(/[,/]+/);
    for (const part of parts) {
      for (const token of expandDayToken(part)) {
        if (token === "DAILY") {
          return [...SCHEDULE_DAY_CODES];
        }
        matched.add(token);
      }
    }
  }

  return SCHEDULE_DAY_CODES.filter((day) => matched.has(day));
}

/**
 * Returns true if the schedule array represents a Daily collection schedule.
 */
export function isDailySchedule(days: string[] | null | undefined): boolean {
  return extractNormalizedScheduleDays(days).length === SCHEDULE_DAY_CODES.length;
}

/**
 * Formats a schedule day array concisely ("Daily" when all 7 days are covered).
 */
export function formatScheduleDaysLabel(days: string[] | null | undefined): string {
  const normalized = extractNormalizedScheduleDays(days);
  if (normalized.length === 0) return "—";
  if (normalized.length === SCHEDULE_DAY_CODES.length) return "Daily";
  return normalized.join(", ");
}

/**
 * Normalizes a day filter value into a canonical ScheduleDayCode ("Mon".."Sun") or "ALL".
 */
export function normalizeScheduleDayFilter(selectedDay?: string | null): ScheduleDayCode | "ALL" {
  const normalized = String(selectedDay ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all" || normalized === "all days" || normalized === "any") {
    return "ALL";
  }
  return DAY_ALIAS_MAP[normalized] ?? "ALL";
}

/**
 * Returns true if a single schedule's day list matches the selected day filter.
 * Matches when filter is "ALL", when the schedule is Daily, or when it includes the selected day.
 */
export function doesScheduleMatchDay(
  days: string[] | null | undefined,
  selectedDay: string,
): boolean {
  const targetDay = normalizeScheduleDayFilter(selectedDay);
  if (targetDay === "ALL") {
    return true;
  }

  const scheduleDays = extractNormalizedScheduleDays(days);
  return scheduleDays.length === SCHEDULE_DAY_CODES.length || scheduleDays.includes(targetDay);
}

/**
 * Returns true if an area matches the selected day filter based on its active collection schedules.
 * Handles multiple schedules per area (deduplicated) and treats "ALL" as unfiltered.
 */
export function doesAreaMatchScheduleDay(
  schedules: Array<{ days_of_week?: string[] | null; is_active?: boolean | null }>,
  selectedDay: string,
): boolean {
  if (normalizeScheduleDayFilter(selectedDay) === "ALL") {
    return true;
  }

  return schedules.some(
    (schedule) =>
      schedule.is_active !== false && doesScheduleMatchDay(schedule.days_of_week, selectedDay),
  );
}

/**
 * Extracts effective normalized schedule days for a bin by combining its own schedule_days
 * with any active collection_schedules rows directly linked to that bin_id.
 */
export function getEffectiveBinScheduleDays(
  bin: {
    id?: string | number | null;
    schedule_days?: string[] | null;
    scheduleDays?: string[] | null;
    area_code?: string | null;
    areaCode?: string | null;
  },
  collectionSchedules?: Array<{
    bin_id?: string | number | null;
    area_code?: string | null;
    days_of_week?: string[] | null;
    is_active?: boolean | null;
  }> | null,
): ScheduleDayCode[] {
  const rawDays: string[] = [];
  const binOwnDays = bin.schedule_days ?? bin.scheduleDays;
  if (Array.isArray(binOwnDays)) {
    rawDays.push(...binOwnDays);
  }

  const binIdStr = bin.id != null ? String(bin.id) : "";
  if (binIdStr && Array.isArray(collectionSchedules)) {
    for (const row of collectionSchedules) {
      if (row.is_active === false) continue;
      if (row.bin_id != null && String(row.bin_id) === binIdStr && Array.isArray(row.days_of_week)) {
        rawDays.push(...row.days_of_week);
      }
    }
  }

  return extractNormalizedScheduleDays(rawDays);
}

/**
 * Returns true if a bin is scheduled for collection on the selected day.
 */
export function doesBinMatchScheduleDay(
  bin: {
    id?: string | number | null;
    schedule_days?: string[] | null;
    scheduleDays?: string[] | null;
    area_code?: string | null;
    areaCode?: string | null;
  },
  selectedDay: string,
  collectionSchedules?: Array<{
    bin_id?: string | number | null;
    area_code?: string | null;
    days_of_week?: string[] | null;
    is_active?: boolean | null;
  }> | null,
): boolean {
  const targetDay = normalizeScheduleDayFilter(selectedDay);
  if (targetDay === "ALL") {
    return true;
  }

  const effectiveDays = getEffectiveBinScheduleDays(bin, collectionSchedules);
  if (effectiveDays.length > 0) {
    return effectiveDays.length === SCHEDULE_DAY_CODES.length || effectiveDays.includes(targetDay);
  }

  const areaCode = String(bin.area_code ?? bin.areaCode ?? "").trim().toUpperCase();
  if (areaCode && Array.isArray(collectionSchedules)) {
    const areaSchedules = collectionSchedules.filter(
      (row) => row.is_active !== false && String(row.area_code ?? "").trim().toUpperCase() === areaCode,
    );
    if (areaSchedules.length > 0) {
      return doesAreaMatchScheduleDay(areaSchedules, targetDay);
    }
  }

  return false;
}

/**
 * Extracts explicit schedule day codes from a route's scheduled_days field or embedded "(Day)" tag in its name.
 * Never infers collection day from created_at timestamps.
 */
export function extractRouteScheduleDays(route: {
  scheduled_days?: string[] | null;
  scheduledDays?: string[] | null;
  name?: string | null;
}): ScheduleDayCode[] {
  const explicit = route.scheduled_days ?? route.scheduledDays;
  if (Array.isArray(explicit) && explicit.length > 0) {
    const normalized = extractNormalizedScheduleDays(explicit);
    if (normalized.length > 0) return normalized;
  }

  const routeName = String(route.name ?? "").trim();
  if (routeName) {
    const parenMatches = Array.from(routeName.matchAll(/\(([^)]+)\)/g));
    for (let i = parenMatches.length - 1; i >= 0; i -= 1) {
      const candidate = parenMatches[i][1]?.trim();
      if (!candidate) continue;
      const parsed = extractNormalizedScheduleDays([candidate]);
      if (parsed.length > 0) {
        return parsed;
      }
    }
  }

  return [];
}

/**
 * Returns true if a route is scheduled for the selected day (or All Days).
 */
export function doesRouteMatchScheduleDay(
  route: {
    scheduled_days?: string[] | null;
    scheduledDays?: string[] | null;
    name?: string | null;
    area_code?: string | null;
    areaCode?: string | null;
  },
  selectedDay: string,
  areaSchedulesByCode?: Map<string, Array<{ days_of_week?: string[] | null; is_active?: boolean | null }>>,
): boolean {
  const targetDay = normalizeScheduleDayFilter(selectedDay);
  if (targetDay === "ALL") {
    return true;
  }

  const routeDays = extractRouteScheduleDays(route);
  if (routeDays.length > 0) {
    return routeDays.length === SCHEDULE_DAY_CODES.length || routeDays.includes(targetDay);
  }

  const areaCode = String(route.area_code ?? route.areaCode ?? "").trim().toUpperCase();
  if (areaCode && areaSchedulesByCode?.has(areaCode)) {
    return doesAreaMatchScheduleDay(areaSchedulesByCode.get(areaCode) ?? [], targetDay);
  }

  return true;
}
