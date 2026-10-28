import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId } from "@core/src/shared/infrastructure/persistance";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { readImageBytes } from "@core/src/shared/images";
import { readQrCodes } from "@core/src/shared/images/infrastructure/qr-code-reader";
import { checkPaymentQr, getOfferedPaymentSettings, getPaymentConfiguration, savePaymentSettings, type QrCheckContext } from "@core/src/features/companies/application/payment-settings";
import type { CompanyId, ImageId, QrCheckFailure } from "@core/src/features/companies/domain/payment-settings";
import { loadPaymentSettings, persistPaymentSettings } from "@core/src/features/companies/infrastructure/payment-settings-repository";
import { createQrCheckLimiter } from "@core/src/features/companies/infrastructure/qr-check-limiter";

const qrCheckEnvSchema = z.object({
  PAYMENT_QR_CHECK_SLOTS: z.coerce.number().int().positive().default(2),
  PAYMENT_QR_CHECK_READ_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});
const qrCheckConfig = qrCheckEnvSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")));
// One limiter for the whole process: choose-time and save checks share the same slots.
const qrCheckLimiter = createQrCheckLimiter(qrCheckConfig.PAYMENT_QR_CHECK_SLOTS);

type QrCheckLogged = Readonly<{ outcome: "qr_found" | "no_qr" | "unavailable"; durationMs: number | null }>;
const logChecked = (context: QrCheckContext, { outcome, durationMs }: QrCheckLogged) =>
  log.info({ event: "payment_qr_checked", companyId: context.companyId, stage: context.stage, outcome, durationMs }, "payment_qr_checked");
type UnavailableCode = "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_STORAGE_CONFIG_ERROR" | "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_TIMEOUT" | "QR_READER_UNAVAILABLE" | "QR_CHECK_BUSY";
function unavailable(context: QrCheckContext, errorCode: UnavailableCode, durationMs: number | null): Result<never, QrCheckFailure> {
  log.warn({ event: "payment_qr_check_unavailable", companyId: context.companyId, stage: context.stage, errorCode }, "payment_qr_check_unavailable");
  logChecked(context, { outcome: "unavailable", durationMs });
  return err({ code: "QR_CHECK_UNAVAILABLE", message: "QR check is unavailable" });
}

async function readAndDecode(imageId: ImageId, context: QrCheckContext): Promise<Result<"qr_found" | "no_qr", QrCheckFailure>> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const image = await readImageBytes(imageId, { signal: AbortSignal.timeout(qrCheckConfig.PAYMENT_QR_CHECK_READ_TIMEOUT_MS) });
  if (!image.success) {
    if (image.error.code === "IMAGE_NOT_FOUND") return err({ code: "INVALID_IMAGE", message: "Payment image is unavailable" });
    return unavailable(context, image.error.code === "IMAGE_STORAGE_UNAVAILABLE" ? image.error.storageCode : image.error.code, elapsed());
  }
  const read = await readQrCodes(image.data);
  if (!read.success && read.error.code === "QR_READER_UNAVAILABLE") return unavailable(context, "QR_READER_UNAVAILABLE", elapsed());
  // An image the reader cannot decode holds no QR for the seller's purposes.
  const outcome = read.success && read.data.length > 0 ? "qr_found" : "no_qr";
  logChecked(context, { outcome, durationMs: elapsed() });
  return ok(outcome);
}

/** The only QR check of the process: bounded by the shared slots, so a busy answer never reads the image. */
export async function detectQrCode(imageId: ImageId, context: QrCheckContext): Promise<Result<"qr_found" | "no_qr", QrCheckFailure>> {
  const run = await qrCheckLimiter.run(() => readAndDecode(imageId, context));
  return run.busy ? unavailable(context, "QR_CHECK_BUSY", null) : run.value;
}

const dependencies = { load: loadPaymentSettings, save: persistPaymentSettings, detectQrCode,
  imageAvailable: async (companyId: string, imageId: string) => {
    if (getCompanyId() !== companyId) throw new Error("Payment settings company differs from tenant context");
    const found = await imageRepository.find(imageId);
    return found.success ? { success: true as const, data: found.data !== null } : found;
  } };

export const companyPaymentSettings = {
  /** Offered methods only: the shape buyers and the checkout preview may see. */
  get: (companyId: string) => getOfferedPaymentSettings(companyId as CompanyId, dependencies),
  getConfiguration: (companyId: string) => getPaymentConfiguration(companyId as CompanyId, dependencies),
  checkQr: (companyId: string, imageId: string) => checkPaymentQr(companyId as CompanyId, { imageId: imageId as ImageId }, dependencies),
  save: async (companyId: string, userId: string, value: unknown) => {
    const reads: number[] = [];
    const measured: typeof detectQrCode = async (imageId, context) => {
      const startedAt = performance.now();
      const detected = await detectQrCode(imageId, context);
      reads.push(Math.round(performance.now() - startedAt));
      return detected;
    };
    const result = await savePaymentSettings(companyId as CompanyId, value, { ...dependencies, detectQrCode: measured });
    if (result.success) {
      const hasWallet = result.data.some((setting) => setting.method === "digital_wallet");
      log.info({ event: "company_payment_settings_saved", companyId, userId, methodsCount: result.data.length,
        walletQr: !hasWallet ? "none" : reads.length > 0 ? "read" : "reused", qrDurationMs: reads[0] ?? null }, "company_payment_settings_saved");
    }
    return result;
  },
};
