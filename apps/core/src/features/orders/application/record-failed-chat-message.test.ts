import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { recordFailedChatMessage, type RecordFailedChatMessageDependencies } from "@core/src/features/orders/application/record-failed-chat-message";
import type { ChatMessageOutcomes, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

const messageId = "00000000-0000-4000-8000-000000000002" as ChatMessageId;
const failed: ChatMessageOutcomes = [{ kind: "failed", errorCode: "INVALID_AI_RESPONSE" }];
const stored = (outcomes: ChatMessageOutcomes, noticeSentAt: Date | null = null): StoredChatMessageOutcome => ({ outcomes, noticeSentAt });

type Insert = Awaited<ReturnType<RecordFailedChatMessageDependencies["insertFailedOutcome"]>>;

function harness(insert: Insert, saveFails = false) {
  const state = { outcome: null as StoredChatMessageOutcome | null, memory: null as unknown, saves: 0 };
  const deps: RecordFailedChatMessageDependencies = {
    // Like a rollback: nothing the work wrote stays when it fails.
    transaction: async (work) => {
      const before = { ...state };
      const result = await work();
      if (!result.success) Object.assign(state, before);
      return result;
    },
    insertFailedOutcome: async () => {
      if (insert.success && insert.data.inserted) state.outcome = insert.data.stored;
      return insert;
    },
    saveLastIncomingPhotoOfMessageChat: async (_id, memory) => {
      state.saves += 1;
      if (saveFails) return err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" });
      state.memory = memory;
      return ok(null);
    },
  };
  return { state, record: () => recordFailedChatMessage(deps)(messageId, "INVALID_AI_RESPONSE") };
}

describe("recordFailedChatMessage", () => {
  test("a newly recorded failure writes a memory with no leftover in the same transaction", async () => {
    const h = harness(ok({ inserted: true, stored: stored(failed) }));
    expect(await h.record()).toEqual(ok({ publishNotice: true }));
    expect(h.state.outcome).not.toBeNull();
    expect(h.state.memory).toEqual({ left: null });
  });

  test("a retry that finds a stored failure writes the memory again and publishes the notice only if it is due", async () => {
    const due = harness(ok({ inserted: false, stored: stored(failed) }));
    expect(await due.record()).toEqual(ok({ publishNotice: true }));
    expect(due.state.memory).toEqual({ left: null });
    const claimed = harness(ok({ inserted: false, stored: stored(failed, new Date("2026-10-30T10:00:00Z")) }));
    expect(await claimed.record()).toEqual(ok({ publishNotice: false }));
    expect(claimed.state.memory).toEqual({ left: null });
  });

  test("a stored successful outcome writes no memory", async () => {
    const h = harness(ok({ inserted: false, stored: stored([{ kind: "no_intent" }]) }));
    expect(await h.record()).toEqual(ok({ publishNotice: false }));
    expect(h.state.saves).toBe(0);
  });

  test("a failed memory write rolls back the failed outcome", async () => {
    const h = harness(ok({ inserted: true, stored: stored(failed) }), true);
    expect(await h.record()).toEqual(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
    expect(h.state.outcome).toBeNull();
  });

  test("a missing message writes nothing and publishes no notice", async () => {
    const h = harness(ok({ inserted: false, stored: null }));
    expect(await h.record()).toEqual(ok({ publishNotice: false }));
    expect(h.state.saves).toBe(0);
  });

  test("a failed outcome insert is reported and writes no memory", async () => {
    const h = harness(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
    expect(await h.record()).toEqual(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
    expect(h.state.saves).toBe(0);
  });
});
