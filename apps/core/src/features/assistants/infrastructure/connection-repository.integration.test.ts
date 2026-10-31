import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { CompanyId, UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { parseAgentName, type AssistantConnectionId, type NewAssistantConnection, type OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import { connectionRepository } from "@core/src/features/assistants/infrastructure/connection-repository";

const suffix = randomUUID();
const userA = `repo-user-a-${suffix}` as UserId;
const userB = `repo-user-b-${suffix}` as UserId;
const companyA = randomUUID() as CompanyId;
const companyB = randomUUID() as CompanyId;
const client = (name: string) => `repo-${name}-${suffix}` as OAuthClientId;
const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-30T12:00:00.000Z");

const newConnection = (overrides: Partial<NewAssistantConnection> = {}): NewAssistantConnection => ({
  id: randomUUID() as AssistantConnectionId, companyId: companyA, authorizedByUserId: userA, oauthClientId: client("one"),
  agentName: null, returnTarget: { kind: "web", domain: "claude.ai" }, scopes: ["orders:read"], authorizedAt: now, ...overrides,
});
const rowsOf = (companyId: CompanyId, oauthClientId: OAuthClientId) =>
  withTenantIsolation(companyId, async () => await prisma.assistantConnection.findMany({ where: { oauthClientId } }));

beforeAll(async () => {
  await systemPrisma.user.createMany({ data: [userA, userB].map((id) => ({ id, name: id, email: `${id}@example.test` })) });
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "Tienda", country: "PE" } }));
});

afterAll(async () => {
  for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
    await prisma.assistantConnection.deleteMany({});
    await prisma.company.deleteMany({ where: { id } });
  });
  await systemPrisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await systemPrisma.$disconnect();
});

test("upserting the same client and account twice keeps one row", async () => {
  const first = await connectionRepository.saveConnection(newConnection({ agentName: parseAgentName("Claude") }));
  const second = await connectionRepository.saveConnection(newConnection({ agentName: parseAgentName("Otro"), authorizedAt: new Date(now.getTime() + 1000) }));
  expect(first).toEqual({ success: true, data: "inserted" });
  expect(second).toEqual({ success: true, data: "unchanged" });
  const rows = await rowsOf(companyA, client("one"));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ agentName: parseAgentName("Claude"), authorizedAt: now, lastUsedAt: null });
});

test("two concurrent first saves keep one row and neither fails", async () => {
  const oauthClientId = client("race");
  const results = await Promise.all([1, 2].map(() => connectionRepository.saveConnection(newConnection({ oauthClientId }))));
  expect(results.every((result) => result.success)).toBe(true);
  expect(results.map((result) => result.success && result.data).sort()).toEqual(["inserted", "unchanged"]);
  expect(await rowsOf(companyA, oauthClientId)).toHaveLength(1);
});

test("allowing again an active connection keeps its name, dates and last use", async () => {
  const oauthClientId = client("keep");
  const used = new Date(now.getTime() - day);
  await connectionRepository.saveConnection(newConnection({ oauthClientId, agentName: parseAgentName("Claude"), authorizedAt: new Date(now.getTime() - 5 * day) }));
  await withTenantIsolation(companyA, async () => await prisma.assistantConnection.updateMany({ where: { oauthClientId }, data: { lastUsedAt: used } }));
  expect(await connectionRepository.saveConnection(newConnection({ oauthClientId, agentName: parseAgentName("Nuevo"), authorizedAt: now }))).toEqual({ success: true, data: "unchanged" });
  expect((await rowsOf(companyA, oauthClientId))[0]).toMatchObject({ agentName: parseAgentName("Claude"), authorizedAt: new Date(now.getTime() - 5 * day), lastUsedAt: used });
});

test("reactivates an ended row that is still stored with the new authorization and no last use", async () => {
  const oauthClientId = client("ended");
  await connectionRepository.saveConnection(newConnection({ oauthClientId, agentName: parseAgentName("Viejo"), authorizedAt: new Date(now.getTime() - 200 * day) }));
  await withTenantIsolation(companyA, async () => await prisma.assistantConnection.updateMany({ where: { oauthClientId }, data: { lastUsedAt: new Date(now.getTime() - 100 * day) } }));
  const again = newConnection({ oauthClientId, agentName: parseAgentName("Nuevo"), returnTarget: { kind: "this_device" } });
  expect(await connectionRepository.saveConnection(again)).toEqual({ success: true, data: "reactivated" });
  const rows = await rowsOf(companyA, oauthClientId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ agentName: "Nuevo", returnKind: "this_device", returnDomain: null, authorizedAt: now, lastUsedAt: null });
});

test("reactivating logs the stored row's id, not the id of the discarded new connection", async () => {
  const oauthClientId = client("logged");
  await connectionRepository.saveConnection(newConnection({ oauthClientId, authorizedAt: new Date(now.getTime() - 200 * day) }));
  const [stored] = await rowsOf(companyA, oauthClientId);
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  try {
    const again = newConnection({ oauthClientId });
    expect(await connectionRepository.saveConnection(again)).toEqual({ success: true, data: "reactivated" });
    const created = info.mock.calls.filter(([fields]) => (fields as { event?: string }).event === "assistant_connection_created");
    expect(created).toHaveLength(1);
    expect(created[0][0]).toMatchObject({ connectionId: stored.id });
    expect(stored.id).not.toBe(again.id);
  } finally { info.mockRestore(); }
});

test("reactivates a row authorized before the account's last password change", async () => {
  const oauthClientId = client("reset");
  await systemPrisma.account.create({ data: { id: randomUUID(), accountId: userB, providerId: "credential", userId: userB, password: "hash", updatedAt: new Date(now.getTime() - day) } });
  await connectionRepository.saveConnection(newConnection({ oauthClientId, authorizedByUserId: userB, authorizedAt: new Date(now.getTime() - 3 * day) }));
  expect(await connectionRepository.saveConnection(newConnection({ oauthClientId, authorizedByUserId: userB }))).toEqual({ success: true, data: "reactivated" });
});

test("lists the store's connections with the account's password change and never another store's", async () => {
  const listed = await connectionRepository.findConnections(companyA);
  expect(listed.success && listed.data.length).toBeGreaterThanOrEqual(4);
  const reset = listed.success ? listed.data.find((connection) => connection.oauthClientId === client("reset")) : undefined;
  expect(reset?.passwordChangedAt).toEqual(new Date(now.getTime() - day));
  expect(await connectionRepository.findConnections(companyB)).toEqual({ success: true, data: [] });
});

test("deleting another store's connection id answers no row and changes nothing", async () => {
  const [row] = await rowsOf(companyA, client("one"));
  expect(await connectionRepository.deleteConnection(row.id as AssistantConnectionId, companyB)).toEqual({ success: true, data: null });
  expect(await rowsOf(companyA, client("one"))).toHaveLength(1);
});

test("deleting a connection returns the client and account it belonged to, and a second delete finds nothing", async () => {
  const [row] = await rowsOf(companyA, client("one"));
  expect(await connectionRepository.deleteConnection(row.id as AssistantConnectionId, companyA)).toEqual({
    success: true, data: { id: row.id, companyId: companyA, oauthClientId: client("one"), authorizedByUserId: userA },
  });
  expect(await connectionRepository.deleteConnection(row.id as AssistantConnectionId, companyA)).toEqual({ success: true, data: null });
});

test("deleting an account's connections leaves the other accounts' connections of the store", async () => {
  const ended = await connectionRepository.deleteAccountConnections(companyA, userA);
  expect(ended.success && ended.data.every((connection) => connection.authorizedByUserId === userA)).toBe(true);
  expect(ended.success && ended.data.length).toBeGreaterThanOrEqual(3);
  const remaining = await connectionRepository.findConnections(companyA);
  expect(remaining.success && remaining.data.map((connection) => connection.authorizedByUserId)).toEqual([userB]);
});
