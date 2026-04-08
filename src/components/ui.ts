export const ui = {
  page: "ui-page",
  card: "ui-card",
  cardHeader: "ui-card-header",
  eyebrow: "ui-eyebrow",
  sectionTitle: "ui-section-title",
  input: "ui-input",
  button: "ui-button",
  badge: "ui-badge",
};

export type BadgeTone = "neutral" | "info" | "success" | "warn" | "danger";

const badgeToneClassByTone: Record<BadgeTone, string> = {
  neutral: "ui-badge-neutral",
  info: "ui-badge-info",
  success: "ui-badge-success",
  warn: "ui-badge-warn",
  danger: "ui-badge-danger",
};

export function badgeTone(tone: BadgeTone): string {
  return badgeToneClassByTone[tone];
}
