import { APP_CONFIG } from "./config";

const SHORT_WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface BranchLocalTimeInfo {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hhMm: string;
}

export function getBranchLocalTimeInfo(
  timeZone: string = APP_CONFIG.defaultTimezone,
  now: Date = new Date(),
): BranchLocalTimeInfo {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const partMap = new Map<string, string>();
  for (const part of parts) {
    partMap.set(part.type, part.value);
  }

  const year = Number(partMap.get("year"));
  const month = Number(partMap.get("month"));
  const day = Number(partMap.get("day"));
  const weekdayStr = partMap.get("weekday") ?? "";
  const dayOfWeek = SHORT_WEEKDAY_TO_INDEX[weekdayStr];
  const rawHour = partMap.get("hour") ?? "00";
  const hour = rawHour === "24" ? "00" : rawHour.padStart(2, "0");
  const minute = (partMap.get("minute") ?? "00").padStart(2, "0");

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    dayOfWeek === undefined
  ) {
    throw new Error(`Unable to derive local time info for timezone "${timeZone}"`);
  }

  return {
    year,
    month,
    day,
    dayOfWeek,
    hhMm: `${hour}:${minute}`,
  };
}

/**
 * Computes the calendar business date (as a UTC midnight Date matching PostgreSQL `@db.Date`)
 * in the branch's IANA timezone, honoring optional `dayResetTime` (e.g., `"04:00"`).
 */
export function getBusinessDateForTimezone(
  timeZone: string = APP_CONFIG.defaultTimezone,
  now: Date = new Date(),
  dayResetTime: string = APP_CONFIG.defaultDayResetTime,
): Date {
  const local = getBranchLocalTimeInfo(timeZone, now);
  const shiftBackDay = dayResetTime !== "00:00" && local.hhMm < dayResetTime ? 1 : 0;

  return new Date(Date.UTC(local.year, local.month - 1, local.day - shiftBackDay));
}

export interface BusinessHoursWindow {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  breakStartTime?: string | null;
  breakEndTime?: string | null;
}

/**
 * Evaluates whether `currentHhMm` (`"HH:MM"`) falls inside the branch's open
 * window (and outside any configured break window).
 */
export function isWithinBusinessHours(
  hours: BusinessHoursWindow | undefined,
  currentHhMm: string,
): boolean {
  if (!hours || !hours.isOpen) {
    return false;
  }

  const inMainWindow =
    hours.openTime <= hours.closeTime
      ? currentHhMm >= hours.openTime && currentHhMm < hours.closeTime
      : currentHhMm >= hours.openTime || currentHhMm < hours.closeTime;

  if (!inMainWindow) {
    return false;
  }

  if (hours.breakStartTime && hours.breakEndTime) {
    const inBreak =
      currentHhMm >= hours.breakStartTime && currentHhMm < hours.breakEndTime;
    if (inBreak) {
      return false;
    }
  }

  return true;
}
