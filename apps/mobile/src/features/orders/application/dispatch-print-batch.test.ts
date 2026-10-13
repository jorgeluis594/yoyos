import { err, ok } from "@shared/functional";
import { createPrintingOperations } from "@mobile/features/printing/application/printing-operations";
import type { PrinterAdapter, SendError } from "@mobile/features/printing/application/contracts";
import { productLabelFormat, type AdapterId, type CopyCount, type PrinterId, type PrinterLocator, type PrinterSelection } from "@mobile/features/printing/domain/printing";
import { resolveUnknown, runDispatchBatch, type DispatchPrintEntry } from "@mobile/features/orders/application/dispatch-print-batch";
import type { DispatchLabel } from "@mobile/features/orders/domain/dispatch-label";

const chosen: PrinterSelection = { printer: { id: "p" as PrinterId, adapterId: "brother" as AdapterId, displayName: "Brother", model: "QL-810W" }, locator: "l" as PrinterLocator };
const profile = { widthPx: 696, heightPx: 1109, dpiX: 300, dpiY: 300 };
const label: DispatchLabel = { sender: "Yoyos", scheduledDate: null, method: "home", courier: null, recipient: { name: "Ana", phone: "999", document: null },
  destination: { address: "Calle 1", location: { department: "Lima", province: "Lima", district: "Miraflores" }, reference: null } };
const entries = (...ids: string[]): DispatchPrintEntry[] => ids.map((orderId) => ({ orderId, label, state: { status: "pending" } }));
const execution = { isSessionCurrent: () => true, onStage: () => undefined };
const failure = (outcome: SendError["outcome"]): SendError => ({ code: "DEVICE_ERROR", message: "boom", outcome });

function setup(sends: (() => Promise<unknown>)[] = []) {
  const send = jest.fn(async () => (sends.shift()?.() ?? ok({ confirmation: "sdk" as const })) as ReturnType<PrinterAdapter["send"]>);
  const adapter: PrinterAdapter = { id: "brother" as AdapterId, maxCopies: 99, validateSelection: () => ok(undefined), discover: async () => ok([chosen]),
    resolve: async () => ok({ selection: chosen, profile }), send };
  const operations = createPrintingOperations({ adapters: [adapter], preferences: { read: async () => ok(chosen), write: async () => ok(undefined) },
    temporaryDocuments: { remove: async () => ok(undefined) }, reportDiagnostic: jest.fn() });
  const render = jest.fn(async () => ok({ uri: "file:///label.png", widthPx: 696, heightPx: 1109 }));
  const run = (list: readonly DispatchPrintEntry[], shouldStop = () => false) =>
    runDispatchBatch({ entries: list, reserve: operations.withPrinter, render, execution, shouldStop, onChange: jest.fn() });
  return { operations, run, send, render };
}

test("sends every label in order and confirms them", async () => {
  const { run, send } = setup();
  const result = await run(entries("a", "b"));
  expect(result.end).toBe("completed");
  expect(result.entries.map((entry) => entry.state.status)).toEqual(["confirmed", "confirmed"]);
  expect(send).toHaveBeenCalledTimes(2);
});

test("stop lets the label in progress finish and does not start the next", async () => {
  let stop = false;
  const { run, send } = setup([async () => { stop = true; return ok({ confirmation: "sdk" }); }]);
  const result = await run(entries("a", "b", "c"), () => stop);
  expect(result.end).toBe("stopped");
  expect(result.entries.map((entry) => entry.state.status)).toEqual(["confirmed", "pending", "pending"]);
  expect(send).toHaveBeenCalledTimes(1);
});

test("an error stops the batch and continuing skips the confirmed labels", async () => {
  const { run, send } = setup([async () => ok({ confirmation: "sdk" }), async () => err(failure("not-sent"))]);
  const failed = await run(entries("a", "b", "c"));
  expect(failed.end).toBe("failed");
  expect(failed.entries.map((entry) => entry.state.status)).toEqual(["confirmed", "not-sent", "pending"]);
  const resumed = await run(failed.entries);
  expect(resumed.end).toBe("completed");
  expect(send).toHaveBeenCalledTimes(4);
});

test("an uncertain result blocks continuing until the user decides, never resending automatically", async () => {
  const { run, send } = setup([async () => err(failure("unknown"))]);
  const first = await run(entries("a", "b"));
  expect(first.entries[0].state.status).toBe("unknown");
  expect((await run(first.entries)).end).toBe("needs-review");
  expect(send).toHaveBeenCalledTimes(1);
  const printed = resolveUnknown(first.entries, "a", true);
  expect(printed[0].state.status).toBe("confirmed-by-user");
  expect((await run(printed)).entries.map((entry) => entry.state.status)).toEqual(["confirmed-by-user", "confirmed"]);
  expect(resolveUnknown(first.entries, "a", false)[0].state.status).toBe("pending");
});

test("without a selected printer the batch stops for selection and keeps the label pending", async () => {
  const { render } = setup();
  const adapter: PrinterAdapter = { id: "brother" as AdapterId, maxCopies: 99, validateSelection: () => ok(undefined), discover: async () => ok([]), resolve: async () => ok({ selection: chosen, profile }), send: jest.fn() };
  const unselected = createPrintingOperations({ adapters: [adapter], preferences: { read: async () => ok(null), write: async () => ok(undefined) }, temporaryDocuments: { remove: async () => ok(undefined) }, reportDiagnostic: jest.fn() });
  const result = await runDispatchBatch({ entries: entries("a"), reserve: unselected.withPrinter, render, execution, shouldStop: () => false, onChange: jest.fn() });
  expect(result).toMatchObject({ end: "selection-required", entries: [{ state: { status: "pending" } }] });
});

test("a QR print is refused as busy while the batch holds the printer, and the printer is released afterwards", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { operations, run } = setup([async () => { await gate; return ok({ confirmation: "sdk" }); }]);
  const batch = run(entries("a"));
  await new Promise((resolve) => setTimeout(resolve));
  const qr = await operations.withPrinter((session) => session.printDocument({ format: productLabelFormat, copies: 1 as CopyCount, render: async () => err({ code: "RENDER_FAILED", message: "x" }) }, execution));
  expect(qr).toMatchObject({ success: false, error: { code: "PRINTER_BUSY" } });
  release();
  await batch;
  expect((await operations.withPrinter(async () => "free")).success).toBe(true);
  expect((await run(entries("b"))).end).toBe("completed");
});

test("a second batch while one is running ends as busy without sending", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { run, send } = setup([async () => { await gate; return ok({ confirmation: "sdk" }); }]);
  const first = run(entries("a"));
  await new Promise((resolve) => setTimeout(resolve));
  expect((await run(entries("b"))).end).toBe("busy");
  release();
  await first;
  expect(send).toHaveBeenCalledTimes(1);
});
