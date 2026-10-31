import { describe, expect, test } from "vitest";
import { createFixedWindowLimiter } from "@core/src/shared/infrastructure/fixed-window-limiter";

describe("createFixedWindowLimiter", () => {
  test("allows sixty calls in a window and refuses the sixty-first with the seconds left", () => {
    let now = 1_000_000;
    const decide = createFixedWindowLimiter(60, 60_000, () => now);
    for (let call = 0; call < 60; call++) expect(decide("store-1")).toEqual({ allowed: true });
    now += 20_500;
    expect(decide("store-1")).toEqual({ allowed: false, retryAfterSeconds: 40 });
  });

  test("starts a new window after a minute", () => {
    let now = 0;
    const decide = createFixedWindowLimiter(2, 60_000, () => now);
    decide("store-1"); decide("store-1");
    expect(decide("store-1").allowed).toBe(false);
    now = 59_999;
    expect(decide("store-1")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    now = 60_000;
    expect(decide("store-1")).toEqual({ allowed: true });
  });

  test("counts each key apart", () => {
    const decide = createFixedWindowLimiter(1, 60_000, () => 0);
    expect(decide("store-1").allowed).toBe(true);
    expect(decide("store-1").allowed).toBe(false);
    expect(decide("store-2").allowed).toBe(true);
  });

  test("forgets stale windows at most once per window instead of on every call", () => {
    let now = 0;
    const decide = createFixedWindowLimiter(1, 1_000, () => now);
    decide("a"); decide("b");
    expect(decide.size()).toBe(2);
    now = 1_500;
    decide("c");
    expect(decide.size()).toBe(1);
    now = 1_600;
    decide("d");
    expect(decide.size()).toBe(2);
  });

  test("treats a stale window as new even when it has not been swept", () => {
    let now = 0;
    const decide = createFixedWindowLimiter(1, 1_000, () => now);
    decide("a");
    now = 900;
    decide("b");
    now = 1_000;
    expect(decide("a").allowed).toBe(true);
  });
});
