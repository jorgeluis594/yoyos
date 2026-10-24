import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import {
  offeredPaymentSettings, parsePaymentSettingsInput,
  type CompanyId, type CompanyPaymentSettings, type DigitalWalletSetting, type ImageId, type OfferedPaymentSetting, type PaymentSettingsError, type PaymentSettingsInput, type QrCheckFailure,
} from "@core/src/features/companies/domain/payment-settings";

export type SettingsFailure = PaymentSettingsError | Readonly<{ code: "INVALID_IMAGE" | "INVALID_STORED_DATA" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type SavePaymentSettingsError = SettingsFailure | Readonly<{ code: "INVALID_PAYMENT_QR" | "QR_CHECK_UNAVAILABLE"; message: string }>;
export type QrCheckContext = Readonly<{ companyId: CompanyId; stage: "choose" | "save" }>;
type SettingsDependencies = Readonly<{
  load: (companyId: CompanyId) => Promise<Result<readonly CompanyPaymentSettings[], SettingsFailure>>;
  save: (companyId: CompanyId, settings: readonly CompanyPaymentSettings[]) => Promise<Result<null, SettingsFailure>>;
  imageAvailable: (companyId: CompanyId, imageId: ImageId) => Promise<Result<boolean, SettingsFailure>>;
  detectQrCode: (imageId: ImageId, context: QrCheckContext) => Promise<Result<"qr_found" | "no_qr", QrCheckFailure>>;
}>;

export async function getOfferedPaymentSettings(companyId: CompanyId, deps: Pick<SettingsDependencies, "load">): Promise<Result<readonly OfferedPaymentSetting[], SettingsFailure>> {
  const loaded = await deps.load(companyId);
  return loaded.success ? ok(offeredPaymentSettings(loaded.data)) : loaded;
}

export function getPaymentConfiguration(companyId: CompanyId, deps: Pick<SettingsDependencies, "load">) {
  return deps.load(companyId);
}

async function checkImages(companyId: CompanyId, images: readonly ImageId[], deps: Pick<SettingsDependencies, "imageAvailable">): Promise<Result<null, SettingsFailure>> {
  for (const imageId of images) {
    const available = await deps.imageAvailable(companyId, imageId);
    if (!available.success) return available;
    if (!available.data) return err({ code: "INVALID_IMAGE", message: "Payment image is unavailable" });
  }
  return ok(null);
}

const imagesOf = (settings: readonly PaymentSettingsInput[]) => settings.flatMap((setting) => setting.imageId ? [setting.imageId] : []);

export async function savePaymentSettings(companyId: CompanyId, value: unknown, deps: SettingsDependencies): Promise<Result<readonly CompanyPaymentSettings[], SavePaymentSettingsError>> {
  const parsed = parsePaymentSettingsInput(value);
  if (!parsed.success) return parsed;
  const available = await checkImages(companyId, imagesOf(parsed.data), deps);
  if (!available.success) return available;
  const current = await deps.load(companyId);
  if (!current.success) return current;
  const storedWallet = current.data.find((setting): setting is DigitalWalletSetting => setting.method === "digital_wallet");
  const next: CompanyPaymentSettings[] = [];
  for (const setting of parsed.data) {
    if (setting.method === "bank_transfer") { next.push(setting); continue; }
    // Images are immutable per id, so a verified image id stays a fact about the id and is not read again.
    const reused = storedWallet?.qr.status === "verified" && storedWallet.qr.imageId === setting.imageId;
    if (!reused) {
      const detected = await deps.detectQrCode(setting.imageId, { companyId, stage: "save" });
      if (!detected.success) return err({ code: "QR_CHECK_UNAVAILABLE", message: detected.error.message });
      if (detected.data === "no_qr") return err({ code: "INVALID_PAYMENT_QR", message: "Image does not hold a QR code" });
    }
    next.push({ method: "digital_wallet", provider: setting.provider, holder: setting.holder, qr: { status: "verified", imageId: setting.imageId } });
  }
  const saved = await deps.save(companyId, next);
  return saved.success ? ok(next) : saved;
}

export async function checkPaymentQr(companyId: CompanyId, input: Readonly<{ imageId: ImageId }>, deps: Pick<SettingsDependencies, "imageAvailable" | "detectQrCode">): Promise<Result<"verified" | "not_a_qr", SettingsFailure | QrCheckFailure>> {
  const available = await checkImages(companyId, [input.imageId], deps);
  if (!available.success) return available;
  const detected = await deps.detectQrCode(input.imageId, { companyId, stage: "choose" });
  if (!detected.success) return detected;
  return ok(detected.data === "qr_found" ? "verified" : "not_a_qr");
}
