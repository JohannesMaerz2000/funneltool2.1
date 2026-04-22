/**
 * Formats a date string, number, or Date object into a German localized string.
 */
export function formatDateTime(date: string | number | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  if (isNaN(d.getTime())) return String(date);

  return d.toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Formats a date string, number, or Date object into a German localized date-only string.
 */
export function formatDate(date: string | number | Date | null | undefined): string {
  if (!date) return "";
  
  // Handle YYYY-MM-DD strings specifically to avoid timezone shifts
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString("de-DE", {
      dateStyle: "medium",
    });
  }

  const d = typeof date === "string" ? new Date(date) : new Date(date);
  if (isNaN(d.getTime())) return String(date);

  return d.toLocaleDateString("de-DE", {
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

export function durationSecondsBetween(
  start: string | null | undefined,
  end: string | null | undefined
): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return Math.round(Math.abs(endMs - startMs) / 1000);
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const totalSeconds = Math.round(seconds);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const secs = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.slice(0, 2).join(" ");
}
