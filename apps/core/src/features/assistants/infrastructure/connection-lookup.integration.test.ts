import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CompanyId, UserId } from "@shared/identity";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import { findConnectionForClient } from "@core/src/features/assistants/infrastructure/connection-lookup";

const suffix = randomUUID();
const userId = `lookup-user-${suffix}`;
const client = `lookup-client-${suffix}` as OAuthClientId;
const companyA = randomUUID() as CompanyId;
const companyB = randomUUID() as CompanyId;
const authorizedAt = new Date("2026-10-01T10:00:00.000Z");

const connectionData = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(), authorizedByUserId: userId, oauthClientId: client, agentName: "Claude", returnKind: "web", returnDomain: "claude.ai",
  scopes: ["orders:read", "products:read"], authorizedAt, ...overrides,
});

beforeAll(async () => {
  await systemPrisma.user.create({ data: { id: userId, name: "Lookup", email: `${userId}@example.test` } });
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "Tienda", country: "PE" } }));
  await systemPrisma.account.create({ data: { id: randomUUID(), accountId: userId, providerId: "credential", userId, password: "hash", updatedAt: new Date("2026-09-01T00:00:00.000Z") } });
});

afterAll(async () => {
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
    await prisma.assistantConnection.deleteMany({});
    await prisma.company.deleteMany({ where: { id } });
  });
  await systemPrisma.user.deleteMany({ where: { id: userId } });
  await systemPrisma.$disconnect();
});

test("finds the connection of a client and account with the account's last password change", async () => {
  await withTenantIsolation(companyA, async () => await prisma.assistantConnection.create({ data: connectionData() }));
  const found = await withTenantIsolation(companyA, () => findConnectionForClient(client, userId as UserId));
  expect(found).toMatchObject({ success: true, data: {
    companyId: companyA, oauthClientId: client, authorizedByUserId: userId, agentName: "Claude", returnTarget: { kind: "web", domain: "claude.ai" },
    scopes: ["orders:read", "products:read"], authorizedAt, lastUsedAt: null, passwordChangedAt: new Date("2026-09-01T00:00:00.000Z"),
  } });
});

test("does not see another store's connection or an unknown client", async () => {
  expect(await withTenantIsolation(companyB, () => findConnectionForClient(client, userId as UserId))).toEqual({ success: true, data: null });
  expect(await withTenantIsolation(companyA, () => findConnectionForClient("unknown" as OAuthClientId, userId as UserId))).toEqual({ success: true, data: null });
});

const checkViolation = (constraint: string) => `Code: \`23514\`. Message: \`new row for relation "AssistantConnection" violates check constraint "${constraint}"\``;

test("the database keeps one connection per store, client and account", async () => {
  await expect(withTenantIsolation(companyA, async () => await prisma.assistantConnection.create({ data: connectionData() })))
    .rejects.toThrow("Unique constraint failed on the constraint: `AssistantConnection_companyId_oauthClientId_authorizedByUse_key`");
});

test.each([
  ["a web return without a domain", { returnKind: "web", returnDomain: null }, "AssistantConnection_return_domain_matches_kind"],
  ["a this-device return with a domain", { returnKind: "this_device", returnDomain: "claude.ai" }, "AssistantConnection_return_domain_matches_kind"],
  ["an unknown return kind", { returnKind: "app", returnDomain: null }, "AssistantConnection_return_kind_valid"],
  ["an empty agent name", { agentName: "" }, "AssistantConnection_agent_name_length"],
  ["no scopes", { scopes: [] }, "AssistantConnection_scopes_not_empty"],
])("the database rejects %s", async (_title, bad, constraint) => {
  await expect(withTenantIsolation(companyB, async () => await prisma.assistantConnection.create({ data: connectionData({ oauthClientId: `bad-${randomUUID()}`, ...bad }) })))
    .rejects.toThrow(checkViolation(constraint));
});

test("row level security refuses a row for another company", async () => {
  await expect(withTenantIsolation(companyB, async () => await prisma.assistantConnection.create({ data: connectionData({ companyId: companyA, oauthClientId: `other-${randomUUID()}` }) })))
    .rejects.toThrow('Code: `42501`. Message: `new row violates row-level security policy for table "AssistantConnection"`');
});
