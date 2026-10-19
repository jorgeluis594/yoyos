import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import type { EventBusError } from "@core/src/shared/events/application/contracts";
import type { ProductImageChanged } from "@core/src/features/products/application/events";
import type { ProductId } from "@core/src/features/products/domain/product";

const productImageChangedSchema = z.strictObject({ companyId: z.uuid(), productId: z.uuid() });

export function parseProductImageChanged(input: unknown): Result<ProductImageChanged, EventBusError> {
  const parsed = productImageChangedSchema.safeParse(input);
  return parsed.success
    ? ok({ companyId: parsed.data.companyId as CompanyId, productId: parsed.data.productId as ProductId })
    : err({ code: "INVALID_EVENT", message: "Invalid product image changed payload" });
}
