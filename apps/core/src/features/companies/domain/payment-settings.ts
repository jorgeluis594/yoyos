import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type ImageId = string & { readonly __brand: "ImageId" };
export type CompanyId = string & { readonly __brand: "CompanyId" };

const text = z.string().trim().min(1);
const imageId = z.uuid().transform((value) => value as ImageId);
const bank = z.strictObject({ method: z.literal("bank_transfer"), bank: text, holder: text,
  accountNumber: text.nullable(), cci: text.nullable(), imageId: imageId.nullable() })
  .refine((value) => value.accountNumber !== null || value.cci !== null);
const walletInput = z.strictObject({ method: z.literal("digital_wallet"), provider: text, holder: text, imageId });
const walletQr = z.strictObject({ status: z.literal("verified"), imageId });
const verifiedWallet = z.strictObject({ method: z.literal("digital_wallet"), provider: text, holder: text, qr: walletQr });
// The only other accepted stored shape: a wallet saved before this version has no qr and is read as unchecked (see docs).
const preVersionWallet = z.strictObject({ method: z.literal("digital_wallet"), provider: text, holder: text, imageId: imageId.nullable() })
  .transform(({ imageId: image, ...rest }) => ({ ...rest, qr: { status: "unchecked" as const, imageId: image } }));
const oneSettingPerMethod = (value: readonly { method: string }[]) => new Set(value.map((setting) => setting.method)).size === value.length;
const input = z.array(z.union([walletInput, bank])).max(2).refine(oneSettingPerMethod);
const stored = z.array(z.union([verifiedWallet, preVersionWallet, bank])).max(2).refine(oneSettingPerMethod);

export type WalletQr =
  | Readonly<{ status: "verified"; imageId: ImageId }>
  | Readonly<{ status: "unchecked"; imageId: ImageId | null }>; // only from a wallet saved before this version
export type DigitalWalletSetting = Readonly<{ method: "digital_wallet"; provider: string; holder: string; qr: WalletQr }>;
export type BankTransferSetting = z.infer<typeof bank>;
export type CompanyPaymentSettings = DigitalWalletSetting | BankTransferSetting;
export type PaymentSettingsInput = z.infer<typeof walletInput> | BankTransferSetting;
export type OfferedPaymentSetting =
  | Readonly<{ method: "digital_wallet"; provider: string; holder: string; imageId: ImageId }>
  | BankTransferSetting;
export type PaymentSettingsError = Readonly<{ code: "INVALID_PAYMENT_SETTINGS"; message: string }>;
export type QrCheckFailure = Readonly<{ code: "QR_CHECK_UNAVAILABLE" | "INVALID_IMAGE"; message: string }>;

const invalid = (): Result<never, PaymentSettingsError> => err({ code: "INVALID_PAYMENT_SETTINGS", message: "Invalid payment settings" });

export function parsePaymentSettingsInput(value: unknown): Result<readonly PaymentSettingsInput[], PaymentSettingsError> {
  const parsed = input.safeParse(value);
  return parsed.success ? ok(parsed.data) : invalid();
}

export function parseStoredPaymentSettings(value: unknown): Result<readonly CompanyPaymentSettings[], PaymentSettingsError> {
  const parsed = stored.safeParse(value);
  return parsed.success ? ok(parsed.data) : invalid();
}

export function offeredPaymentSettings(settings: readonly CompanyPaymentSettings[]): readonly OfferedPaymentSetting[] {
  return settings.flatMap((setting): OfferedPaymentSetting[] => {
    if (setting.method === "bank_transfer") return [setting];
    return setting.qr.status === "verified"
      ? [{ method: "digital_wallet", provider: setting.provider, holder: setting.holder, imageId: setting.qr.imageId }]
      : [];
  });
}
