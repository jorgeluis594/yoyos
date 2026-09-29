import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { z } from "zod";
import { err, ok } from "@shared/functional";

const deviceSchema = z.object({
  model: z.string().min(1), ip: z.ipv4(), serial: z.string().min(1).optional(), mac: z.string().min(1).optional(),
});
export type BrotherDevice = z.infer<typeof deviceSchema>;

const discoverySchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.array(deviceSchema) }),
  z.object({ success: z.literal(false), error: z.object({ code: z.enum(["PERMISSION_DENIED", "DISCOVERY_FAILED"]), message: z.string() }) }),
]);
const sendingSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.object({ confirmation: z.literal("sdk") }) }),
  z.object({ success: z.literal(false), error: z.object({
    code: z.enum(["INVALID_COPIES", "PAPER_EMPTY", "PAPER_MISMATCH", "COVER_OPEN", "PRINTER_REJECTED", "DEVICE_ERROR", "CONNECTION_FAILED", "COMMUNICATION_FAILED"]),
    message: z.string(), outcome: z.enum(["not-sent", "unknown"]),
  }) }),
]);

type NativeBrother = { discover(timeoutSeconds: number): Promise<unknown>; send(input: Readonly<{ ip: string; identityKind: "serial" | "mac"; identityValue: string; uri: string; copies: number }>): Promise<unknown> };
const native = () => Platform.OS === "android" ? requireOptionalNativeModule<NativeBrother>("BrotherPrinter") : null;

export async function discoverBrother() {
  const module = native();
  if (!module) return err({ code: "PRINTING_UNAVAILABLE" as const, message: "Brother printing is unavailable" });
  try {
    const parsed = discoverySchema.safeParse(await module.discover(5));
    if (!parsed.success) return err({ code: "DISCOVERY_FAILED" as const, message: "Printer discovery returned invalid data" });
    return parsed.data.success ? ok(parsed.data.data) : err(parsed.data.error);
  } catch {
    return err({ code: "DISCOVERY_FAILED" as const, message: "Could not discover printers" });
  }
}

export async function sendBrother(input: Parameters<NativeBrother["send"]>[0]) {
  const module = native();
  if (!module) return err({ code: "CONNECTION_FAILED" as const, message: "Brother printing is unavailable", outcome: "not-sent" as const });
  try {
    const parsed = sendingSchema.safeParse(await module.send(input));
    if (!parsed.success) return err({ code: "INVALID_NATIVE_RESPONSE" as const, message: "Printer returned invalid results", outcome: "unknown" as const });
    return parsed.data.success ? ok(parsed.data.data) : err(parsed.data.error);
  } catch {
    return err({ code: "COMMUNICATION_FAILED" as const, message: "Printer communication failed", outcome: "unknown" as const });
  }
}
