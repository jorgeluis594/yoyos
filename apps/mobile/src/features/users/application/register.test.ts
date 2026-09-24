import { err, ok } from "@shared/functional";
import { register } from "./register";
import { completeCompany } from "./complete-company";
import type { CompanyDraft } from "@/features/companies";

const id = "00000000-0000-4000-8000-000000000001";
const pending = { status: "company_required" as const, user: { id: "user-1", name: "A", companyId: null }, company: null };
const ready = { status: "ready" as const, user: { id: "user-1", name: "A", companyId: id }, company: { id, name: "Company", country: "PE" as const } };
const input = { account: { name: "A", email: "a@example.com", password: "password123" }, company: { name: " Company ", country: "PE" as const } };

test("validates every field before creating an account or company", async () => {
  let effects = 0;
  const dependencies = {
    registerAccount: async () => { effects++; return ok(undefined); },
    readAccess: async () => { effects++; return ok(pending); },
    completeCompany: async () => { effects++; return ok(ready); },
  };
  expect(await register({ ...input, company: { ...input.company, name: "  " } }, dependencies)).toMatchObject({ success: false, error: { step: "account", cause: { code: "INVALID_INPUT" } } });
  expect(await register({ ...input, account: { ...input.account, password: "short" } }, dependencies)).toMatchObject({ success: false, error: { step: "account" } });
  expect(effects).toBe(0);
});

test("registration completes pending company, but reuses an existing company", async () => {
  const calls: string[] = [];
  const dependencies = {
    registerAccount: async () => { calls.push("account"); return ok(undefined); },
    readAccess: async () => { calls.push("access"); return ok(pending); },
    completeCompany: async (draft: CompanyDraft) => { calls.push(draft.name); return ok(ready); },
  };
  expect(await register(input, dependencies)).toEqual(ok(ready));
  expect(calls).toEqual(["account", "access", "Company"]);
  calls.length = 0;
  expect(await register(input, { ...dependencies, readAccess: async () => ok(ready) })).toEqual(ok(ready));
  expect(calls).toEqual(["account"]);
});

test("registration preserves the failure step and recovery action", async () => {
  const accountFailure = err({ code: "EMAIL_IN_USE" as const, message: "duplicate" });
  const networkFailure = err({ code: "NETWORK_ERROR" as const, message: "offline" });
  const base = { registerAccount: async () => ok(undefined), readAccess: async () => ok(pending), completeCompany: async () => ok(ready) };
  expect(await register(input, { ...base, registerAccount: async () => accountFailure })).toMatchObject({ success: false, error: { step: "account", recovery: "check_session_or_edit_account", cause: { code: "EMAIL_IN_USE" } } });
  expect(await register(input, { ...base, readAccess: async () => networkFailure })).toMatchObject({ success: false, error: { step: "access", recovery: "restore_session", cause: { code: "NETWORK_ERROR" } } });
  expect(await register(input, { ...base, completeCompany: async () => err({ code: "COMPANY_SETUP_INTERRUPTED" as const, message: "failed", step: "create" as const, cause: { code: "NETWORK_ERROR" as const, message: "offline" } }) })).toMatchObject({ success: false, error: { step: "company", recovery: "reload_access_then_complete_company" } });
  expect(await register(input, { ...base, completeCompany: async () => err({ code: "COMPANY_SETUP_INTERRUPTED" as const, message: "failed", step: "reload" as const, cause: { code: "NETWORK_ERROR" as const, message: "offline" } }) })).toMatchObject({ success: false, error: { step: "reload", recovery: "reload_access" } });
});

test("an uncertain sign-up result does not repeat account creation", async () => {
  let registrations = 0;
  const result = await register(input, {
    registerAccount: async () => { registrations++; return err({ code: "NETWORK_ERROR", message: "response lost" }); },
    readAccess: async () => { throw new Error("access should not be read before recovery"); },
    completeCompany: async () => { throw new Error("company should not be created before recovery"); },
  });
  expect(result).toMatchObject({ success: false, error: { step: "account", recovery: "check_session_or_edit_account", cause: { code: "NETWORK_ERROR" } } });
  expect(registrations).toBe(1);
});

test("company recovery never signs up again and rejects an incoherent reload", async () => {
  let writes = 0;
  const createCompany = async () => { writes++; return ok({ companyId: id }); };
  expect(await completeCompany(input.company, { createCompany, readAccess: async () => ok(pending) })).toMatchObject({ success: false, error: { step: "reload", cause: { code: "INVALID_RESPONSE" } } });
  expect(await completeCompany(input.company, { createCompany, readAccess: async () => ok(ready) })).toEqual(ok(ready));
  expect(writes).toBe(2);
});
