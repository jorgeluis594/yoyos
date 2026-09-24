import { expect, expectTypeOf, test } from "vitest";
import { ok, err } from "@shared/functional";
import { loadUserAccess } from "@core/src/features/users/application/load-user-access";
import { requireCompany, type ReadyAccess, type UserAccess } from "@core/src/features/users/application/user-access";

const companyId = "123e4567-e89b-42d3-a456-426614174000";
const user = { id: "user-id", name: "Ana", companyId };
const company = { id: companyId, name: "Tienda", country: "PE" as const };

test("load access distinguishes absence, pending company, and ready company", async () => {
  const findCompany = async () => ok(company);
  expect(await loadUserAccess("user-id", { findUser: async () => ok(null), findCompany })).toEqual(ok(null));
  const pending = await loadUserAccess("user-id", { findUser: async () => ok({ ...user, companyId: null }), findCompany });
  expect(pending).toEqual(ok({ status: "company_required", user: { ...user, companyId: null }, company: null }));
  if (pending.success && pending.data) expect(requireCompany(pending.data)).toEqual(err({ code: "COMPANY_REQUIRED", message: "Company required" }));
  const ready = await loadUserAccess("user-id", { findUser: async () => ok(user), findCompany });
  expect(ready).toEqual(ok({ status: "ready", user, company }));
  if (ready.success && ready.data) expect(requireCompany(ready.data)).toEqual(ready);
});

test("load access preserves persistence failures and rejects broken stored links", async () => {
  const unavailable = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "database failed" });
  expect(await loadUserAccess("u", { findUser: async () => unavailable, findCompany: async () => ok(null) })).toEqual(unavailable);
  expect(await loadUserAccess("u", { findUser: async () => ok(user), findCompany: async () => unavailable })).toEqual(unavailable);
  expect(await loadUserAccess("u", { findUser: async () => ok(user), findCompany: async () => ok(null) })).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  expect(await loadUserAccess("u", { findUser: async () => ok(user), findCompany: async () => ok({ ...company, id: crypto.randomUUID() }) })).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  expect(await loadUserAccess("u", { findUser: async () => ok({ ...user, companyId: "bad" }), findCompany: async () => ok(company) })).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
});

test("a pending access cannot be typed as ready", () => {
  expectTypeOf<Extract<UserAccess, { status: "company_required" }>>().not.toMatchTypeOf<ReadyAccess>();
});
