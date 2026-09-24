import assert from "node:assert/strict";
import { test } from "node:test";
import { currentAccessDtoSchema, createCompanyRequestSchema, createCompanyResponseSchema, apiErrorResponseSchema } from "./registration.ts";

const companyId = "123e4567-e89b-42d3-a456-426614174000";
const ready = { status: "ready", user: { id: "opaque-user", name: "Ana", companyId }, company: { id: companyId, name: "Tienda", country: "PE" } };

test("access contracts distinguish pending and ready and enforce the company link", () => {
  assert(currentAccessDtoSchema.safeParse({ status: "company_required", user: { id: "u", name: "Ana", companyId: null }, company: null }).success);
  assert(currentAccessDtoSchema.safeParse(ready).success);
  assert(!currentAccessDtoSchema.safeParse({ ...ready, company: { ...ready.company, id: crypto.randomUUID() } }).success);
  assert(!currentAccessDtoSchema.safeParse({ ...ready, company: { ...ready.company, country: "ZZ" } }).success);
  assert(!currentAccessDtoSchema.safeParse({ ...ready, user: { ...ready.user, companyId: "bad" } }).success);
  assert(!currentAccessDtoSchema.safeParse({ status: "company_required", user: { id: "u", name: "Ana", companyId: null }, company: undefined }).success);
  assert.deepEqual(currentAccessDtoSchema.parse({ ...ready, token: "ignored", company: { ...ready.company, secret: "ignored" } }), ready);
});

test("company and error contracts validate JSON fields", () => {
  assert(createCompanyRequestSchema.safeParse({ name: "Tienda", country: "PE" }).success);
  assert(!createCompanyRequestSchema.safeParse({ name: "Tienda", country: "ZZ" }).success);
  assert.deepEqual(createCompanyRequestSchema.parse({ name: "Tienda", country: "PE", userId: "other" }), { name: "Tienda", country: "PE" });
  assert(createCompanyResponseSchema.safeParse({ companyId }).success);
  assert(!createCompanyResponseSchema.safeParse({ companyId: "not-a-uuid" }).success);
  assert(apiErrorResponseSchema.safeParse({ error: "Unauthorized", code: "UNAUTHENTICATED" }).success);
  assert(!apiErrorResponseSchema.safeParse({ error: "Bad", code: "OTHER" }).success);
});
