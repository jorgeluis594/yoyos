import { expect, it } from "vitest";
import { ok } from "@shared/functional";
import { createPgBossProvider, validHandlerPolicy } from "@core/src/shared/events/infrastructure/pg-boss-provider";
import type { EventSubscription } from "@core/src/shared/events/application/contracts";

it("validates handler policy without silently changing zero retries or delay", () => {
  const valid = { retries: 0, retryDelaySeconds: 0, exponentialBackoff: false, concurrency: 1 };
  expect(validHandlerPolicy(valid)).toBe(true);
  for (const changed of [
    { retries: -1 }, { retries: 1.5 }, { retryDelaySeconds: -1 },
    { retryDelaySeconds: 0.5 }, { concurrency: 0 }, { concurrency: 1.5 },
    { retries: 2_147_483_648 }, { retryDelaySeconds: 2_147_483_648 },
  ]) expect(validHandlerPolicy({ ...valid, ...changed })).toBe(false);
});

const base = { retries: 8, retryDelaySeconds: 5, exponentialBackoff: true, concurrency: 16 };
const deadLetter = { id: "ordered-dead-letter", handler: async () => ok(undefined),
  policy: { retries: 8, retryDelaySeconds: 30, exponentialBackoff: false, concurrency: 2 } };

it("accepts the ordering, group, deadline and retention fields of the chat queue", () => {
  expect(validHandlerPolicy({ ...base, orderingKey: () => "chat", groupKey: () => "company", groupConcurrency: 8,
    retryDelayMaxSeconds: 100, expireInSeconds: 90, heartbeatSeconds: 30, deleteAfterSeconds: 604_800, deadLetter })).toBe(true);
});

it("rejects invalid deadline, retention, group and dead-letter values", () => {
  for (const changed of [
    { retryDelayMaxSeconds: 0 }, { expireInSeconds: 0 }, { expireInSeconds: 1.5 }, { heartbeatSeconds: 9 },
    { heartbeatSeconds: 30, expireInSeconds: 30 }, { heartbeatSeconds: 30, expireInSeconds: 20 },
    { deleteAfterSeconds: -1 }, { groupConcurrency: 0 }, { groupConcurrency: 8 }, { groupKey: () => "company" },
    { deadLetter: { ...deadLetter, id: "Bad Id" } },
    { deadLetter: { ...deadLetter, policy: { ...deadLetter.policy, retries: -1 } } },
  ]) expect(validHandlerPolicy({ ...base, ...changed }), JSON.stringify(changed)).toBe(false);
  expect(validHandlerPolicy({ ...base, groupKey: () => "company", groupConcurrency: 0 })).toBe(false);
});

it("rejects an ordering policy without a dead-letter handler at startup", async () => {
  type Events = { "chat.message": { chatId: string } };
  const subscription: EventSubscription<Events, "chat.message"> = {
    id: "ordered", name: "chat.message", handler: async () => ok(undefined),
    parsePayload: input => ok(input as { companyId: string; chatId: string }),
    policy: { ...base, orderingKey: payload => payload.chatId },
  };
  const provider = createPgBossProvider<Events>({ connectionString: "postgresql://unused:unused@127.0.0.1:1/unused", subscriptions: [subscription] });
  await expect(provider.start()).rejects.toThrow("Invalid event subscription: ordered");
});

it("rejects a dead-letter queue that reuses another handler's ID", async () => {
  type Events = { "chat.message": { chatId: string } };
  const parsePayload = (input: unknown) => ok(input as { companyId: string; chatId: string });
  const handler = async () => ok(undefined);
  const first: EventSubscription<Events, "chat.message"> = { id: "first", name: "chat.message", handler, parsePayload, policy: base };
  const second: EventSubscription<Events, "chat.message"> = { id: "second", name: "chat.message", handler, parsePayload,
    policy: { ...base, orderingKey: payload => payload.chatId, deadLetter: { ...deadLetter, id: "first" } } };
  const provider = createPgBossProvider<Events>({ connectionString: "postgresql://unused:unused@127.0.0.1:1/unused", subscriptions: [first, second] });
  await expect(provider.start()).rejects.toThrow("Invalid event subscription: second");
});
