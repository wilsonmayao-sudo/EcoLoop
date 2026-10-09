export type ReportPeriod = "today" | "week" | "month" | "custom";

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function getDateRange(period: ReportPeriod, customStart?: string, customEnd?: string): DateRange {
  const now = new Date();

  if (period === "today") {
    return { start: startOfDay(now), end: endOfDay(now), label: "Daily" };
  }

  if (period === "week") {
    const start = startOfDay(now);
    start.setDate(start.getDate() - start.getDay());
    return { start, end: endOfDay(now), label: "Weekly" };
  }

  if (period === "month") {
    const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    return { start, end: endOfDay(now), label: "Monthly" };
  }

  const start = customStart ? startOfDay(new Date(customStart)) : startOfDay(now);
  const end = customEnd ? endOfDay(new Date(customEnd)) : endOfDay(now);
  const safeStart = start.getTime() <= end.getTime() ? start : end;
  const safeEnd = start.getTime() <= end.getTime() ? end : start;
  return {
    start: safeStart,
    end: safeEnd,
    label: "Custom Range",
  };
}

export function isWithinRange(value: string | null | undefined, range: DateRange) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= range.start.getTime() && time <= range.end.getTime();
}

export function formatRangeLabel(range: DateRange) {
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  return `${formatter.format(range.start)} – ${formatter.format(range.end)}`;
}
