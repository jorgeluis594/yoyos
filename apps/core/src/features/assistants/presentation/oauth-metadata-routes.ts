import { Router, type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { auth, authIssuer, mcpResourceUrl } from "@core/src/shared/infrastructure/auth";
import { log } from "@core/src/shared/infrastructure/logger";
import { oauthScopes } from "@core/src/features/assistants/domain/scopes";

const authServerMetadata = oauthProviderAuthServerMetadata(auth);
const resourceActions = oauthProviderResourceClient(auth).getActions();

async function sendWebResponse(response: ExpressResponse, webResponse: Response) {
  webResponse.headers.forEach((value, name) => response.setHeader(name, value));
  response.status(webResponse.status).send(Buffer.from(await webResponse.arrayBuffer()));
}

// RFC 9728: the one protected resource is the MCP endpoint, served by the Yoyos authorization server.
async function protectedResource(_request: ExpressRequest, response: ExpressResponse) {
  try {
    const metadata = await resourceActions.getProtectedResourceMetadata({
      resource: mcpResourceUrl,
      authorization_servers: [authIssuer],
      scopes_supported: [...oauthScopes],
      bearer_methods_supported: ["header"],
      resource_name: "Yoyos",
    });
    response.set("Cache-Control", "public, max-age=900").json(metadata);
  } catch (cause) {
    log.error({ event: "assistant_metadata_failed", metadata: "protected_resource", err: cause }, "assistant_metadata_failed");
    response.status(503).set("Cache-Control", "no-store").json({ error: "temporarily_unavailable" });
  }
}

// RFC 8414: the plugin's own document, built from its configuration.
async function authorizationServer(request: ExpressRequest, response: ExpressResponse) {
  try {
    const webRequest = new Request(new URL(request.originalUrl, authIssuer), { method: "GET" });
    await sendWebResponse(response, await authServerMetadata(webRequest));
  } catch (cause) {
    log.error({ event: "assistant_metadata_failed", metadata: "authorization_server", err: cause }, "assistant_metadata_failed");
    response.status(503).set("Cache-Control", "no-store").json({ error: "temporarily_unavailable" });
  }
}

export const oauthMetadataRoutes = Router();
oauthMetadataRoutes.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], protectedResource);
oauthMetadataRoutes.get("/.well-known/oauth-authorization-server", authorizationServer);
