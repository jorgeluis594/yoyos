import { expect, test } from "vitest";
import { messageExpectation, noticeKind, outcomeKinds } from "@core/evals/cases/schema";
import { sellerNoticeKinds } from "@core/src/features/orders/domain/seller-notice";

test("parses every new outcome kind in an expectation", () => {
  const added = ["pending_created", "pending_updated", "pending_completed", "pending_split", "pending_ended", "reader_doubt", "request_not_allowed", "invalid_action",
    "product_not_available", "variant_for_several_pendings", "ready_with_pendings", "caption_not_applied"] as const;

  for (const kind of added) expect(messageExpectation.parse({ notice: null, outcomes: [kind] }).outcomes).toEqual([kind]);
  expect(outcomeKinds).toEqual(expect.arrayContaining([...added]));
  expect(() => messageExpectation.parse({ notice: null, outcomes: ["nonsense"] })).toThrow();
});

test("uses only seller notice kinds that exist in an expectation", () => {
  for (const kind of sellerNoticeKinds) expect(messageExpectation.parse({ notice: kind }).notice).toBe(kind);
  expect(noticeKind.options).toEqual(sellerNoticeKinds);
  expect(() => messageExpectation.parse({ notice: "made_up" })).toThrow();
  expect(() => messageExpectation.parse({})).toThrow("states a notice or outcomes");
});
