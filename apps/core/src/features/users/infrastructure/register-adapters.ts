import { apiErrorResponseSchema, createCompanyResponseSchema, type CreateCompanyRequest } from "@shared/contracts/registration";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { RegisterDependencies, RegisterError } from "@core/src/features/users/application/register";
import { z } from "zod";

type AdapterError = Omit<RegisterError, "step">;
type Account = Parameters<RegisterDependencies["registerAccount"]>[0];
const authResultSchema = z.object({
  error: z.object({ message: z.string().optional() }).nullable(),
  data: z.object({ user: z.object({ id: z.string().min(1) }) }).nullable(),
});

export function createRegisterAccountAdapter(signUp: (account: Account) => Promise<unknown>): RegisterDependencies["registerAccount"] {
  return async (account): Promise<Result<void, AdapterError>> => {
    try {
      const result = authResultSchema.safeParse(await signUp(account));
      if (!result.success || !result.data.data && !result.data.error) return err({ code: "INVALID_RESPONSE", message: "Invalid authentication response" });
      if (result.data.error) return err({ code: "REJECTED", message: result.data.error.message ?? "No se pudo crear la cuenta." });
      return ok(undefined);
    } catch {
      return err({ code: "NETWORK_ERROR", message: "Unable to connect" });
    }
  };
}

export function createCompanyAdapter(send: typeof fetch): RegisterDependencies["createCompany"] {
  return async (company: CreateCompanyRequest): Promise<Result<void, AdapterError>> => {
    try {
      const response = await send("/api/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      });
      let body: unknown;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok) return apiErrorResponseSchema.safeParse(body).success
        ? err({ code: "REJECTED", message: "Company creation failed" })
        : err({ code: "INVALID_ERROR_RESPONSE", message: "Invalid company error response" });
      return createCompanyResponseSchema.safeParse(body).success
        ? ok(undefined)
        : err({ code: "INVALID_RESPONSE", message: "Invalid company response" });
    } catch {
      return err({ code: "NETWORK_ERROR", message: "Unable to connect" });
    }
  };
}
