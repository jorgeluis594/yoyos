import { expoClient } from "@better-auth/expo/client";
import type { ExpoClientStorage } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";

import { coreUrl } from "@mobile/shared/infrastructure/core-url";
import { authGeneration } from "@mobile/shared/infrastructure/auth-generation";

export function createBetterAuthClient(storage: ExpoClientStorage, fetcher: typeof fetch = fetch, baseURL = `${coreUrl}/api/auth`) {
  const responseGeneration = new WeakMap<Response, number>();
  return createAuthClient({
    baseURL,
    plugins: [
      expoClient({ scheme: "yoyos", storagePrefix: "yoyos_mobile", storage }),
      jwtClient(),
    ],
    fetchOptions: {
      customFetchImpl: async (input, init) => {
        const generation = authGeneration.get();
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const requestUrl = new URL(url);
        const path = `${requestUrl.origin}${requestUrl.pathname}`;
        const method = init?.method ?? (typeof input === "string" || input instanceof URL ? "GET" : input.method);
        try {
          const response = await fetcher(input, init);
          if (__DEV__) console.info(`[auth] ${method} ${path} -> ${response.status}`);
          if (__DEV__ && path.endsWith("/api/auth/get-session")) {
            let body: unknown;
            try { body = await response.clone().json(); } catch { body = "invalid JSON"; }
            const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
            const keys = (value: unknown) => value && typeof value === "object" ? Object.keys(value) : typeof value;
            console.info("[auth] get-session HTTP body", body === null ? null : {
              keys: keys(body),
              sessionKeys: keys(record?.session),
              userKeys: keys(record?.user),
            });
          }
          responseGeneration.set(response, generation);
          return response;
        } catch (cause) {
          if (__DEV__) console.warn(`[auth] ${method} ${path} failed`, cause);
          throw cause;
        }
      },
      onResponse: ({ response }) => {
        // Expo FetchResponse is not an instanceof the global Response; leave valid responses untouched.
        if (responseGeneration.get(response) !== authGeneration.get()) {
          return new Response(null, { status: 499, statusText: "Session changed" });
        }
      },
    },
  });
}

export const authClient = createBetterAuthClient(SecureStore);
