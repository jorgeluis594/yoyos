import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { findMessageCandidates, type MessageCandidates } from "@core/src/features/products/application/find-message-candidates";

const found: MessageCandidates = { productIds: [], matchCount: 2, durationMs: 12, timedOut: false, wordsSearched: 4 };

test("searches the words of the message, longest first", async () => {
  const searches: (readonly string[])[] = [];
  const result = await findMessageCandidates("quiero la polera negra", { searchByCoverage: async (words) => { searches.push(words); return ok(found); } });
  expect(searches).toEqual([["quiero", "polera", "negra"]]);
  expect(result).toEqual(ok(found));
});

test("makes no query and finds no candidates for a message without words", async () => {
  let searches = 0;
  const result = await findMessageCandidates("si, ok :)", { searchByCoverage: async () => { searches += 1; return ok(found); } });
  expect(searches).toBe(0);
  expect(result).toEqual(ok({ productIds: [], matchCount: 0, durationMs: 0, timedOut: false, wordsSearched: 0 }));
});
