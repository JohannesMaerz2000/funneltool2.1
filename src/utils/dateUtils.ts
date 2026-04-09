/**
 * Formats a date string, number, or Date object into a localized string.
 * Uses the system/browser locale by default.
 */
export function formatDateTime(date: string | number | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  if (isNaN(d.getTime())) return String(date);

  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Formats a date string, number, or Date object into a localized date-only string.
 */
export function formatDate(date: string | number | Date | null | undefined): string {
  if (!date) return "";
  
  // Handle YYYY-MM-DD strings specifically to avoid timezone shifts
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  }

  const d = typeof date === "string" ? new Date(date) : new Date(date);
  if (isNaN(d.getTime())) return String(date);

  return d.toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

/**
 * Heuristic to detect if a string is a date and format it if so.
 */
export function formatIfDate(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  
  // Basic ISO date detection (YYYY-MM-DD... or YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}(T|\b)/.test(value)) {
    // If it has time info
    if (value.includes("T") || value.includes(":")) {
      return formatDateTime(value);
    }
    return formatDate(value);
  }
  
  return value;
}
