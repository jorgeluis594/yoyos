import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CompanyId, UserId } from "@shared/identity";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import type { AssistantConnectionId, OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import { revokeClientGrant } from "@core/src/features/assistants/infrastructure/oauth-grant-revocation";

const suffix = randomUUID();
const users = [`revoke-user-a-${suffix}`, `revoke-user-b-${suffix}`];
const clients = [`revoke-client-a-${suffix}`, `revoke-client-b-${suffix}`];
const [userA, userB] = users;
const [clientA, clientB] = clients;
const alreadyRevoked = new Date("2026-01-01T00:00:00.000Z");

const emptyClient = (clientId: string) => ({ id: clientId, clientId, scopes: [], contacts: [], redirectUris: [], postLogoutRedirectUris: [], grantTypes: [], responseTypes: [] });
const refreshToken = (clientId: string, userId: string, revoked: Date | null = null) =>
  ({ id: randomUUID(), token: randomUUID(), clientId, userId, resources: [], requestedUserInfoClaims: [], scopes: ["orders:read"], revoked });
const accessToken = (clientId: string, userId: string, revoked: Date | null = null) =>
  ({ id: randomUUID(), token: randomUUID(), clientId, userId, resources: [], requestedUserInfoClaims: [], scopes: ["orders:read"], revoked });
const consent = (clientId: string, userId: string) => ({ id: randomUUID(), clientId, userId, resources: [], requestedUserInfoClaims: [], scopes: ["orders:read"] });

beforeAll(async () => {
  await systemPrisma.user.createMany({ data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })) });
  await systemPrisma.oauthClient.createMany({ data: clients.map(emptyClient) });
  await systemPrisma.oauthRefreshToken.createMany({ data: [refreshToken(clientA, userA), refreshToken(clientA, userA, alreadyRevoked), refreshToken(clientB, userA), refreshToken(clientA, userB)] });
  await systemPrisma.oauthAccessToken.createMany({ data: [accessToken(clientA, userA), accessToken(clientA, userA, alreadyRevoked), accessToken(clientB, userA), accessToken(clientA, userB)] });
  await systemPrisma.oauthConsent.createMany({ data: [consent(clientA, userA), consent(clientB, userA), consent(clientA, userB)] });
});

afterAll(async () => {
  await systemPrisma.oauthClient.deleteMany({ where: { clientId: { in: clients } } });
  await systemPrisma.user.deleteMany({ where: { id: { in: users } } });
  await systemPrisma.$disconnect();
});

test("revoking a client's grant revokes its tokens and consent for that account only and keeps earlier revocations", async () => {
  const result = await revokeClientGrant({
    oauthClientId: clientA as OAuthClientId, userId: userA as UserId,
    companyId: randomUUID() as CompanyId, connectionId: randomUUID() as AssistantConnectionId,
  });
  expect(result).toEqual({ success: true, data: { refreshTokens: 1, accessTokens: 1, consents: 1 } });

  const state = async (clientId: string, userId: string) => ({
    refresh: (await systemPrisma.oauthRefreshToken.findMany({ where: { clientId, userId }, select: { revoked: true } })).map((row) => row.revoked !== null).sort(),
    access: (await systemPrisma.oauthAccessToken.findMany({ where: { clientId, userId }, select: { revoked: true } })).map((row) => row.revoked !== null).sort(),
    consents: await systemPrisma.oauthConsent.count({ where: { clientId, userId } }),
  });
  expect(await state(clientA, userA)).toEqual({ refresh: [true, true], access: [true, true], consents: 0 });
  expect(await state(clientB, userA)).toEqual({ refresh: [false], access: [false], consents: 1 });
  expect(await state(clientA, userB)).toEqual({ refresh: [false], access: [false], consents: 1 });

  const earlier = await systemPrisma.oauthRefreshToken.findMany({ where: { clientId: clientA, userId: userA, revoked: alreadyRevoked } });
  expect(earlier).toHaveLength(1);
  expect(await systemPrisma.oauthAccessToken.count({ where: { clientId: clientA, userId: userA, revoked: alreadyRevoked } })).toBe(1);
});

test("revoking a grant that has nothing left to revoke succeeds and changes nothing", async () => {
  const result = await revokeClientGrant({
    oauthClientId: clientA as OAuthClientId, userId: userA as UserId,
    companyId: randomUUID() as CompanyId, connectionId: randomUUID() as AssistantConnectionId,
  });
  expect(result).toEqual({ success: true, data: { refreshTokens: 0, accessTokens: 0, consents: 0 } });
});
