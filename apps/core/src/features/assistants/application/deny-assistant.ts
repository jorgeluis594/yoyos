import type { Result } from "@shared/result";
import type {
  AssistantOwnerAccess, AuthorizationGrant, AuthorizationRequest, AuthorizeAssistantError, AuthorizeAssistantInput, RedirectUrl, SignedAuthorizationRequest,
} from "@core/src/features/assistants/application/authorize-assistant";

export type DenyAssistantDependencies = Readonly<{
  readRequest: (request: SignedAuthorizationRequest, now: Date) => Promise<Result<AuthorizationRequest, AuthorizeAssistantError>>;
  rejectRequest: (request: SignedAuthorizationRequest, grant: AuthorizationGrant) => Promise<Result<RedirectUrl, AuthorizeAssistantError>>;
  clock: () => Date;
}>;

/** «No permitir»: the redirect carries `error=access_denied`; nothing is stored. */
export async function denyAssistant(input: AuthorizeAssistantInput, access: AssistantOwnerAccess, deps: DenyAssistantDependencies): Promise<Result<RedirectUrl, AuthorizeAssistantError>> {
  const read = await deps.readRequest(input.request, deps.clock());
  if (!read.success) return read;
  return deps.rejectRequest(input.request, { oauthClientId: read.data.oauthClientId, userId: access.userId });
}
