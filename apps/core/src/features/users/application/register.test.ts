import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { register, type RegisterDependencies } from "@core/src/features/users/application/register";

const input = {
  account: { name: "Ana", email: "ana@example.com", password: "password123" },
  company: { name: "  Tienda Ana  ", country: "PE" },
};

describe("web registration", () => {
  test("validates both drafts before side effects", async () => {
    const calls: string[] = [];
    const dependencies: RegisterDependencies = {
      registerAccount: async () => { calls.push("account"); return ok(undefined); },
      createCompany: async () => { calls.push("company"); return ok(undefined); },
    };
    expect(await register({ ...input, company: { ...input.company, country: "ZZ" } }, dependencies)).toMatchObject({ success: false, error: { step: "company", code: "INVALID_INPUT" } });
    expect(await register({ ...input, account: { ...input.account, email: "invalid" } }, dependencies)).toMatchObject({ success: false, error: { step: "account", code: "INVALID_INPUT" } });
    expect(calls).toEqual([]);
  });

  test("creates account, then company with a normalized name", async () => {
    const calls: string[] = [];
    expect(await register(input, {
      registerAccount: async () => { calls.push("account"); return ok(undefined); },
      createCompany: async (company) => { calls.push(`company:${company.name}`); return ok(undefined); },
    })).toEqual(ok(undefined));
    expect(calls).toEqual(["account", "company:Tienda Ana"]);
  });

  test("stops on account failure", async () => {
    let companyCalls = 0;
    expect(await register(input, {
      registerAccount: async () => err({ code: "REJECTED", message: "duplicate" }),
      createCompany: async () => { companyCalls++; return ok(undefined); },
    })).toMatchObject({ success: false, error: { step: "account", code: "REJECTED", message: "duplicate" } });
    expect(companyCalls).toBe(0);
  });

  test("retries company without creating the account again", async () => {
    let accountCalls = 0;
    let companyCalls = 0;
    const dependencies: RegisterDependencies = {
      registerAccount: async () => { accountCalls++; return ok(undefined); },
      createCompany: async () => ++companyCalls === 1
        ? err({ code: "NETWORK_ERROR", message: "disconnected" })
        : ok(undefined),
    };
    expect(await register(input, dependencies)).toMatchObject({ success: false, error: { step: "company", code: "NETWORK_ERROR" } });
    expect(await register({ company: input.company }, dependencies)).toEqual(ok(undefined));
    expect({ accountCalls, companyCalls }).toEqual({ accountCalls: 1, companyCalls: 2 });
  });
});
