import { salesTimeZone as limaZone } from "@shared/orders-date";

function limaParts(instant: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: limaZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** «30/10/2026», in America/Lima. */
export function formatLimaDate(iso: string): string {
  const { day, month, year } = limaParts(new Date(iso));
  return `${day}/${month}/${year}`;
}

/** «10:42», in America/Lima. */
export function formatLimaTime(iso: string): string {
  const { hour, minute } = limaParts(new Date(iso));
  return `${hour}:${minute}`;
}

export function isLimaToday(iso: string, now: Date): boolean {
  return formatLimaDate(iso) === formatLimaDate(now.toISOString());
}

/** The URL carries the signed authorization query the OAuth plugin builds: the sign-in must continue that request. */
export function hasSignedAuthorizationQuery(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("sig") && params.has("exp") && params.has("client_id");
}
