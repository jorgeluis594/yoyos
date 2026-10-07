import { z } from "zod";
import { err, ok } from "@shared/functional";
import { currencies, type Currency, type Money } from "@shared/money";
import type { Result } from "@shared/result";

export type DeliveryPriceError = Readonly<{ code: "INVALID_DELIVERY_RATE"; message: string }>;

const priceSchema = z.strictObject({
  amount: z.number().finite().nonnegative().max(9999999999999.99)
    .refine(value => /^\d+(?:\.\d{1,2})?$/.test(String(value))),
  currency: z.enum(currencies),
});

export function parseDeliveryPrice(value: unknown, currency: Currency): Result<Money, DeliveryPriceError> {
  const parsed = priceSchema.safeParse(value);
  return parsed.success && parsed.data.currency === currency
    ? ok(parsed.data)
    : err({ code: "INVALID_DELIVERY_RATE", message: "Delivery price must use the business currency and a nonnegative amount with at most two decimals within the order range" });
}
