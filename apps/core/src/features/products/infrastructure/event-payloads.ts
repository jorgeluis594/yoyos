import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import type { EventBusError } from "@core/src/shared/events/application/contracts";
import type { ProductPhotosAdded } from "@core/src/features/products/application/events";
import type { ProductId } from "@core/src/features/products/domain/product";

const productPhotosAddedSchema = z.strictObject({ companyId: z.uuid(), productId: z.uuid() });

export function parseProductPhotosAdded(input: unknown): Result<ProductPhotosAdded, EventBusError> {
  const parsed = productPhotosAddedSchema.safeParse(input);
  return parsed.success
    ? ok({ companyId: parsed.data.companyId as CompanyId, productId: parsed.data.productId as ProductId })
    : err({ code: "INVALID_EVENT", message: "Invalid product photos added payload" });
}
