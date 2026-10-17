import { z } from "zod";
import { maxCartLines, parseCartQuantity, type CartLine } from "@core/src/features/orders/domain/catalog-order";
import type { CompanyId, OrderId } from "@core/src/features/orders";
import type { VariantId } from "@core/src/features/products/domain/product";

export const catalogCompanyIdSchema = z.uuid().transform((value) => value as CompanyId);

const variantId = z.uuid().transform((value) => value as VariantId);
/** `?v=<id>,<id>`: the variants of the cart whose price and availability are refreshed. */
export const cartRefreshSchema = z.string().transform((value) => value.split(",").filter(Boolean))
  .pipe(z.array(variantId).min(1).max(maxCartLines));

const cartLine = z.strictObject({ variantId, quantity: z.number().transform((value, context) => {
  const parsed = parseCartQuantity(value);
  if (parsed.success) return parsed.data;
  context.addIssue({ code: "custom", message: parsed.error.message });
  return z.NEVER;
}) });
export const continueToCheckoutSchema = z.strictObject({
  orderId: z.uuid().transform((value) => value as OrderId),
  lines: z.array(cartLine).min(1).max(maxCartLines).refine((lines: readonly CartLine[]) =>
    new Set(lines.map((line) => line.variantId)).size === lines.length, "One line per variant"),
});
