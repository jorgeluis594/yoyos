import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { createCompanyForUser, type CompanyRegistrationRepository } from "@core/src/features/companies/application/create-company-for-user";

const companyId = "123e4567-e89b-42d3-a456-426614174000";
const input = { userId: "u", name: "  Tienda  ", country: "PE" as const };

test("creates a normalized company, retries existing links, and resolves a concurrent winner", async () => {
  let writes = 0;
  const repository: CompanyRegistrationRepository = {
    findLink: async () => ok({ status: "unlinked" }),
    createAndLink: async (received) => { writes++; expect(received.name).toBe("Tienda"); return ok({ status: "created", companyId }); },
  };
  expect(await createCompanyForUser(input, repository)).toEqual(ok({ companyId, created: true }));
  expect(writes).toBe(1);
  expect(await createCompanyForUser(input, { ...repository, findLink: async () => ok({ status: "linked", companyId }) })).toEqual(ok({ companyId, created: false }));
  expect(writes).toBe(1);
  let reads = 0;
  expect(await createCompanyForUser(input, {
    findLink: async () => ok(++reads === 1 ? { status: "unlinked" } : { status: "linked", companyId }),
    createAndLink: async () => ok({ status: "link_changed" }),
  })).toEqual(ok({ companyId, created: false }));
});

test("rejects bad input before effects and reports missing or failed links", async () => {
  const repository: CompanyRegistrationRepository = {
    findLink: async () => { throw new Error("should not be called"); },
    createAndLink: async () => { throw new Error("should not be called"); },
  };
  expect(await createCompanyForUser({ ...input, name: "   " }, repository)).toMatchObject({ success: false, error: { code: "INVALID_COMPANY" } });
  expect(await createCompanyForUser(input, { ...repository, findLink: async () => ok({ status: "user_missing" }) })).toMatchObject({ success: false, error: { code: "USER_NOT_FOUND" } });
  const unavailable = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "failed" });
  expect(await createCompanyForUser(input, { ...repository, findLink: async () => unavailable })).toEqual(unavailable);
  expect(await createCompanyForUser(input, { findLink: async () => ok({ status: "unlinked" }), createAndLink: async () => unavailable })).toEqual(unavailable);
  expect(await createCompanyForUser(input, {
    findLink: async () => ok({ status: "unlinked" }),
    createAndLink: async () => ok({ status: "link_changed" }),
  })).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
});
