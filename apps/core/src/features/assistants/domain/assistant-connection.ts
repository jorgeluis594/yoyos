import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantScope } from "@core/src/features/assistants/domain/scopes";

export type AssistantConnectionId = string & { readonly __brand: "AssistantConnectionId" };
// The OAuth plugin's `client_id`; it is not a UUID.
export type OAuthClientId = string & { readonly __brand: "OAuthClientId" };
export type AgentName = string & { readonly __brand: "AgentName" };

// A loopback redirect has no domain to show, so the target is a union instead of a nullable domain.
export type ReturnTarget =
  | Readonly<{ kind: "web"; domain: string }>
  | Readonly<{ kind: "this_device" }>;

export type AssistantConnection = Readonly<{
  id: AssistantConnectionId;
  companyId: CompanyId;
  authorizedByUserId: UserId;
  oauthClientId: OAuthClientId;
  agentName: AgentName | null;
  returnTarget: ReturnTarget;
  scopes: readonly [AssistantScope, ...AssistantScope[]];
  authorizedAt: Date;
  lastUsedAt: Date | null;
}>;

export type ConnectionWithPasswordChange = AssistantConnection & Readonly<{ passwordChangedAt: Date | null }>;

export type NewAssistantConnection = Omit<AssistantConnection, "lastUsedAt">;

const maxAgentNameLength = 80;
const day = 24 * 60 * 60 * 1000;

// Counted in code points, like the database's char_length check.
export function agentNameLengthIsValid(name: string): boolean {
  const length = Array.from(name).length;
  return length >= 1 && length <= maxAgentNameLength;
}

export function parseAgentName(raw: string | null | undefined): AgentName | null {
  if (raw === null || raw === undefined) return null;
  // Control (Cc) and format (Cf) characters go: a bidi override (U+202E) or a zero-width space could spoof the name on the consent screen.
  const name = raw.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  return agentNameLengthIsValid(name) ? (name as AgentName) : null;
}

export type ConnectionEndReason = "inactive" | "password_reset" | "consent_outdated";

// Null while the connection is active. A password change comes first, then a missing required scope (a category added after the
// owner authorized), then the inactivity window (used, or authorized if never used, within `inactivityDays`).
export function connectionEndReason(
  connection: ConnectionWithPasswordChange, now: Date, inactivityDays: number, requiredScopes: readonly AssistantScope[],
): ConnectionEndReason | null {
  const afterPasswordChange = connection.passwordChangedAt === null || connection.authorizedAt.getTime() > connection.passwordChangedAt.getTime();
  if (!afterPasswordChange) return "password_reset";
  if (requiredScopes.some((scope) => !connection.scopes.includes(scope))) return "consent_outdated";
  const lastActivity = connection.lastUsedAt ?? connection.authorizedAt;
  return lastActivity.getTime() > now.getTime() - inactivityDays * day ? null : "inactive";
}

export function isConnectionActive(
  connection: ConnectionWithPasswordChange, now: Date, inactivityDays: number, requiredScopes: readonly AssistantScope[],
): boolean {
  return connectionEndReason(connection, now, inactivityDays, requiredScopes) === null;
}

// The URL parser already normalizes numeric hosts: 127.1 becomes 127.0.0.1 and ::ffff:127.0.0.1 becomes [::ffff:7f00:1].
const ipv4LoopbackBlock = /^127(\.\d{1,3}){3}$/;
const ipv4MappedLoopback = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "localhost." || hostname === "[::1]" || ipv4LoopbackBlock.test(hostname) || ipv4MappedLoopback.test(hostname);
}

function parseRedirectUri(uri: string): URL | null {
  try {
    const url = new URL(uri);
    if (url.username !== "" || url.password !== "" || url.hash !== "" || uri.includes("#")) return null;
    return url;
  } catch {
    return null;
  }
}

// https with a non-loopback host, or http on a loopback host. Anything else cannot be shown honestly on the authorization screen.
export function isAllowedRedirectUri(uri: string): boolean {
  const url = parseRedirectUri(uri);
  if (url === null) return false;
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol === "https:") return !loopback;
  return url.protocol === "http:" && loopback;
}

// Null for a URI that is not allowed: it must never be shown as "this device".
export function returnTargetOf(uri: string): ReturnTarget | null {
  if (!isAllowedRedirectUri(uri)) return null;
  const url = parseRedirectUri(uri);
  if (url === null) return null;
  return url.protocol === "https:" ? { kind: "web", domain: url.hostname } : { kind: "this_device" };
}

const minute = 60 * 1000;
export function sameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / minute) === Math.floor(b.getTime() / minute);
}
