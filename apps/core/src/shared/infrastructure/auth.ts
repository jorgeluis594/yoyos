import { log } from "@core/src/shared/infrastructure/logger";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { jwt } from "better-auth/plugins/jwt";
import { expo } from "@better-auth/expo";
import { oauthProvider } from "@better-auth/oauth-provider";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { accountEmails } from "@core/src/features/users/composition";
import { isAllowedRedirectUri } from "@core/src/features/assistants/domain/assistant-connection";
import { oauthScopes } from "@core/src/features/assistants/domain/scopes";
import { assistantConfig } from "@core/src/features/assistants/infrastructure/assistant-config";
import { oauthBeforeHook, onPasswordReset } from "@core/src/features/assistants/auth-hooks";

export const authIssuer = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
// The one protected resource of the OAuth server: the remote MCP endpoint.
export const mcpResourceUrl = `${authIssuer}/mcp`;

// Plugin endpoints this version does not use answer 404. Only register, authorize, token, revoke and consent stay.
// The /admin/oauth2/* endpoints are SERVER_ONLY (never routed over HTTP), so they are not listed.
const disabledOAuthPaths = [
  "/oauth2/create-client", "/oauth2/update-client", "/oauth2/delete-client",
  "/oauth2/client/rotate-secret", "/oauth2/client/rotate-keys",
  "/oauth2/get-client", "/oauth2/get-clients", "/oauth2/public-client", "/oauth2/public-client-prelogin",
  "/oauth2/get-consent", "/oauth2/get-consents", "/oauth2/update-consent", "/oauth2/delete-consent",
  "/oauth2/continue", "/oauth2/userinfo", "/oauth2/introspect",
  "/oauth2/end-session", "/oauth2/end-session/confirm",
  "/.well-known/openid-configuration",
];

export const auth = betterAuth({
  baseURL: authIssuer,
  database: prismaAdapter(systemPrisma, { provider: "postgresql" }),
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: 60 * 60 * 24,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => accountEmails.sendVerification(user.email, url),
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false,
    resetPasswordTokenExpiresIn: 60 * 30,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset,
    sendResetPassword: async ({ user, url }) => accountEmails.sendReset(user.email, url),
    onExistingUserSignUp: async ({ user }) => {
      if (!user.emailVerified) {
        try {
          await auth.api.sendVerificationEmail({ body: { email: user.email, callbackURL: `${authIssuer}/account-verified` } });
        } catch {
          log.error({ event: "email_verification_resend_failed" }, "email_verification_resend_failed");
        }
      }
    },
  },
  rateLimit: {
    // Unset keeps Better Auth's default (on in production only). The OAuth rate limit test turns it on.
    enabled: process.env.AUTH_RATE_LIMIT_ENABLED === undefined ? undefined : process.env.AUTH_RATE_LIMIT_ENABLED === "true",
    // Per client IP, in memory. Agents refresh from shared egress IPs, hence the larger token bucket.
    customRules: {
      "/oauth2/register": { window: 60, max: assistantConfig.registerLimitPerMinute },
      "/oauth2/authorize": { window: 60, max: assistantConfig.authorizeLimitPerMinute },
      "/oauth2/token": { window: 60, max: assistantConfig.tokenLimitPerMinute },
    },
  },
  advanced: {
    // x-forwarded-for is a chain behind Coolify's proxy; trustedProxies lets Better Auth skip the proxy hops
    // and ignore addresses a client prepends to the header.
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"], trustedProxies: [...assistantConfig.trustedProxies] },
  },
  disabledPaths: disabledOAuthPaths,
  hooks: { before: oauthBeforeHook },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  trustedOrigins: [authIssuer, "yoyos://", ...(process.env.NODE_ENV === "development" ? ["exp://**"] : [])],
  plugins: [expo(), jwt({
    jwt: {
      issuer: authIssuer,
      audience: "yoyos-core-api",
      expirationTime: "15m",
      definePayload: ({ session }) => ({ sid: session.id }),
    },
  }), oauthProvider({
    loginPage: "/login",
    consentPage: "/assistants/authorize",
    scopes: [...oauthScopes],
    resources: [{ identifier: mcpResourceUrl, name: "Yoyos", allowedScopes: [...oauthScopes] }],
    // No client_credentials: every token belongs to an owner who allowed access on the authorization screen.
    grantTypes: ["authorization_code", "refresh_token"],
    clientRegistrationDefaultResources: [mcpResourceUrl],
    clientRegistrationDefaultScopes: [...oauthScopes],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    accessTokenExpiresIn: assistantConfig.accessTokenTtlSeconds,
    refreshTokenExpiresIn: assistantConfig.refreshTokenTtlSeconds,
    refreshTokenReuseInterval: assistantConfig.refreshReuseSeconds,
    codeExpiresIn: assistantConfig.authorizationRequestTtlSeconds,
    // The plugin uses this answer instead of its own registration match, so keep the registered-URI result.
    validateRedirectUri: (redirectUri, _registeredUris, defaultResult) => defaultResult && isAllowedRedirectUri(redirectUri),
  })],
});
