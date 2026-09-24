import { z } from "zod";
import { currencies } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CreateInput } from "@core/src/features/products/application/create";
import type { UpdateInput } from "@core/src/features/products/application/update";

const variant = z.strictObject({
  attributes: z.record(z.string(), z.string()),
  sku: z.string().optional(),
  salePrice: z.number(),
  purchasePrice: z.number().optional(),
  initialStock: z.number().optional(),
});
const create = z.strictObject({
  name: z.string(),
  description: z.string().optional(),
  imageId: z.uuid().optional(),
  currency: z.enum(currencies),
  variants: z.tuple([variant], variant),
});
const updateVariant = z.strictObject({
  id: z.uuid(),
  sku: z.string().nullable().optional(),
  salePrice: z.number().optional(),
  purchasePrice: z.number().nullable().optional(),
});
const update = z.strictObject({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  imageId: z.uuid().nullable().optional(),
  variants: z.array(updateVariant).optional(),
});

export type InputIssue = Readonly<{ field: string; reason: "INVALID_TYPE" | "UNKNOWN_FIELD" | "INVALID_ID" }>;
export type InputError =
  | Readonly<{ code: "MALFORMED_JSON"; message: string; issues: readonly [] }>
  | Readonly<{ code: "INVALID_INPUT"; message: string; issues: readonly InputIssue[] }>;

function issues(error: z.ZodError): readonly InputIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "form",
    reason: issue.code === "unrecognized_keys" ? "UNKNOWN_FIELD" : issue.code === "invalid_format" ? "INVALID_ID" : "INVALID_TYPE",
  }));
}

function parse<T>(schema: z.ZodType, text: string, message: string): Result<T, InputError> {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return err({ code: "MALFORMED_JSON", message: "Invalid JSON", issues: [] }); }
  const result = schema.safeParse(raw);
  if (!result.success) return err({ code: "INVALID_INPUT", message, issues: issues(result.error) });
  return ok(result.data as T);
}

export function parseCreateJson(text: string): Result<CreateInput, InputError> {
  return parse<CreateInput>(create, text, "Invalid product input");
}

export function parseUpdateJson(text: string): Result<UpdateInput, InputError> {
  return parse<UpdateInput>(update, text, "Invalid product update");
}
