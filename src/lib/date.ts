import { APP_CONFIG } from "./config";

/**
 * Computes the calendar date (as a UTC midnight Date matching PostgreSQL `@db.Date`)
 * for the given IANA timezone.
 */
export function getBusinessDateForTimezone(
  timeZone: string = APP_CONFIG.defaultTimezone,
  now: Date = new Date(),
): Date {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [yearStr, monthStr, dayStr] = formatted.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Unable to derive business date for timezone "${timeZone}"`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}
