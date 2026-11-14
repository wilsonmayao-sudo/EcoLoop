export const SCHEDULE_DAY_CODES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DAY_ALIAS_MAP = {
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

const UPPERCASE_DESCRIPTORS = new Set(["CBD", "MRF", "SWMO", "AM", "PM"]);

function expandDayToken(raw) {
  const normalized = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return [];
  if (DAILY_TOKENS.has(normalized) || normalized === "all") return ["DAILY"];
  if (DAY_ALIAS_MAP[normalized]) return [DAY_ALIAS_MAP[normalized]];

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

export function extractNormalizedScheduleDays(days) {
  if (!Array.isArray(days) || days.length === 0) return [];
  const matched = new Set();
  for (const entry of days) {
    if (!entry) continue;
    for (const part of String(entry).split(/[,/]+/)) {
      for (const token of expandDayToken(part)) {
        if (token === "DAILY") return [...SCHEDULE_DAY_CODES];
        matched.add(token);
      }
    }
  }
  return SCHEDULE_DAY_CODES.filter((day) => matched.has(day));
}

export function isDailySchedule(days) {
  return extractNormalizedScheduleDays(days).length === SCHEDULE_DAY_CODES.length;
}

export function formatAreaCodeTitle(areaCode) {
  const code = String(areaCode || "").trim();
  if (!code) return "Collection Area";

  const areaMatch = code.match(/^AREA[-\s–—]*(\d+)\s*([A-Za-z]*)$/i);
  if (areaMatch) {
    return `Area ${areaMatch[1]}${areaMatch[2].toUpperCase()}`;
  }

  const upper = code.toUpperCase();
  if (upper === "COMPACTOR") return "Compactor Truck Route";
  if (upper === "FLEET-CLEARING" || upper === "FLEET CLEARING") return "Fleet Clearing";

  return code.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDescriptorCasing(text) {
  return text.replace(/\(([A-Z\s/&-]{3,})\)/g, (_full, inner) => {
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

function normalizeDedupKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function cleanCollectionAreaTitle(areaCode, rawAreaName) {
  const canonicalBase = String(areaCode || "").trim() ? formatAreaCodeTitle(areaCode) : "";
  const raw = String(rawAreaName || "").trim();
  if (!raw) return canonicalBase || "Collection Area";

  let cleaned = raw
    .replace(/\(\s*daily\s*\)/gi, " ")
    .replace(/(?:^|[\s\-–—:,•])\bdaily\b(?=$|[\s\-–—:,•])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const dashSegments = cleaned
    .split(/\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (dashSegments.length > 1) {
    const seenKeys = new Set();
    const uniqueSegments = [];
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

  let remainder = cleaned;
  const codePattern = areaCode
    ? String(areaCode).trim().replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/\\-/g, "[-\\s–—]*")
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
  if (normalizeDedupKey(remainder) === normalizeDedupKey(canonicalBase)) return canonicalBase;
  if (remainder.startsWith("(")) return `${canonicalBase} ${remainder}`;
  return `${canonicalBase} — ${remainder}`;
}

export function formatAreaScheduleLabel(schedules) {
  if (!Array.isArray(schedules) || schedules.length === 0) return "";
  const activeRows = schedules.filter((row) => row?.is_active !== false);
  const rows = activeRows.length > 0 ? activeRows : schedules;

  if (rows.some((row) => isDailySchedule(row?.days_of_week))) {
    return "Daily";
  }

  const unionDays = new Set();
  const patternSets = [];

  for (const row of rows) {
    const days = extractNormalizedScheduleDays(row?.days_of_week);
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

export function formatCollectionAreaDisplay(areaCode, rawAreaName, schedules = []) {
  const title = cleanCollectionAreaTitle(areaCode, rawAreaName);
  const scheduleLabel = formatAreaScheduleLabel(schedules);
  return scheduleLabel ? `${title} • ${scheduleLabel}` : title;
}

export function normalizeScheduleDayFilter(selectedDay) {
  const normalized = String(selectedDay ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all" || normalized === "all days" || normalized === "any") {
    return "ALL";
  }
  return DAY_ALIAS_MAP[normalized] ?? "ALL";
}

export function doesScheduleMatchDay(days, selectedDay) {
  const targetDay = normalizeScheduleDayFilter(selectedDay);
  if (targetDay === "ALL") return true;

  const scheduleDays = extractNormalizedScheduleDays(days);
  return scheduleDays.length === SCHEDULE_DAY_CODES.length || scheduleDays.includes(targetDay);
}

export function doesAreaMatchScheduleDay(schedules, selectedDay) {
  if (normalizeScheduleDayFilter(selectedDay) === "ALL") return true;
  if (!Array.isArray(schedules)) return false;

  return schedules.some(
    (schedule) =>
      schedule?.is_active !== false && doesScheduleMatchDay(schedule?.days_of_week, selectedDay),
  );
}

export function extractRouteScheduleDays(route) {
  if (!route) return [];
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
      if (parsed.length > 0) return parsed;
    }
  }

  return [];
}
