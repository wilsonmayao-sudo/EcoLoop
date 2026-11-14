export type ReportPeriod = "today" | "week" | "month" | "custom";

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export const MANILA_TIMEZONE = "Asia/Manila";

function getManilaYmd(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function manilaStartOfDay(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000+08:00`);
}

function manilaEndOfDay(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+08:00`);
}

function parseInputYmd(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return getManilaYmd(parsed);
}

export function getDateRange(period: ReportPeriod, customStart?: string, customEnd?: string): DateRange {
  const now = new Date();
  const todayYmd = getManilaYmd(now);

  if (period === "today") {
    return {
      start: manilaStartOfDay(todayYmd),
      end: manilaEndOfDay(todayYmd),
      label: "Daily",
    };
  }

  if (period === "week") {
    const todayMidday = new Date(`${todayYmd}T12:00:00.000+08:00`);
    const dayOfWeek = todayMidday.getUTCDay();
    const startMidday = new Date(todayMidday.getTime() - dayOfWeek * 86400000);
    return {
      start: manilaStartOfDay(getManilaYmd(startMidday)),
      end: manilaEndOfDay(todayYmd),
      label: "Weekly",
    };
  }

  if (period === "month") {
    const monthStartYmd = `${todayYmd.slice(0, 7)}-01`;
    return {
      start: manilaStartOfDay(monthStartYmd),
      end: manilaEndOfDay(todayYmd),
      label: "Monthly",
    };
  }

  const startYmd = parseInputYmd(customStart) ?? todayYmd;
  const endYmd = parseInputYmd(customEnd) ?? todayYmd;
  const start = manilaStartOfDay(startYmd);
  const end = manilaEndOfDay(endYmd);
  const ordered = start.getTime() <= end.getTime();
  return {
    start: ordered ? start : manilaStartOfDay(endYmd),
    end: ordered ? end : manilaEndOfDay(startYmd),
    label: "Custom Range",
  };
}

export function isWithinRange(value: string | null | undefined, range: DateRange) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  return time >= range.start.getTime() && time <= range.end.getTime();
}

export function formatRangeLabel(range: DateRange) {
  const formatter = new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  return `${formatter.format(range.start)} - ${formatter.format(range.end)}`;
}

export function formatPhilippineDate(value?: string | Date | null, fallback = "Not Available"): string {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export function formatPhilippineDateTime(value?: string | Date | null, fallback = "Not Available"): string {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const formatted = new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${formatted} PHT`;
}
