export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Formats integer paise to INR currency string (e.g., 25000 -> "₹250", 25050 -> "₹250.50").
 */
export function formatPaiseToInr(paise: number): string {
  const safePaise = Number.isFinite(paise) ? Math.max(0, Math.round(paise)) : 0;
  const rupees = safePaise / 100;
  const hasDecimals = safePaise % 100 !== 0;

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(rupees);
}

/**
 * Formats duration minutes cleanly for compact cards and badges.
 */
export function formatDurationMinutes(minutes: number): string {
  const safeMins = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  if (safeMins < 60) {
    return `${safeMins} mins`;
  }

  const hours = Math.floor(safeMins / 60);
  const rem = safeMins % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}
