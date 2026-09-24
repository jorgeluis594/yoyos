import { expect, test } from "vitest";
import { createCompanyAdapter, createRegisterAccountAdapter } from "@core/src/features/users/infrastructure/register-adapters";

const account = { name: "Ana", email: "ana@example.com", password: "password123" };
const company = { name: "Tienda", country: "PE" as const };

test("registration rejects malformed Better Auth responses", async () => {
  expect(await createRegisterAccountAdapter(async () => ({ data: { user: { id: "" } }, error: null }))(account))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(await createRegisterAccountAdapter(async () => ({ data: null, error: null }))(account))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});

test("company adapter validates success and error bodies", async () => {
  const invalidSuccess = createCompanyAdapter(async () => new Response(JSON.stringify({ companyId: "bad-id" }), { status: 201 }));
  expect(await invalidSuccess(company)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  const invalidFailure = createCompanyAdapter(async () => new Response("unavailable", { status: 503 }));
  expect(await invalidFailure(company)).toMatchObject({ success: false, error: { code: "INVALID_ERROR_RESPONSE" } });
  const validFailure = createCompanyAdapter(async () => new Response(JSON.stringify({ error: "Unavailable", code: "SERVICE_UNAVAILABLE" }), { status: 503 }));
  expect(await validFailure(company)).toMatchObject({ success: false, error: { code: "REJECTED" } });
});
