import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { AdapterId, PrinterId, PrinterLocator, PrinterSelection } from "@mobile/features/printing/domain/printing";
import type { PrinterPreferenceStore } from "@mobile/features/printing/application/contracts";

const key = "printing.printer.v1";
const preferenceSchema = z.object({
  version: z.literal(1),
  printer: z.object({ id: z.string().min(1), adapterId: z.string().min(1), displayName: z.string().min(1), model: z.string().min(1) }),
  locator: z.string().min(1),
});

type Storage = Readonly<{
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
}>;
type StoredSelection = Pick<z.infer<typeof preferenceSchema>, "printer" | "locator">;

export function createPrinterPreference(storage: Storage, isKnownSelection: (selection: StoredSelection) => boolean): PrinterPreferenceStore {
  return {
    async read() {
      let raw: string | null;
      try { raw = await storage.getItemAsync(key); }
      catch { return err({ code: "PREFERENCE_READ_FAILED", message: "Could not read the saved printer" }); }
      if (raw === null) return ok(null);
      let value: unknown;
      try { value = JSON.parse(raw); }
      catch { return err({ code: "INVALID_PREFERENCE", message: "Saved printer data is invalid" }); }
      const parsed = preferenceSchema.safeParse(value);
      if (!parsed.success) return err({ code: "INVALID_PREFERENCE", message: "Saved printer data is invalid" });
      const { printer, locator } = parsed.data;
      if (!isKnownSelection({ printer, locator })) return err({ code: "INVALID_PREFERENCE", message: "Saved printer is not supported" });
      const selection: PrinterSelection = { printer: { ...printer, id: printer.id as PrinterId, adapterId: printer.adapterId as AdapterId }, locator: locator as PrinterLocator };
      return ok(selection);
    },
    async write(selection) {
      if (!isKnownSelection(selection)) return err({ code: "PREFERENCE_WRITE_FAILED", message: "Printer selection is invalid" });
      try {
        await storage.setItemAsync(key, JSON.stringify({ version: 1, printer: selection.printer, locator: selection.locator }));
        return ok(undefined);
      } catch {
        return err({ code: "PREFERENCE_WRITE_FAILED", message: "Could not remember this printer" });
      }
    },
  };
}
