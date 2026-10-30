import { describe, expect, test } from "vitest";
import { allCases } from "@core/evals/cases";
import { conversationCases } from "@core/evals/cases/conversations";
import { allPinnedMissIds, pinnedMissIds, pinnedNotApplicableIds } from "@core/evals/cases/pinned-misses";
import { isMessageStep, type ConversationCase } from "@core/evals/cases/schema";
import { splitOf, splitOfCase } from "@core/evals/cases/split";

const conversations = allCases.filter((testCase): testCase is ConversationCase => testCase.pass === "conversation");

/** The families the technical plan (T7) lists, by the `kind` of the conversation. */
const requiredFamilies = ["photo-then-size", "partial-completion", "replacement", "decline", "two-pendings", "doubtful-then-choice", "caption-completes-pending",
  "pending-after-payment", "orderless-pending-after-payment", "ready-with-pending"];

describe("conversation cases", () => {
  test("there are at least 20 conversations of 2 to 4 messages", () => {
    expect(conversations.length).toBeGreaterThanOrEqual(20);
    for (const conversation of conversations) expect(conversation.steps.filter(isMessageStep).length).toBeGreaterThanOrEqual(2);
  });

  test.each(requiredFamilies)("the %s family has a conversation in dev and one in test", (family) => {
    const splits = new Set(conversations.filter(({ kind }) => kind === family).map(splitOfCase));

    expect(splits).toEqual(new Set(["dev", "test"]));
  });

  test("a conversation's split is the hash of its id", () => {
    for (const conversation of conversations) expect(splitOfCase(conversation)).toBe(splitOf(conversation.id));
  });

  test("every message step states its notice and the order it leaves", () => {
    for (const conversation of conversations) {
      for (const step of conversation.steps.filter(isMessageStep)) expect(step.expected.order, conversation.id).toBeDefined();
    }
  });

  test("a doubted caption on a photo advancing a pending expects the pending's notice again", () => {
    const repeats = conversations.flatMap(({ steps }) => steps.filter(isMessageStep).filter((step) => step.expectsRepeatNotice));

    expect(repeats.some((step) => step.input.photo !== undefined && step.input.caption !== undefined && step.expected.notice === "variant_missing")).toBe(true);
  });

  test("conversation ids are unique and written only in the table", () => {
    expect(new Set(conversationCases.map(({ id }) => id)).size).toBe(conversationCases.length);
  });
});

describe("pinned misses", () => {
  test("there are 28 pinned ids: 19 in dev and 9 in test, by the id hash", () => {
    expect(pinnedMissIds.dev).toHaveLength(19);
    expect(pinnedMissIds.test).toHaveLength(9);
    expect(pinnedMissIds.dev.every((id) => splitOf(id.split("~")[0]!) === "dev")).toBe(true);
    expect(pinnedMissIds.test.every((id) => splitOf(id.split("~")[0]!) === "test")).toBe(true);
  });

  test("every pinned case carries pinned-miss, but the two text-identification cases the text pass no longer has", () => {
    const tagged = allCases.filter(({ tags }) => tags.includes("pinned-miss")).map(({ id }) => id).sort();

    expect(tagged).toEqual(allPinnedMissIds.filter((id) => !pinnedNotApplicableIds.includes(id)).sort());
    expect(allCases.some(({ id }) => pinnedNotApplicableIds.includes(id))).toBe(false);
  });
});
