// What a connection can be granted. MCP 2/4-4/4 add literals here, one per data category.
export type AssistantScope = "orders:read";

export const assistantScopes: readonly [AssistantScope, ...AssistantScope[]] = ["orders:read"];

// The OAuth scopes of this authorization server: the data scopes plus the refresh token that keeps a connection alive after sign-out.
export const oauthScopes = [...assistantScopes, "offline_access"] as const;
export type OAuthScope = (typeof oauthScopes)[number];

// Every authorization and registration is normalized to this exact value (see the technical design, section 5.11).
export const grantedOAuthScope: string = oauthScopes.join(" ");
