import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { findMentionCandidates, noMentionMatches, type MentionCandidates } from "@core/src/features/products/application/find-mention-candidates";

test("makes no query for a message without mentions", async () => {
  let searches = 0;
  const result = await findMentionCandidates([], { searchMentions: async () => { searches += 1; return ok({ mentions: [], durationMs: 0, timedOut: false }); } });
  expect(searches).toBe(0);
  expect(result).toEqual(ok({ mentions: [], durationMs: 0, timedOut: false }));
});

test("searches all the mentions of a message with one call", async () => {
  const calls: (readonly string[])[] = [];
  const found: MentionCandidates = { mentions: [noMentionMatches, noMentionMatches], durationMs: 5, timedOut: false };
  const result = await findMentionCandidates(["casaca jean", "polo rojo"], { searchMentions: async (mentions) => { calls.push(mentions); return ok(found); } });
  expect(calls).toEqual([["casaca jean", "polo rojo"]]);
  expect(result).toEqual(ok(found));
});
