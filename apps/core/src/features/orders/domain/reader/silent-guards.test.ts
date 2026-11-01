import { describe, expect, test } from "vitest";
import type { CheckedAction } from "@core/src/features/orders/domain/reader/decide";
import type { RequestRef } from "@core/src/features/orders/domain/reader/readings";
import { lostRequests, quoteNames } from "@core/src/features/orders/domain/reader/silent-guards";

describe("quoteNames", () => {
  const catalog = ["Polo básico", "Negro", "M"];

  test("accepts a quote with a catalog word, ignoring case, accents and a plural or other ending", () => {
    expect(quoteNames("los POLOS", catalog)).toBe(true);
    expect(quoteNames("el basico", catalog)).toBe(true);
    expect(quoteNames("la negra", ["Negro"])).toBe(true);
    expect(quoteNames("el negro", catalog)).toBe(true);
    expect(quoteNames("la M", catalog)).toBe(true);
  });

  test("refuses a quote that holds no catalog word, such as a pronoun or a demonstrative", () => {
    for (const quote of ["esas", "lo mismo", "igual", "ese"]) expect(quoteNames(quote, catalog)).toBe(false);
  });
});

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
});
