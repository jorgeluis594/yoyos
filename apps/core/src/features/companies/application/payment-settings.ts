import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { parsePaymentSettings, type CompanyPaymentSettings, type PaymentSettingsError } from "@core/src/features/companies/domain/payment-settings";

type SettingsFailure = PaymentSettingsError | Readonly<{ code: "INVALID_IMAGE" | "INVALID_STORED_DATA" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
type SettingsDependencies = Readonly<{
  load: (companyId: string) => Promise<Result<readonly CompanyPaymentSettings[], SettingsFailure>>;
  save: (companyId: string, settings: readonly CompanyPaymentSettings[]) => Promise<Result<null, SettingsFailure>>;
  imageAvailable: (companyId: string, imageId: string) => Promise<Result<boolean, SettingsFailure>>;
}>;

export function getPaymentSettings(companyId: string, deps: Pick<SettingsDependencies, "load">) {
  return deps.load(companyId);
}

export async function savePaymentSettings(companyId: string, value: unknown, deps: SettingsDependencies): Promise<Result<readonly CompanyPaymentSettings[], SettingsFailure>> {
  const parsed = parsePaymentSettings(value);
  if (!parsed.success) return parsed;
  for (const setting of parsed.data) {
    if (!setting.imageId) continue;
    const available = await deps.imageAvailable(companyId, setting.imageId);
    if (!available.success) return available;
    if (!available.data) return err({ code: "INVALID_IMAGE", message: "Payment image is unavailable" });
  }
  const saved = await deps.save(companyId, parsed.data);
  return saved.success ? ok(parsed.data) : saved;
}
