import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import { loadUserAccess } from "@core/src/features/users";
import { userRepository } from "@core/src/features/users/infrastructure/user-repository";
import { companyRepository } from "@core/src/features/companies/infrastructure/company-repository";
import { authIssuer, mcpResourceUrl } from "@core/src/shared/infrastructure/auth";
import { jwksCache } from "@core/src/shared/infrastructure/jwt-verifier";
import { createFixedWindowLimiter } from "@core/src/shared/infrastructure/fixed-window-limiter";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { assistantConfig } from "@core/src/features/assistants/infrastructure/assistant-config";
import { createAssistantTokenVerifier } from "@core/src/features/assistants/infrastructure/assistant-token-verifier";
import { findConnectionForClient } from "@core/src/features/assistants/infrastructure/connection-lookup";
import { endConnection, touchConnection } from "@core/src/features/assistants/infrastructure/connection-access-repository";
import { resolveAssistantAccess, type ResolveAssistantAccessError } from "@core/src/features/assistants/application/resolve-assistant-access";
import { createToolRegistry } from "@core/src/features/assistants/presentation/tool-registry";
import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";
import { mcpRoutes } from "@core/src/features/assistants/presentation/mcp-routes";
import { toolModules } from "@core/src/composition/assistant-tools";

const clock = () => new Date();
const unavailable = (): ResolveAssistantAccessError => ({ code: "PERSISTENCE_UNAVAILABLE", message: "Assistant access unavailable" });

async function loadAccess(userId: UserId) {
  const access = await loadUserAccess(userId, { ...userRepository, findCompany: companyRepository.findCompany });
  return access.success ? access : err(unavailable());
}

async function findConnection(...args: Parameters<typeof findConnectionForClient>) {
  const found = await findConnectionForClient(...args);
  return found.success ? found : err(unavailable());
}

async function end(...args: Parameters<typeof endConnection>): Promise<Result<null, ResolveAssistantAccessError>> {
  const ended = await endConnection(...args);
  return ended.success ? ok(null) : err(unavailable());
}

/** The `/mcp` routes with the verifier, limiters, access resolution and the given tool modules wired. Each call gets its own limiters. */
export function createAssistantMcpRoutes(modules: readonly ToolModule[]) {
  const toolCallLimiter = createFixedWindowLimiter(assistantConfig.toolCallLimitPerMinute, 60_000);
  const registry = createToolRegistry({
    modules,
    toolCallLimit: assistantConfig.toolCallLimitPerMinute,
    now: Date.now,
    answer: { allowCall: (companyId: CompanyId) => toolCallLimiter(companyId), touchConnection, clock },
  });
  return mcpRoutes({
    verifyToken: createAssistantTokenVerifier({
      keys: jwksCache, issuer: authIssuer, resource: mcpResourceUrl, maxLifetimeSeconds: assistantConfig.accessTokenTtlSeconds, now: clock,
    }).verify,
    allowRequest: createFixedWindowLimiter(assistantConfig.requestLimitPerMinute, 60_000),
    resolveAccess: (token) => resolveAssistantAccess(token, {
      loadUserAccess: loadAccess,
      inTenant: withTenantIsolation,
      findConnection,
      endConnection: end,
      clock,
      inactivityDays: assistantConfig.connectionInactivityDays,
    }),
    inTenant: withTenantIsolation,
    createServer: registry.createServer,
    resourceUrl: mcpResourceUrl,
    resourceMetadataUrl: `${authIssuer}/.well-known/oauth-protected-resource/mcp`,
  });
}

export const assistantMcpRoutes = createAssistantMcpRoutes(toolModules);
