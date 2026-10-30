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

export function parseAgentName(raw: string | null | undefined): AgentName | null {
  if (raw === null || raw === undefined) return null;
  const name = raw.replace(/\p{Cc}/gu, "").trim();
  return name.length >= 1 && name.length <= maxAgentNameLength ? (name as AgentName) : null;
}

// Active while it was used (or authorized, if never used) within the inactivity window and
// authorized after the authorizing account's last password change.
export function isConnectionActive(connection: ConnectionWithPasswordChange, now: Date, inactivityDays: number): boolean {
  const lastActivity = connection.lastUsedAt ?? connection.authorizedAt;
  const recentlyUsed = lastActivity.getTime() > now.getTime() - inactivityDays * day;
  const afterPasswordChange = connection.passwordChangedAt === null || connection.authorizedAt.getTime() > connection.passwordChangedAt.getTime();
  return recentlyUsed && afterPasswordChange;
}

const loopbackHosts: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]", "localhost"]);

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
  const loopback = loopbackHosts.has(url.hostname);
  if (url.protocol === "https:") return !loopback;
  return url.protocol === "http:" && loopback;
}

export function returnTargetOf(uri: string): ReturnTarget {
  const url = parseRedirectUri(uri);
  if (url !== null && url.protocol === "https:" && !loopbackHosts.has(url.hostname)) return { kind: "web", domain: url.hostname };
  return { kind: "this_device" };
}

const minute = 60 * 1000;
export function sameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / minute) === Math.floor(b.getTime() / minute);
}
