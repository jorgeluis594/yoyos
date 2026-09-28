import { createAuthClient } from "better-auth/react";
import { createBetterAuthClient } from "@mobile/shared/infrastructure/auth-client";
import { authGeneration } from "@mobile/shared/infrastructure/auth-generation";

jest.mock("better-auth/react", () => ({ createAuthClient: jest.fn(() => ({})) }));
jest.mock("better-auth/client/plugins", () => ({ jwtClient: () => ({}) }));
jest.mock("@better-auth/expo/client", () => ({ expoClient: () => ({}) }));

// Exercise the installed HTTP engine; only SDK routing and native plugins are mocked.
const { createFetch } = jest.requireActual(require.resolve("@better-fetch/fetch", {
  paths: [require.resolve("better-auth/react")],
}));

function client(fetcher: typeof fetch) {
  createBetterAuthClient({
    getItem: () => null, setItem: () => {},
    getItemAsync: async () => null, setItemAsync: async () => {},
  }, fetcher);
  const options = jest.mocked(createAuthClient).mock.calls.at(-1)?.[0];
  return createFetch({ ...options?.fetchOptions, baseURL: "http://localhost:3000/api/auth" });
}

test("accepts a null session from an Expo-style response outside the global Response prototype", async () => {
  const response = new Response("null", { headers: { "content-type": "application/json" } });
  // Expo 57 FetchResponse implements Response without inheriting from it.
  const nativeResponse = {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text: () => response.text(),
    clone: () => response.clone(),
  } as Response;
  expect(nativeResponse).not.toBeInstanceOf(Response);
  const request = client(async () => nativeResponse);
  await expect(request("/get-session")).resolves.toEqual({ data: null, error: null });
});

test("rejects a response received after the session generation changes", async () => {
  const request = client(async () => {
    authGeneration.advance();
    return new Response("null", { headers: { "content-type": "application/json" } });
  });
  await expect(request("/get-session")).resolves.toMatchObject({ data: null, error: { status: 499 } });
});

test("preserves a real transport failure", async () => {
  const request = client(async () => { throw new TypeError("Network request failed"); });
  await expect(request("/get-session")).rejects.toThrow("Network request failed");
});
