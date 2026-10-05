import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

const text = z.string().trim().min(1);
const imageId = z.uuid().nullable();
const wallet = z.strictObject({ method: z.literal("digital_wallet"), provider: text, holder: text, imageId });
const bank = z.strictObject({ method: z.literal("bank_transfer"), bank: text, holder: text,
  accountNumber: text.nullable(), cci: text.nullable(), imageId })
  .refine((value) => value.accountNumber !== null || value.cci !== null);
const settings = z.array(z.union([wallet, bank])).max(2)
  .refine((value) => new Set(value.map((setting) => setting.method)).size === value.length);

export type CompanyPaymentSettings = z.infer<typeof settings>[number];
export type PaymentSettingsError = Readonly<{ code: "INVALID_PAYMENT_SETTINGS"; message: string }>;

export function parsePaymentSettings(value: unknown): Result<readonly CompanyPaymentSettings[], PaymentSettingsError> {
  const parsed = settings.safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_PAYMENT_SETTINGS", message: "Invalid payment settings" });
}
