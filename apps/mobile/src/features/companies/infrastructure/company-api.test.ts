import { ok } from "@shared/functional";
import { createCompany } from "../application/create-company";
import { createCompanyApi } from "./company-api";
import { createApiClient } from "@/shared/infrastructure/api-client";

const id = "00000000-0000-4000-8000-000000000001";

test("POST /company sends only validated name and country, accepts 200/201 bodies", async () => {
  const calls: unknown[] = [];
  const request = createCompanyApi(async (path, init) => {
    calls.push([path, init.method, JSON.parse(String(init.body))]);
    return ok({ companyId: id });
  });
  const draft = { name: " Company ", country: "PE" as const, companyId: "untrusted" };
  expect(await createCompany(draft, request)).toEqual(ok({ companyId: id }));
  expect(calls).toEqual([["/api/company", "POST", { name: "Company", country: "PE" }]]);
});

test("rejects bad drafts and invalid responses", async () => {
  let calls = 0;
  const request = createCompanyApi(async () => { calls++; return ok({ companyId: "bad" }); });
  expect(await createCompany({ name: " ", country: "PE" }, request)).toMatchObject({ success: false, error: { code: "INVALID_COMPANY" } });
  expect(calls).toBe(0);
  expect(await createCompany({ name: "Company", country: "PE" }, request)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

test("HTTP adapter accepts 201 and 200, rejects malformed and protocol errors", async () => {
  const session = { getToken: async () => ok("jwt"), renewToken: async () => ok("jwt-2"), generation: () => 1 };
  for (const status of [201, 200]) {
    const request = createCompanyApi(createApiClient(session, async () => Response.json({ companyId: id }, { status })));
    expect(await createCompany({ name: "Company", country: "PE" }, request)).toEqual(ok({ companyId: id }));
  }
  const malformed = createCompanyApi(createApiClient(session, async () => new Response("not json", { status: 201 })));
  expect(await createCompany({ name: "Company", country: "PE" }, malformed)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  const rejected = createCompanyApi(createApiClient(session, async () => Response.json({ code: "INVALID_COMPANY", error: "invalid" }, { status: 400 })));
  expect(await createCompany({ name: "Company", country: "PE" }, rejected)).toMatchObject({ success: false, error: { code: "INVALID_COMPANY" } });
});
