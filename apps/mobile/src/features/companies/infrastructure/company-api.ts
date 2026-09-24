import { createCompanyRequestSchema, createCompanyResponseSchema, type CreateCompanyResponse } from "@shared/contracts/registration";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@/shared/application/transport-error";
import type { CompanyDraft, CompanyRequestError } from "../application/create-company";

export function createCompanyApi(request: (path: string, init: RequestInit) => Promise<Result<unknown, TransportError>>) {
  return async function sendCompany(input: CompanyDraft): Promise<Result<CreateCompanyResponse, CompanyRequestError>> {
    const body = createCompanyRequestSchema.safeParse(input);
    if (!body.success) return err({ code: "INVALID_COMPANY", message: "Company name or country is invalid" });
    const response = await request("/api/company", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data),
    });
    if (!response.success) return response;
    const parsed = createCompanyResponseSchema.safeParse(response.data);
    return parsed.success ? ok(parsed.data) : err({ code: "INVALID_RESPONSE", message: "Server returned invalid company data" });
  };
}
