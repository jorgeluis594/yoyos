import { z } from "zod";
import { currencies } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CreateInput } from "@core/src/features/products/application/create";

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

export type InputIssue = Readonly<{ field: string; reason: "INVALID_TYPE" | "UNKNOWN_FIELD" | "INVALID_ID" }>;
export type InputError =
  | Readonly<{ code: "MALFORMED_JSON"; message: string; issues: readonly [] }>
  | Readonly<{ code: "INVALID_INPUT"; message: string; issues: readonly InputIssue[] }>;

export function parseCreateJson(text: string): Result<CreateInput, InputError> {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return err({ code: "MALFORMED_JSON", message: "Invalid JSON", issues: [] }); }
  const result = create.safeParse(raw);
  if (!result.success) return err({
    code: "INVALID_INPUT", message: "Invalid product input",
    issues: result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "form",
      reason: issue.code === "unrecognized_keys" ? "UNKNOWN_FIELD" : issue.code === "invalid_format" ? "INVALID_ID" : "INVALID_TYPE",
    })),
  });
  return ok(result.data as CreateInput);
}
