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
 * Returns true if a single schedule's day list matches the selected day filter.
 * Matches when filter is "ALL", when the schedule is Daily, or when it includes the selected day.
 */
export function doesScheduleMatchDay(
  days: string[] | null | undefined,
  selectedDay: string,
): boolean {
  const normalizedFilter = selectedDay.trim().toLowerCase();
  if (!normalizedFilter || normalizedFilter === "all" || normalizedFilter === "all days") {
    return true;
  }

  const targetDay = DAY_ALIAS_MAP[normalizedFilter];
  if (!targetDay) return false;

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
  const normalizedFilter = selectedDay.trim().toLowerCase();
  if (!normalizedFilter || normalizedFilter === "all" || normalizedFilter === "all days") {
    return true;
  }

  return schedules.some(
    (schedule) =>
      schedule.is_active !== false && doesScheduleMatchDay(schedule.days_of_week, selectedDay),
  );
}
