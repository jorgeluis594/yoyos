import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type ConfiguredDispatchSender = Readonly<{ name: string | null; phone: string | null }>;
export type EffectiveDispatchSender = Readonly<{ name: string; phone: string | null }>;
export type DispatchSenderState = Readonly<{ configured: ConfiguredDispatchSender; effective: EffectiveDispatchSender }>;
export type InvalidDispatchSender = Readonly<{ code: "INVALID_DISPATCH_SENDER"; message: string }>;

export const dispatchSenderNameMaxLength = 120;
export const dispatchSenderPhoneMaxLength = 30;

// Empty text means "not configured". The phone has no format rule: sellers write it in many ways.
const optionalText = (maxLength: number) => z.string().trim().max(maxLength).nullable().transform((value) => value || null);
const dispatchSenderRules = z.strictObject({ name: optionalText(dispatchSenderNameMaxLength), phone: optionalText(dispatchSenderPhoneMaxLength) });

const blankToNull = (value: string | null) => value?.trim() || null;

export function parseDispatchSender(value: unknown): Result<ConfiguredDispatchSender, InvalidDispatchSender> {
  const parsed = dispatchSenderRules.safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_DISPATCH_SENDER", message: "Invalid dispatch sender" });
}

/** The stored name wins; an empty one falls back to the company's current name. The sender is never snapshotted. */
export function resolveDispatchSender(companyName: string, stored: ConfiguredDispatchSender | null): DispatchSenderState {
  const configured = { name: blankToNull(stored?.name ?? null), phone: blankToNull(stored?.phone ?? null) };
  return { configured, effective: { name: configured.name ?? companyName.trim(), phone: configured.phone } };
}
