import express from "express";
import type { Request, Response } from "express";
import { changeCombinationRequestSchema, changeVariantStatusRequestSchema, updateVariantRequestSchema } from "@shared/contracts/products";
import { apiError } from "@core/src/shared/infrastructure/api-auth-middleware";
import { productVariantActions } from "@core/src/features/products/product-variant-actions";
import { handleUnexpected, productIdFrom, sendInvalid, sendOperationError, zodIssues } from "@core/src/features/products/presentation/api-errors";
import { toProductDetailResponse } from "@core/src/features/products/presentation/product-presenter";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

/** Mounted at `/api/products/:productId/variants`. */
export const variantRoutes = express.Router({ mergeParams: true });

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(request: Request, response: Response): { productId: ProductId; variantId: VariantId } | null {
  const productId = productIdFrom(request, response);
  if (!productId) return null;
  const variantId = request.params.variantId;
  if (typeof variantId !== "string" || !uuid.test(variantId)) {
    sendInvalid(response, "variantId", "INVALID_FORMAT");
    return null;
  }
  return { productId, variantId: variantId as VariantId };
}

type Outcome = Awaited<ReturnType<typeof productVariantActions.delete>>;

function answer(response: Response, result: Outcome) {
  if (result.success) return response.json(toProductDetailResponse(result.data));
  if (result.error.code === "IMAGE_NOT_FOUND") return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
  return sendOperationError(response, result.error);
}

async function run(request: Request, response: Response, action: (target: { productId: ProductId; variantId: VariantId }) => Promise<Outcome>) {
  const target = ids(request, response);
  if (!target) return;
  try {
    return answer(response, await action(target));
  } catch (error) {
    return handleUnexpected(response, error);
  }
}

variantRoutes.patch("/:variantId", async (request, response) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = updateVariantRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid variant input", zodIssues(parsed.error));
  return run(request, response, (target) => productVariantActions.update({ ...target, ...parsed.data }));
});

variantRoutes.put("/:variantId/combination", async (request, response) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = changeCombinationRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid combination input", zodIssues(parsed.error));
  return run(request, response, (target) => productVariantActions.changeCombination({ ...target, values: parsed.data.values }));
});

variantRoutes.put("/:variantId/status", async (request, response) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = changeVariantStatusRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid status input", zodIssues(parsed.error));
  return run(request, response, (target) => productVariantActions.changeStatus({ ...target, status: parsed.data.status }));
});

variantRoutes.delete("/:variantId", (request, response) => run(request, response, (target) => productVariantActions.delete(target)));
