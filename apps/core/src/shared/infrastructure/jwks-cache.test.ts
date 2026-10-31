import { describe, expect, test, vi } from "vitest";
import type { JSONWebKeySet } from "jose";
import { createJwksCache } from "@core/src/shared/infrastructure/jwks-cache";

const keySet: JSONWebKeySet = { keys: [] };

describe("createJwksCache", () => {
  test("loads the key set once and serves it for sixty seconds", async () => {
    let now = 0;
    const load = vi.fn(async () => keySet);
    const cache = createJwksCache(load, () => now);
    const first = await cache.get();
    now = 59_999;
    expect(await cache.get()).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    now = 60_000;
    expect(await cache.get()).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("reloads on an unknown key at most once every thirty seconds", async () => {
    let now = 0;
    const load = vi.fn(async () => keySet);
    const cache = createJwksCache(load, () => now);
    await cache.get();
    now = 31_000;
    for (let attempt = 0; attempt < 100; attempt++) await cache.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    now = 61_000;
    await cache.refresh();
    expect(load).toHaveBeenCalledTimes(3);
  });

  test("does not reload for an unknown key right after the keys were loaded", async () => {
    let now = 0;
    const load = vi.fn(async () => keySet);
    const cache = createJwksCache(load, () => now);
    await cache.get();
    now = 10_000;
    await cache.refresh();
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("shares one load between concurrent callers and retries after a failure", async () => {
    let now = 0;
    const load = vi.fn(async () => keySet).mockRejectedValueOnce(new Error("store down"));
    const cache = createJwksCache(load, () => now);
    await expect(cache.get()).rejects.toThrow("store down");
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(2);
    now = 1;
  });
});
