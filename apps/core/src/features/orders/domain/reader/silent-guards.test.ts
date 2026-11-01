import { describe, expect, test } from "vitest";
import type { CheckedAction } from "@core/src/features/orders/domain/reader/decide";
import type { RequestRef } from "@core/src/features/orders/domain/reader/readings";
import { lostRequests } from "@core/src/features/orders/domain/reader/silent-guards";

describe("lostRequests", () => {
  const answered = { request: "R1" as RequestRef } as CheckedAction;

  test("gives an urgent doubt to each dropped intent and to each kept intent no check answered", () => {
    const lost = lostRequests(["R3" as RequestRef], ["R1" as RequestRef, "R2" as RequestRef], [answered]);
    expect(lost.map(({ request }) => request)).toEqual(["R3", "R2"]);
    expect(lost[0]).toMatchObject({ action: { kind: "report", outcome: { kind: "reader_doubt" } }, urgent: { problem: "reader_doubt" } });
  });

  test("gives nothing when every intent was answered", () => {
    expect(lostRequests([], ["R1" as RequestRef], [answered])).toEqual([]);
  });

  test("counts a request that another request absorbed as answered, from the dedupe or from the action that folded it", () => {
    const folding = { request: "R1" as RequestRef, absorbed: ["R2" as RequestRef] } as unknown as CheckedAction;
    expect(lostRequests([], ["R1" as RequestRef, "R2" as RequestRef, "R3" as RequestRef], [folding], ["R3" as RequestRef])).toEqual([]);
  });
});
