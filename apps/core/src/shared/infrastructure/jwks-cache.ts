import { createLocalJWKSet, type JSONWebKeySet } from "jose";

export type JwtKeys = ReturnType<typeof createLocalJWKSet>;

export type JwksCache = Readonly<{
  /** The cached keys, loaded again once they are older than the cache lifetime. */
  get: () => Promise<JwtKeys>;
  /** For a token signed with an unknown key id: loads again unless the keys were loaded in the last throttle window. */
  refresh: () => Promise<JwtKeys>;
}>;

const cacheLifetimeMs = 60_000;
const refreshThrottleMs = 30_000;

/** One cache per process, shared by the mobile and the assistant verifiers so a flood of unknown key ids costs at most one reload per window. */
export function createJwksCache(load: () => Promise<JSONWebKeySet>, now: () => number = Date.now): JwksCache {
  let cached: { keys: JwtKeys; loadedAt: number } | undefined;
  let loading: Promise<JwtKeys> | undefined;

  function reload(): Promise<JwtKeys> {
    loading ??= load().then((jwks) => {
      const keys = createLocalJWKSet(jwks);
      cached = { keys, loadedAt: now() };
      return keys;
    }).finally(() => { loading = undefined; });
    return loading;
  }

  return {
    get: async () => cached !== undefined && now() - cached.loadedAt < cacheLifetimeMs ? cached.keys : reload(),
    refresh: async () => cached !== undefined && now() - cached.loadedAt < refreshThrottleMs ? cached.keys : reload(),
  };
}
