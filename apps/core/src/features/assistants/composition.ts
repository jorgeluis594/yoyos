import { randomUUID } from "node:crypto";
import { assistantConfig } from "@core/src/features/assistants/infrastructure/assistant-config";
import { connectionRepository } from "@core/src/features/assistants/infrastructure/connection-repository";
import { revokeEndedConnectionGrant } from "@core/src/features/assistants/infrastructure/oauth-grant-revocation";
import { createOAuthGrant } from "@core/src/features/assistants/infrastructure/oauth-grant";
import { authorizeAssistant, type AssistantOwnerAccess, type SignedAuthorizationRequest } from "@core/src/features/assistants/application/authorize-assistant";
import { denyAssistant } from "@core/src/features/assistants/application/deny-assistant";
import { listAssistantConnections } from "@core/src/features/assistants/application/list-assistant-connections";
import { disconnectAssistant, type DisconnectAssistantInput } from "@core/src/features/assistants/application/disconnect-assistant";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";

/** Connection operations for the web routes. Imports `auth.ts`, so `auth.ts` and its hooks must never import this file. */
const clock = () => new Date();
const generateId = () => randomUUID() as AssistantConnectionId;

/** The authorization screen's operations, bound to the request that carries the owner's cookie. */
export function authorizationFor(request: Request) {
  const grant = createOAuthGrant(request, clock);
  return {
    read: (signed: SignedAuthorizationRequest) => grant.readRequest(signed, clock()),
    allow: (signed: SignedAuthorizationRequest, access: AssistantOwnerAccess) =>
      authorizeAssistant({ request: signed }, access, { ...grant, saveConnection: connectionRepository.saveConnection, generateId, clock }),
    deny: (signed: SignedAuthorizationRequest, access: AssistantOwnerAccess) => denyAssistant({ request: signed }, access, { ...grant, clock }),
  };
}

export const assistantConnections = {
  list: (access: AssistantOwnerAccess) => listAssistantConnections({}, access, {
    findConnections: connectionRepository.findConnections, clock, inactivityDays: assistantConfig.connectionInactivityDays,
  }),
  disconnect: (input: DisconnectAssistantInput, access: AssistantOwnerAccess) => disconnectAssistant(input, access, {
    deleteConnection: connectionRepository.deleteConnection, revokeClientGrant: revokeEndedConnectionGrant,
  }),
};
