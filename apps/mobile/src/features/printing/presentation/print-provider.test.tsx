import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { err, ok } from "@shared/functional";
import { Button } from "@mobile/components/ui/button";
import { createPrintingOperations } from "@mobile/features/printing/application/printing-operations";
import type { PrintingDependencies } from "@mobile/features/printing/application/contracts";
import { productLabelFormat, type AdapterId, type CopyCount, type PrinterId, type PrinterLocator, type PrinterSelection, type RenderProfile } from "@mobile/features/printing/domain/printing";
import { PrintProvider, usePrint, type PrintWork } from "@mobile/features/printing/presentation/print-provider";

const mockDiscover = jest.fn();
const mockSelect = jest.fn();
const mockLoad = jest.fn();
const mockClean = jest.fn();
let mockAccessState = { status: "ready", user: { id: "user" }, company: { id: "company" } };
jest.mock("@mobile/features/users/presentation/access-provider", () => ({
  useAccess: () => ({ state: mockAccessState }),
}));
jest.mock("@mobile/features/printing/composition", () => ({
  printing: {
    loadPrinterPreference: (...args: unknown[]) => mockLoad(...args),
    discoverPrinters: (...args: unknown[]) => mockDiscover(...args),
    selectPrinter: (...args: unknown[]) => mockSelect(...args),
  },
  cleanOldPrintDocuments: (...args: unknown[]) => mockClean(...args),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const originalPlatform = Platform.OS;
beforeEach(() => { Platform.OS = "android"; mockDiscover.mockReset(); mockSelect.mockReset(); mockLoad.mockReset().mockResolvedValue({ success: true, data: null }); mockClean.mockReset().mockResolvedValue({ success: true, data: undefined }); mockAccessState = { status: "ready", user: { id: "user" }, company: { id: "company" } }; });
afterEach(() => { Platform.OS = originalPlatform; });

test("cleans old documents once at app startup, not on a session change", async () => {
  const { rerender } = render(<PrintProvider><Button onPress={() => {}}>Ready</Button></PrintProvider>);
  expect(mockClean).toHaveBeenCalledTimes(1);
  mockAccessState = { ...mockAccessState, company: { id: "second" } };
  rerender(<PrintProvider><Button onPress={() => {}}>Ready</Button></PrintProvider>);
  expect(mockClean).toHaveBeenCalledTimes(1);
});

test("a late earlier result cannot replace the latest print notice", async () => {
  const older = deferred<Awaited<ReturnType<PrintWork>>>();
  const newer = deferred<Awaited<ReturnType<PrintWork>>>();
  function Controls() {
    const print = usePrint();
    return <><Button onPress={() => print.startAttempt(() => older.promise)}>Older</Button><Button onPress={() => print.startAttempt(() => newer.promise)}>Newer</Button></>;
  }
  render(<PrintProvider><Controls /></PrintProvider>);
  fireEvent.press(screen.getByText("Older"));
  fireEvent.press(screen.getByText("Newer"));
  await act(async () => newer.resolve({ status: "completed" }));
  expect(screen.getByText("Impresión enviada")).toBeTruthy();
  await act(async () => older.resolve({ status: "failed", message: "old failure", outcome: "unknown" }));
  expect(screen.queryByText("old failure")).toBeNull();
  expect(screen.getByText("Impresión enviada")).toBeTruthy();
});

test("signing out invalidates pending work and discards its late result", async () => {
  const pending = deferred<Awaited<ReturnType<PrintWork>>>();
  let execution!: Parameters<PrintWork>[0];
  function Controls() {
    const print = usePrint();
    return <Button onPress={() => print.startAttempt((current) => { execution = current; return pending.promise; })}>Print</Button>;
  }
  const { rerender } = render(<PrintProvider><Controls /></PrintProvider>);
  fireEvent.press(screen.getByText("Print"));
  expect(execution.isSessionCurrent()).toBe(true);
  mockAccessState = { ...mockAccessState, status: "signed-out" };
  rerender(<PrintProvider><Controls /></PrintProvider>);
  expect(execution.isSessionCurrent()).toBe(false);
  await act(async () => pending.resolve({ status: "failed", message: "old failure", outcome: "unknown" }));
  mockAccessState = { ...mockAccessState, status: "ready" };
  rerender(<PrintProvider><Controls /></PrintProvider>);
  expect(screen.queryByText("old failure")).toBeNull();
  expect(screen.queryByText("Reintentar")).toBeNull();
});

test("navigation preserves a pending print and dismissing its notice ignores a late result", async () => {
  const first = deferred<Awaited<ReturnType<PrintWork>>>();
  const second = deferred<Awaited<ReturnType<PrintWork>>>();
  function Screen({ route }: { route: string }) {
    const print = usePrint();
    return <>
      <Button onPress={() => print.startAttempt(() => first.promise)}>{route}</Button>
      <Button onPress={() => print.startAttempt(() => second.promise)}>Another print</Button>
    </>;
  }
  const { rerender } = render(<PrintProvider><Screen route="Catalog" /></PrintProvider>);
  fireEvent.press(screen.getByText("Catalog"));
  expect(screen.getByText("Preparando impresión")).toBeTruthy();
  rerender(<PrintProvider><Screen route="Detail" /></PrintProvider>);
  expect(screen.getByText("Detail")).toBeTruthy();
  expect(screen.getByText("Preparando impresión")).toBeTruthy();
  await act(async () => first.resolve({ status: "completed" }));
  expect(screen.getByText("Impresión enviada")).toBeTruthy();
  fireEvent.press(screen.getByText("Another print"));
  fireEvent.press(screen.getByText("Cerrar"));
  await act(async () => second.resolve({ status: "failed", message: "late failure", outcome: "unknown" }));
  expect(screen.queryByText("late failure")).toBeNull();
  expect(screen.queryByText("Reintentar")).toBeNull();
});

test("choosing a discovered printer resumes the pending print", async () => {
  const candidate = { printer: { id: "serial:1", displayName: "Brother QL-810W", adapterId: "brother", model: "QL-810W" }, locator: "locator" };
  mockDiscover.mockResolvedValue({ success: true, data: [candidate] });
  mockSelect.mockResolvedValue({ success: true, data: { selection: candidate, persistence: { status: "saved" } } });
  const work = jest.fn<ReturnType<PrintWork>, Parameters<PrintWork>>()
    .mockResolvedValueOnce({ status: "selection-required" })
    .mockResolvedValueOnce({ status: "completed" });
  function Controls() {
    const print = usePrint();
    return <Button onPress={() => print.startAttempt(work)}>Print</Button>;
  }
  render(<PrintProvider><Controls /></PrintProvider>);
  fireEvent.press(screen.getByText("Print"));
  await waitFor(() => expect(screen.getByText("Brother QL-810W")).toBeTruthy());
  fireEvent.press(screen.getByText("Brother QL-810W"));
  await waitFor(() => expect(screen.getByText("Impresión enviada")).toBeTruthy());
  expect(work).toHaveBeenCalledTimes(2);
});

test("changing printer after an uncertain failure waits for duplicate confirmation", async () => {
  const candidate = { printer: { id: "serial:1", displayName: "Brother QL-810W", adapterId: "brother", model: "QL-810W" }, locator: "locator" };
  mockDiscover.mockResolvedValue({ success: true, data: [candidate] });
  mockSelect.mockResolvedValue({ success: true, data: { selection: candidate, persistence: { status: "saved" } } });
  const work = jest.fn<ReturnType<PrintWork>, Parameters<PrintWork>>()
    .mockResolvedValueOnce({ status: "failed", message: "Connection lost", outcome: "unknown" })
    .mockResolvedValueOnce({ status: "completed" });
  function Controls() {
    const print = usePrint();
    return <Button onPress={() => print.startAttempt(work)}>Print</Button>;
  }
  render(<PrintProvider><Controls /></PrintProvider>);
  fireEvent.press(screen.getByText("Print"));
  await screen.findByText("Connection lost");
  fireEvent.press(screen.getByText("Elegir impresora"));
  await screen.findByText("Brother QL-810W");
  fireEvent.press(screen.getByText("Brother QL-810W"));
  await waitFor(() => expect(screen.getByText("Confirma que deseas repetir aunque podrían salir duplicados.")).toBeTruthy());
  expect(work).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText("Confirmar repetición"));
  await screen.findByText("Impresión enviada");
  expect(work).toHaveBeenCalledTimes(2);
});

test("selection and printer change preserve the label and copies while rendering for each profile", async () => {
  const first: PrinterSelection = { printer: { id: "serial:1" as PrinterId, adapterId: "brother" as AdapterId, displayName: "Brother A", model: "QL-810W" }, locator: "first" as PrinterLocator };
  const second: PrinterSelection = { printer: { id: "serial:2" as PrinterId, adapterId: "brother" as AdapterId, displayName: "Brother B", model: "QL-810W" }, locator: "second" as PrinterLocator };
  const firstProfile = { widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 };
  const secondProfile = { widthPx: 928, heightPx: 361, dpiX: 400, dpiY: 400 };
  const send = jest.fn(async ({ printer }: Parameters<PrintingDependencies["adapters"][number]["send"]>[0]) =>
    printer.selection.printer.id === first.printer.id
      ? err({ code: "COMMUNICATION_FAILED" as const, message: "Connection lost", outcome: "unknown" as const })
      : ok({ confirmation: "sdk" as const }));
  const dependencies: PrintingDependencies = {
    adapters: [{ id: "brother" as AdapterId, maxCopies: 99, validateSelection: () => ok(undefined), discover: async () => ok([first, second]), resolve: async (selection) => ok({ selection, profile: selection.printer.id === first.printer.id ? firstProfile : secondProfile }), send }],
    preferences: { read: async () => ok(null), write: async () => ok(undefined) },
    temporaryDocuments: { remove: async () => ok(undefined) }, reportDiagnostic: jest.fn(),
  };
  const operations = createPrintingOperations(dependencies);
  mockLoad.mockImplementation(operations.loadPrinterPreference);
  mockDiscover.mockImplementation(operations.discoverPrinters);
  mockSelect.mockImplementation(operations.selectPrinter);
  const label = "saved variant QR";
  const renderDocument = jest.fn(async (_content: string, profile: RenderProfile) => ok({ uri: `file:///label-${profile.widthPx}.png`, widthPx: profile.widthPx, heightPx: profile.heightPx }));
  const work: PrintWork = async (execution) => {
    const result = await operations.printDocument({ format: productLabelFormat, copies: 3 as CopyCount, render: (profile) => renderDocument(label, profile) }, execution);
    if (!result.success) return { status: "failed", message: result.error.message, outcome: result.error.outcome };
    return result.data.status === "completed" ? { status: "completed" } : { status: "selection-required" };
  };
  function Controls() {
    const print = usePrint();
    return <Button onPress={() => print.startAttempt(work)}>Print</Button>;
  }
  render(<PrintProvider><Controls /></PrintProvider>);
  fireEvent.press(screen.getByText("Print"));
  fireEvent.press(await screen.findByText("Brother A"));
  await screen.findByText("Connection lost");
  expect(screen.getByText("Es posible que hayan salido algunas etiquetas. Revisa la impresora antes de repetir.")).toBeTruthy();
  fireEvent.press(screen.getByText("Elegir impresora"));
  fireEvent.press(await screen.findByText("Brother B"));
  await screen.findByText("Confirma que deseas repetir aunque podrían salir duplicados.");
  expect(send).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText("Confirmar repetición"));
  await screen.findByText("Impresión enviada");
  expect(renderDocument.mock.calls).toEqual([[label, firstProfile], [label, secondProfile]]);
  expect(send.mock.calls.map(([request]) => [request.printer.selection.printer.id, request.copies, request.document.widthPx])).toEqual([[first.printer.id, 3, 696], [second.printer.id, 3, 928]]);
});

test("a late preference read cannot replace a newly selected printer", async () => {
  const pending = deferred<{ success: false; error: { code: string; message: string } }>();
  mockLoad.mockReturnValue(pending.promise);
  const candidate = { printer: { id: "serial:1", displayName: "Brother QL-810W", adapterId: "brother", model: "QL-810W" }, locator: "locator" };
  mockDiscover.mockResolvedValue({ success: true, data: [candidate] });
  mockSelect.mockResolvedValue({ success: true, data: { selection: candidate, persistence: { status: "saved" } } });
  function Controls() {
    const print = usePrint();
    return <Button onPress={print.showPrinterPicker}>Choose</Button>;
  }
  render(<PrintProvider><Controls /></PrintProvider>);
  fireEvent.press(screen.getByText("Choose"));
  fireEvent.press(await screen.findByText("Brother QL-810W"));
  expect(mockSelect).toHaveBeenCalledWith(candidate);
  await act(async () => { await Promise.resolve(); });
  await act(async () => pending.resolve({ success: false, error: { code: "PREFERENCE_READ_FAILED", message: "old read" } }));
  fireEvent.press(screen.getByText("Choose"));
  await waitFor(() => expect(mockDiscover).toHaveBeenCalledTimes(2));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("Actual: Brother QL-810W")).toBeTruthy();
  expect(screen.queryByText("No se pudo recuperar la impresora guardada. Puedes elegirla de nuevo.")).toBeNull();
});

test("an old printer search cannot replace a newer picker result", async () => {
  const older = { printer: { id: "serial:old", displayName: "Brother vieja", adapterId: "brother", model: "QL-810W" }, locator: "old" };
  const newer = { printer: { id: "serial:new", displayName: "Brother nueva", adapterId: "brother", model: "QL-810W" }, locator: "new" };
  const first = deferred<{ success: true; data: typeof older[] }>();
  const second = deferred<{ success: true; data: typeof newer[] }>();
  mockDiscover.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  function Controls() {
    const print = usePrint();
    return <Button onPress={print.showPrinterPicker}>Choose</Button>;
  }
  render(<PrintProvider><Controls /></PrintProvider>);
  fireEvent.press(screen.getByText("Choose"));
  fireEvent.press(screen.getByText("Cancelar"));
  fireEvent.press(screen.getByText("Choose"));
  await act(async () => second.resolve({ success: true, data: [newer] }));
  expect(screen.getByText("Brother nueva")).toBeTruthy();
  await act(async () => first.resolve({ success: true, data: [older] }));
  expect(screen.getByText("Brother nueva")).toBeTruthy();
  expect(screen.queryByText("Brother vieja")).toBeNull();
});
