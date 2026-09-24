import { expoClient } from "@better-auth/expo/client";
import type { ExpoClientStorage } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";

import { coreUrl } from "./core-url";
import { authGeneration } from "./auth-generation";

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
        const response = await fetcher(input, init);
        responseGeneration.set(response, generation);
        return response;
      },
      onResponse: ({ response }) => responseGeneration.get(response) === authGeneration.get()
        ? response
        : new Response(null, { status: 499, statusText: "Session changed" }),
    },
  });
}

export const authClient = createBetterAuthClient(SecureStore);
