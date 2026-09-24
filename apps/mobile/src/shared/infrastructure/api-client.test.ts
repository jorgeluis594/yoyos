import { ok } from "@shared/functional";
import { createApiClient } from "./api-client";

test("retries once after 401 and does not retry a server error", async () => {
  let renewals = 0;
  let requests = 0;
  const session = {
    getToken: async () => ok("old-token"),
    renewToken: async () => { renewals++; return ok("new-token"); },
    generation: () => 1,
  };
  const request = createApiClient(session, async (_input, init) => {
    requests++;
    if (requests === 1) return Response.json({ code: "UNAUTHENTICATED", error: "expired" }, { status: 401 });
    return Response.json({ status: "ok" });
  });
  expect(await request("/api/me")).toMatchObject({ success: true, data: { status: "ok" } });
  expect([requests, renewals]).toEqual([2, 1]);

  requests = 0;
  const serverFailure = createApiClient(session, async () => {
    requests++;
    return Response.json({ code: "INTERNAL_ERROR", error: "failed" }, { status: 500 });
  });
  expect(await serverFailure("/api/company", { method: "POST", body: "{}" })).toMatchObject({
    success: false, error: { code: "SERVER_ERROR" },
  });
  expect(requests).toBe(1);
});

test("invalid JSON and network errors are returned without retry", async () => {
  const session = {
    getToken: async () => ok("token"),
    renewToken: async () => ok("new-token"),
    generation: () => 1,
  };
  let calls = 0;
  const request = createApiClient(session, async () => {
    calls++;
    return new Response("not-json");
  });
  expect(await request("/api/me")).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(calls).toBe(1);

  const offline = createApiClient(session, async () => { calls++; throw new Error("offline"); });
  expect(await offline("/api/me", { method: "POST", body: "{}" })).toMatchObject({
    success: false, error: { code: "NETWORK_ERROR" },
  });
  expect(calls).toBe(2);
});

test("a late 401 reuses the refreshed token and a logout discards late API responses", async () => {
  let currentToken = "old-token";
  let generation = 1;
  let renewals = 0;
  let requests = 0;
  const session = {
    getToken: async () => ok(currentToken),
    renewToken: async () => { renewals++; currentToken = "new-token"; return ok(currentToken); },
    generation: () => generation,
  };
  const lateUnauthorized = createApiClient(session, async () => {
    requests++;
    if (requests === 1) {
      currentToken = "new-token";
      return Response.json({ code: "UNAUTHENTICATED", error: "expired" }, { status: 401 });
    }
    return Response.json({ ok: true });
  });
  expect(await lateUnauthorized("/api/me")).toMatchObject({ success: true });
  expect([requests, renewals]).toEqual([2, 0]);

  let release!: (response: Response) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const pending = createApiClient(session, () => {
    markStarted();
    return new Promise((resolve) => { release = resolve; });
  });
  const result = pending("/api/me");
  await started;
  generation++;
  release(Response.json({ status: "ready" }));
  expect(await result).toMatchObject({ success: false, error: { code: "OPERATION_CANCELLED" } });
});
