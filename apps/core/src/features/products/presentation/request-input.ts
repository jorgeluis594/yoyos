import type { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CreateProductRequest, SaveProductRequest } from "@shared/contracts/products";
import type { CreateInput } from "@core/src/features/products/application/create";
import type { SaveProductInput } from "@core/src/features/products/application/save-product";
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

/** Validates an already parsed body with one of the shared request schemas. */
export function parseRequestValue<S extends z.ZodType>(schema: S, raw: unknown, message: string): Result<z.output<S>, InputError> {
  const result = schema.safeParse(raw);
  if (!result.success) return err({ code: "INVALID_INPUT", message, issues: issues(result.error) });
  return ok(result.data);
}

/** Parses a JSON body with one of the shared request schemas, for the web actions that do not go through Express. */
export function parseRequestJson<S extends z.ZodType>(schema: S, text: string, message: string): Result<z.output<S>, InputError> {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return err({ code: "MALFORMED_JSON", message: "Invalid JSON", issues: [] }); }
  return parseRequestValue(schema, raw, message);
}

export function toCreateInput(request: CreateProductRequest): CreateInput {
  const [first, ...rest] = request.variants;
  return {
    id: request.id as ProductId, name: request.name, description: request.description, photoIds: request.photoIds as ImageId[],
    currency: request.currency, options: request.options, variants: [first, ...rest],
  };
}

export function toSaveInput(productId: ProductId, request: SaveProductRequest): SaveProductInput {
  return {
    productId, structureVersion: request.structureVersion, name: request.name, description: request.description,
    ...request.photoIds === undefined ? {} : { photoIds: request.photoIds as ImageId[] },
    options: request.options,
    variants: request.variants.map((variant) => ({ ...variant, id: variant.id as VariantId })),
    newVariants: request.newVariants,
    deletedVariantIds: request.deletedVariantIds as VariantId[],
  };
}
