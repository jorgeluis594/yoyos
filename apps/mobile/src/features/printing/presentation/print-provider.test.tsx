import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { Button } from "@mobile/components/ui/button";
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
  await waitFor(() => expect(screen.queryByText("Impresora de etiquetas")).toBeNull());
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
