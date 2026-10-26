import type { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CreateProductRequest, UpdateProductRequest } from "@shared/contracts/products";
import type { CreateInput } from "@core/src/features/products/application/create";
import type { UpdateInput } from "@core/src/features/products/application/update";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

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

/** Parses a JSON body with one of the shared request schemas, for the web actions that do not go through Express. */
export function parseRequestJson<S extends z.ZodType>(schema: S, text: string, message: string): Result<z.output<S>, InputError> {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return err({ code: "MALFORMED_JSON", message: "Invalid JSON", issues: [] }); }
  const result = schema.safeParse(raw);
  if (!result.success) return err({ code: "INVALID_INPUT", message, issues: issues(result.error) });
  return ok(result.data);
}

export function toCreateInput(request: CreateProductRequest): CreateInput {
  const [first, ...rest] = request.variants;
  return {
    id: request.id as ProductId, name: request.name, description: request.description, imageId: request.imageId as ImageId | null,
    currency: request.currency, options: request.options, variants: [first, ...rest],
  };
}

export function toUpdateInput(request: UpdateProductRequest): UpdateInput {
  return {
    ...(request.name === undefined ? {} : { name: request.name }),
    ...(request.description === undefined ? {} : { description: request.description }),
    ...(request.imageId === undefined ? {} : { imageId: request.imageId === null ? null : request.imageId as ImageId }),
    ...(request.variants === undefined ? {} : { variants: request.variants.map((variant) => ({ ...variant, id: variant.id as VariantId })) }),
  };
}
