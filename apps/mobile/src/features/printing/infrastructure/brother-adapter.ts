import { z } from "zod";
import { err, ok } from "@shared/functional";
import { discoverBrother, sendBrother, type BrotherDevice } from "@mobile/modules/brother-printer";
import type { PrinterAdapter } from "@mobile/features/printing/application/contracts";
import type { AdapterId, PrinterId, PrinterLocator, PrinterSelection } from "@mobile/features/printing/domain/printing";

const adapterId = "brother" as AdapterId;
const locatorSchema = z.object({
  version: z.literal(1), adapterId: z.literal("brother"), model: z.literal("QL-810W"),
  identity: z.discriminatedUnion("kind", [z.object({ kind: z.literal("serial"), value: z.string().min(1) }), z.object({ kind: z.literal("mac"), value: z.string().min(1) })]),
  lastKnownIp: z.ipv4(),
});
type Locator = z.infer<typeof locatorSchema>;
const idFor = (identity: Locator["identity"]) => `${identity.kind}:${identity.value}` as PrinterId;
const identityFor = (device: BrotherDevice): Locator["identity"] | null => device.serial
  ? { kind: "serial", value: device.serial }
  : device.mac ? { kind: "mac", value: device.mac.toUpperCase() } : null;
const sameIdentity = (device: BrotherDevice, identity: Locator["identity"]) => identity.kind === "serial"
  ? device.serial === identity.value
  : device.mac?.toUpperCase() === identity.value;

function selectionFor(device: BrotherDevice): PrinterSelection | null {
  if (device.model !== "QL-810W") return null;
  const identity = identityFor(device);
  if (!identity) return null;
  const locator: Locator = { version: 1, adapterId: "brother", model: "QL-810W", identity, lastKnownIp: device.ip };
  return { printer: { id: idFor(identity), adapterId, displayName: "Brother QL-810W", model: "QL-810W" }, locator: JSON.stringify(locator) as PrinterLocator };
}

export function parseBrotherSelection(selection: Readonly<{ printer: Readonly<{ id: string; adapterId: string; model: string }>; locator: string }>): Locator | null {
  if (selection.printer.adapterId !== adapterId || selection.printer.model !== "QL-810W" || typeof selection.locator !== "string") return null;
  let value: unknown;
  try { value = JSON.parse(selection.locator); } catch { return null; }
  const parsed = locatorSchema.safeParse(value);
  return parsed.success && selection.printer.id === idFor(parsed.data.identity) ? parsed.data : null;
}

export const brotherAdapter: PrinterAdapter = {
  id: adapterId,
  maxCopies: 99,
  validateSelection(selection) {
    return parseBrotherSelection(selection) ? ok(undefined) : err({ code: "PRINTER_IDENTITY_MISMATCH", message: "Printer identity is invalid" });
  },
  async discover() {
    const result = await discoverBrother();
    if (!result.success) return result;
    const unique = new Map<PrinterId, PrinterSelection>();
    if (result.data.some((device) => device.model === "QL-810W" && !identityFor(device)))
      return err({ code: "DISCOVERY_FAILED", message: "Printer did not report a serial number or MAC address" });
    for (const device of result.data) {
      const selection = selectionFor(device);
      if (selection) unique.set(selection.printer.id, selection);
    }
    return ok([...unique.values()]);
  },
  async resolve(selection, format) {
    const locator = parseBrotherSelection(selection);
    if (!locator) return err({ code: "PRINTER_IDENTITY_MISMATCH", message: "Saved printer identity is invalid" });
    if (format.widthMm !== 62 || format.heightMm !== 29) return err({ code: "UNSUPPORTED_FORMAT", message: "Brother QL-810W requires 62 × 29 mm labels" });
    const found = await discoverBrother();
    if (!found.success) return err({ code: found.error.code === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : "CONNECTION_FAILED", message: found.error.message });
    const device = found.data.find((candidate) => candidate.model === "QL-810W" && sameIdentity(candidate, locator.identity));
    if (!device) return err({ code: found.data.some((candidate) => candidate.ip === locator.lastKnownIp && candidate.model === "QL-810W") ? "PRINTER_IDENTITY_MISMATCH" : "PRINTER_NOT_FOUND", message: "Selected printer could not be verified" });
    const refreshed = selectionFor(device);
    if (!refreshed) return err({ code: "PRINTER_IDENTITY_MISMATCH", message: "Selected printer has no stable identity" });
    return ok({ selection: refreshed, profile: { widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 } });
  },
  async send({ printer, document, copies }) {
    const locator = parseBrotherSelection(printer.selection);
    if (!locator) return err({ code: "PRINTER_REJECTED", message: "Printer identity is invalid", outcome: "not-sent" });
    return sendBrother({ ip: locator.lastKnownIp, identityKind: locator.identity.kind, identityValue: locator.identity.value, uri: document.uri, copies });
  },
};
