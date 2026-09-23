import * as Crypto from "expo-crypto";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { validateCompany } from "../domain/company";
import type { Company, CompanyError, CompanyInput } from "../domain/company";

export function generateCompany(input: CompanyInput): Result<Company, CompanyError> {
  const validation = validateCompany(input);
  if (!validation.success) return err(validation.error);

  return ok({ id: input.id ?? Crypto.randomUUID(), name: input.name, country: input.country });
}
