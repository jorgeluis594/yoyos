import { createPrinterPreference } from "@mobile/features/printing/infrastructure/printer-preference";
import type { PrinterSelection } from "@mobile/features/printing/domain/printing";

const selection = { printer: { id: "serial-1", adapterId: "brother", displayName: "Brother", model: "QL-810W" }, locator: "locator" } as PrinterSelection;

test("round trips a validated printer and treats absence separately", async () => {
  let stored: string | null = null;
  const preference = createPrinterPreference({ getItemAsync: async () => stored, setItemAsync: async (_, value) => { stored = value; } }, (value) => value.printer.id === "serial-1");
  expect(await preference.read()).toEqual({ success: true, data: null });
  expect((await preference.write(selection)).success).toBe(true);
  expect(await preference.read()).toEqual({ success: true, data: selection });
});

test("rejects corrupt, outdated, and incoherent saved choices", async () => {
  for (const raw of ["{", JSON.stringify({ version: 2, ...selection }), JSON.stringify({ version: 1, ...selection, printer: { ...selection.printer, id: "other" } })]) {
    const preference = createPrinterPreference({ getItemAsync: async () => raw, setItemAsync: async () => {} }, (value) => value.printer.id === "serial-1");
    expect(await preference.read()).toMatchObject({ success: false, error: { code: "INVALID_PREFERENCE" } });
  }
});

test("does not disguise storage failures as an absent printer", async () => {
  const preference = createPrinterPreference({ getItemAsync: async () => { throw new Error("read failed"); }, setItemAsync: async () => { throw new Error("write failed"); } }, () => true);
  expect(await preference.read()).toMatchObject({ success: false, error: { code: "PREFERENCE_READ_FAILED" } });
  expect(await preference.write(selection)).toMatchObject({ success: false, error: { code: "PREFERENCE_WRITE_FAILED" } });
});
