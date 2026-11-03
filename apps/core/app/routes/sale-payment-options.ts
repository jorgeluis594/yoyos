import { paymentSettingsResponseSchema } from "@shared/contracts/payment-settings";
import { companyPaymentSettings } from "@core/src/features/companies";
import { catalogPaymentOptions, paymentOptionsOf, type PaymentOptions } from "@core/src/features/orders/presentation/payment-options";

/** The payment methods a sale offers; unreadable settings never block recording a payment, so they offer the whole catalog. */
export async function salePaymentOptions(companyId: string): Promise<PaymentOptions> {
  const result = await companyPaymentSettings.getConfiguration(companyId);
  if (!result.success) return catalogPaymentOptions;
  const parsed = paymentSettingsResponseSchema.safeParse({ settings: result.data });
  return parsed.success ? paymentOptionsOf(parsed.data.settings) : catalogPaymentOptions;
}
