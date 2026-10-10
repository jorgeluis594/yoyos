import { requireOptionalNativeModule } from "expo";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export { WhatsApp, createWhatsAppClient } from "@mobile/modules/whatsapp/client";
export type { WhatsAppClient, WhatsAppOptions, WhatsAppError, WhatsAppErrorCode, ConnectionState, WhatsAppEvents, ReceivedMessage, ImageReference, DownloadedImage } from "@mobile/modules/whatsapp/types";

type ProbeError = {
  code: "MODULE_UNAVAILABLE" | "INVALID_INPUT" | "INVALID_NATIVE_RESPONSE" | "NATIVE_CALL_FAILED";
  message: string;
};

const responseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), value: z.string() }).strict(),
  z.object({ status: z.literal("error"), code: z.literal("NATIVE_CALL_FAILED") }).strict(),
]);
const inputSchema = z.string().min(1).max(1024).refine((value) => {
  try { JSON.parse(value); return true; } catch { return false; }
});

type NativeWhatsApp = { probe(value: string, failCallback: boolean): Promise<unknown> };

/** Diagnostic bridge call used to verify a native build before session support is added. */
export async function probeWhatsAppBridge(value: string, failCallback = false): Promise<Result<string, ProbeError>> {
  if (!inputSchema.safeParse(value).success) return err({ code: "INVALID_INPUT", message: "Invalid probe input" });
  const native = requireOptionalNativeModule<NativeWhatsApp>("WhatsApp");
  if (!native) return err({ code: "MODULE_UNAVAILABLE", message: "WhatsApp native module is unavailable" });
  try {
    const parsed = responseSchema.safeParse(await native.probe(value, failCallback));
    if (!parsed.success) return err({ code: "INVALID_NATIVE_RESPONSE", message: "Invalid WhatsApp native response" });
    return parsed.data.status === "ok" ? ok(parsed.data.value) : err({ code: parsed.data.code, message: "WhatsApp native callback failed" });
  } catch {
    return err({ code: "NATIVE_CALL_FAILED", message: "WhatsApp native call failed" });
  }
}
