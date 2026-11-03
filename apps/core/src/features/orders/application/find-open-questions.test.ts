import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import { findOpenQuestions, type FindOpenQuestionsDependencies } from "@core/src/features/orders/application/find-open-questions";

const message = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as ChatMessageId;
const plain = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as ChatMessageId;
const chat = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as ChatId;
const pendingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as ChatPendingId;
const question = { language: "pt", kind: "another_of_which" } as const;
const readAt = new Date("2026-10-31T15:00:00.000Z");

function dependencies(overrides: Partial<FindOpenQuestionsDependencies> = {}): FindOpenQuestionsDependencies {
  return {
    findOutcomes: vi.fn(async () => ok([
      { messageId: message, outcomes: [{ kind: "pending_created", pendingId }, { kind: "questions", questions: [question] }] as const, readAt },
      { messageId: plain, outcomes: [{ kind: "no_intent" }] as const, readAt },
    ])),
    findMessageChats: vi.fn(async () => ok(new Map([[message, chat]]))),
    findChatQuestionStates: vi.fn(async () => ok(new Map([[chat, { pendingIds: [pendingId], lastRequestAt: null }]]))),
    findOrderQuestionFacts: vi.fn(async () => ok(new Map())),
    ...overrides,
  };
}

describe("findOpenQuestions", () => {
  test("returns only the messages that still have open questions, with one read of each kind", async () => {
    const deps = dependencies();
    expect(await findOpenQuestions([message, plain], deps)).toEqual(ok([{ messageId: message, questions: [question] }]));
    expect(deps.findMessageChats).toHaveBeenCalledWith([message]);
    expect(deps.findChatQuestionStates).toHaveBeenCalledWith([chat]);
    expect(deps.findOrderQuestionFacts).not.toHaveBeenCalled();
  });

  test("drops the question when its pending is no longer stored", async () => {
    const deps = dependencies({ findChatQuestionStates: async () => ok(new Map()) });
    expect(await findOpenQuestions([message], deps)).toEqual(ok([]));
  });

  test("refuses no ids and more than a hundred", async () => {
    expect(await findOpenQuestions([], dependencies())).toEqual(err({ code: "INVALID_INPUT", message: expect.any(String) }));
    expect(await findOpenQuestions(Array.from({ length: 101 }, () => message), dependencies())).toEqual(err({ code: "INVALID_INPUT", message: expect.any(String) }));
  });

  test("passes a persistence failure on", async () => {
    const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
    expect(await findOpenQuestions([message], dependencies({ findOutcomes: async () => failure }))).toEqual(failure);
    expect(await findOpenQuestions([message], dependencies({ findChatQuestionStates: async () => failure }))).toEqual(failure);
  });
});
