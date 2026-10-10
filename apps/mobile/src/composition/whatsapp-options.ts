import { err, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import type { WhatsAppOptions } from "@mobile/modules/whatsapp/types";

const MIB = 1024 * 1024;
export const DEFAULT_RECOVERY_BUFFER_MIB = 10;
export const DEFAULT_IMAGE_STORAGE_MIB = 50;

export const RECOVERY_BUFFER_VARIABLE = "EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB";

export type WhatsAppConfigurationError = AppError & { readonly code: "INVALID_WHATSAPP_RECOVERY_BUFFER_MIB" };

/** Effective budgets in bytes, always explicit: the native layers never apply or read a default of their own. */
export type EffectiveWhatsAppOptions = Required<WhatsAppOptions>;

const invalid = (): Result<never, WhatsAppConfigurationError> =>
  err({ code: "INVALID_WHATSAPP_RECOVERY_BUFFER_MIB", message: `${RECOVERY_BUFFER_VARIABLE} must be a positive whole number of MiB` });

/**
 * Converts the recovery buffer setting (MiB, as bundled by Expo) into bytes. `undefined` is the only
 * value that selects the default; anything that is defined and not a canonical positive integer whose
 * byte count is a safe integer fails, so a typo can never silently run with another budget.
 */
export function resolveRecoveryBufferBytes(raw: string | undefined): Result<number, WhatsAppConfigurationError> {
  if (raw === undefined) return ok(DEFAULT_RECOVERY_BUFFER_MIB * MIB);
  if (!/^[1-9][0-9]*$/.test(raw)) return invalid();
  const bytes = Number(raw) * MIB;
  return Number.isSafeInteger(bytes) ? ok(bytes) : invalid();
}

export function resolveWhatsAppOptions(recoveryBufferMib: string | undefined): Result<EffectiveWhatsAppOptions, WhatsAppConfigurationError> {
  const recovery = resolveRecoveryBufferBytes(recoveryBufferMib);
  if (!recovery.success) return recovery;
  return ok({ maxRecoveryBufferBytes: recovery.data, maxImageStorageBytes: DEFAULT_IMAGE_STORAGE_MIB * MIB });
}
