import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import {
  parseAgentName, returnTargetOf,
  type AssistantConnectionId, type NewAssistantConnection, type OAuthClientId,
} from "@core/src/features/assistants/domain/assistant-connection";
import { assistantScopes } from "@core/src/features/assistants/domain/scopes";

/** The raw signed query string the OAuth plugin passed to the authorization screen; only `readRequest` parses it. */
export type SignedAuthorizationRequest = string & { readonly __brand: "SignedAuthorizationRequest" };
/** Where the browser goes next: the agent's redirect URI with a `code` or an `error`. */
export type RedirectUrl = string & { readonly __brand: "RedirectUrl" };
export type AssistantOwnerAccess = Readonly<{ companyId: CompanyId; userId: UserId }>;

/** What the signed query says about the agent, after the registered client and its redirect URI were checked. */
export type AuthorizationRequest = Readonly<{ oauthClientId: OAuthClientId; clientName: string | null; redirectUri: string }>;
export type AuthorizationGrant = Readonly<{ oauthClientId: OAuthClientId; userId: UserId }>;

export type AuthorizeAssistantError = Readonly<{
  code: "REQUEST_INVALID" | "REQUEST_EXPIRED" | "AUTHORIZATION_UNAVAILABLE" | "PERSISTENCE_UNAVAILABLE";
  message: string;
}>;
export type SaveConnectionOutcome = "inserted" | "reactivated" | "unchanged";

export type AuthorizeAssistantInput = Readonly<{ request: SignedAuthorizationRequest }>;
export type AuthorizeAssistantDependencies = Readonly<{
  readRequest: (request: SignedAuthorizationRequest, now: Date) => Promise<Result<AuthorizationRequest, AuthorizeAssistantError>>;
  acceptRequest: (request: SignedAuthorizationRequest, grant: AuthorizationGrant) => Promise<Result<RedirectUrl, AuthorizeAssistantError>>;
  saveConnection: (connection: NewAssistantConnection) => Promise<Result<SaveConnectionOutcome, AuthorizeAssistantError>>;
  generateId: () => AssistantConnectionId;
  clock: () => Date;
}>;

/**
 * The owner taps «Permitir acceso». The request is accepted first, so an expired or rejected request never leaves a row;
 * the agent only gets the code through the returned redirect, after the connection row exists.
 */
export async function authorizeAssistant(input: AuthorizeAssistantInput, access: AssistantOwnerAccess, deps: AuthorizeAssistantDependencies): Promise<Result<RedirectUrl, AuthorizeAssistantError>> {
  const now = deps.clock();
  const read = await deps.readRequest(input.request, now);
  if (!read.success) return read;
  const returnTarget = returnTargetOf(read.data.redirectUri);
  if (returnTarget === null) return err({ code: "REQUEST_INVALID", message: "The redirect URI is not allowed" });
  const accepted = await deps.acceptRequest(input.request, { oauthClientId: read.data.oauthClientId, userId: access.userId });
  if (!accepted.success) return accepted;
  const saved = await deps.saveConnection({
    id: deps.generateId(),
    companyId: access.companyId,
    authorizedByUserId: access.userId,
    oauthClientId: read.data.oauthClientId,
    agentName: parseAgentName(read.data.clientName),
    returnTarget,
    scopes: [...assistantScopes],
    authorizedAt: now,
  });
  return saved.success ? ok(accepted.data) : saved;
}
