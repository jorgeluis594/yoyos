import { err, ok } from "@shared/functional";
import { createPrintingOperations } from "@mobile/features/printing/application/printing-operations";
import type { PrintingDependencies, PrintRequest } from "@mobile/features/printing/application/contracts";
import { productLabelFormat, type AdapterId, type CopyCount, type PrinterId, type PrinterLocator, type PrinterSelection } from "@mobile/features/printing/domain/printing";

const chosen: PrinterSelection = { printer: { id: "serial-1" as PrinterId, adapterId: "brother" as AdapterId, displayName: "Brother", model: "QL-810W" }, locator: "first" as PrinterLocator };
const profile = { widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 };
const document = { uri: "file:///cache/label.png", widthPx: 696, heightPx: 271 };
const execution = { isSessionCurrent: () => true, onStage: jest.fn() };
const request = (render: PrintRequest["render"] = async () => ok(document)): PrintRequest => ({ format: productLabelFormat, copies: 1 as CopyCount, render });

function setup() {
  const send = jest.fn(async () => ok({ confirmation: "sdk" as const }));
  const remove = jest.fn(async () => ok(undefined));
  const read = jest.fn(async () => ok(null as PrinterSelection | null));
  const write = jest.fn(async () => ok(undefined));
  const deps: PrintingDependencies = {
    adapters: [{ id: "brother" as AdapterId, maxCopies: 99, validateSelection: (value) => value.locator === chosen.locator ? ok(undefined) : err({ code: "PRINTER_IDENTITY_MISMATCH" as const, message: "Invalid printer" }), discover: async () => ok([chosen]), resolve: async () => ok({ selection: chosen, profile }), send }],
    preferences: { read, write }, temporaryDocuments: { remove }, reportDiagnostic: jest.fn(),
  };
  return { operations: createPrintingOperations(deps), send, remove, read, write, deps };
}

test("rejects an invalid printer before making it the active selection", async () => {
  const { operations, write } = setup();
  const invalid = { ...chosen, locator: "bad" as PrinterLocator };
  expect(await operations.selectPrinter(invalid)).toMatchObject({ success: false, error: { code: "PRINTER_IDENTITY_MISMATCH" } });
  expect(write).not.toHaveBeenCalled();
  expect(await operations.printDocument(request(), execution)).toEqual(ok({ status: "selection-required" }));
});

test("asks for a printer before rendering, then sends and removes the image", async () => {
  const { operations, send, remove } = setup();
  const render = jest.fn(async () => ok(document));
  expect(await operations.printDocument(request(render), execution)).toEqual(ok({ status: "selection-required" }));
  expect(render).not.toHaveBeenCalled();
  await operations.selectPrinter(chosen);
  expect(await operations.printDocument(request(render), execution)).toEqual(ok({ status: "completed", printer: chosen.printer, receipt: { confirmation: "sdk" } }));
  expect(render).toHaveBeenCalledWith(profile);
  expect(send).toHaveBeenCalledWith({ printer: { selection: chosen, profile }, document, copies: 1 });
  expect(remove).toHaveBeenCalledWith(document);
});

test("does not send invalid images and still removes them", async () => {
  const { operations, send, remove } = setup();
  await operations.selectPrinter(chosen);
  const result = await operations.printDocument(request(async () => ok({ ...document, widthPx: 695 })), execution);
  expect(result).toMatchObject({ success: false, error: { code: "RENDER_FAILED", outcome: "not-sent" } });
  expect(send).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(1);
});

test("rejects an unsupported copy count before rendering", async () => {
  const { operations, send } = setup();
  const render = jest.fn(async () => ok(document));
  await operations.selectPrinter(chosen);
  expect(await operations.printDocument({ ...request(render), copies: 100 as CopyCount }, execution)).toMatchObject({ success: false, error: { code: "INVALID_COPIES", outcome: "not-sent" } });
  expect(render).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test("preserves an uncertain send failure and does not resend", async () => {
  const { deps, remove } = setup();
  const send = jest.fn(async () => err({ code: "COMMUNICATION_FAILED" as const, message: "Connection lost", outcome: "unknown" as const }));
  const operations = createPrintingOperations({ ...deps, adapters: [{ ...deps.adapters[0], send }] });
  await operations.selectPrinter(chosen);
  expect(await operations.printDocument(request(), execution)).toMatchObject({ success: false, error: { code: "COMMUNICATION_FAILED", outcome: "unknown" } });
  expect(send).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});

test("a late preference read cannot replace a new selection", async () => {
  const { deps } = setup();
  let finishRead!: (value: ReturnType<typeof ok<PrinterSelection | null>>) => void;
  const read = () => new Promise<ReturnType<typeof ok<PrinterSelection | null>>>((resolve) => { finishRead = resolve; });
  const operations = createPrintingOperations({ ...deps, preferences: { ...deps.preferences, read } });
  const pending = operations.loadPrinterPreference();
  await operations.selectPrinter(chosen);
  finishRead(ok(null));
  await pending;
  const render = jest.fn(async () => ok(document));
  expect(await operations.printDocument(request(render), execution)).toMatchObject({ success: true, data: { status: "completed" } });
  expect(render).toHaveBeenCalled();
});

test("quick selections persist in order so the last printer remains saved", async () => {
  const { deps } = setup();
  const second = { ...chosen, locator: "second" as PrinterLocator };
  let finishFirst!: () => void;
  const firstWrite = new Promise<void>((resolve) => { finishFirst = resolve; });
  let persisted: PrinterSelection | null = null;
  const write = jest.fn(async (value: PrinterSelection) => {
    if (value === chosen) await firstWrite;
    persisted = value;
    return ok(undefined);
  });
  const operations = createPrintingOperations({
    ...deps,
    adapters: [{ ...deps.adapters[0], validateSelection: () => ok(undefined) }],
    preferences: { ...deps.preferences, write },
  });
  const first = operations.selectPrinter(chosen);
  const latest = operations.selectPrinter(second);
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  finishFirst();
  await Promise.all([first, latest]);
  expect(persisted).toBe(second);
});
