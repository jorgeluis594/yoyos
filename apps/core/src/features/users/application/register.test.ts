import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { register } from "@core/src/features/users/application/register";

const account = { name: "Ana", email: "Ana+ventas@example.com", password: " pass word " };

test("register validates account input before side effects and preserves password", async () => {
  let received: unknown;
  let calls = 0;
  const dependencies = { registerAccount: async (input: unknown) => { calls++; received = input; return ok(undefined); } };
  expect(await register({ ...account, email: "bad" }, dependencies)).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(calls).toBe(0);
  expect(await register(account, dependencies)).toEqual(ok({ status: "accepted" }));
  expect(received).toEqual({ name: "Ana", email: "ana+ventas@example.com", password: " pass word " });
});

test("register returns only a neutral result and propagates provider failures", async () => {
  expect(await register({ name: "Ana", email: "ana@example.com", password: "password123" }, { registerAccount: async () => ok(undefined) })).toEqual(ok({ status: "accepted" }));
  const failure = err({ code: "NETWORK_ERROR" as const, message: "Unavailable" });
  expect(await register({ name: "Ana", email: "ana@example.com", password: "password123" }, { registerAccount: async () => failure })).toEqual(failure);
});
