import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { Button } from "@mobile/components/ui/button";
import { PrintProvider, usePrint, type PrintWork } from "@mobile/features/printing/presentation/print-provider";

const mockDiscover = jest.fn();
const mockSelect = jest.fn();
jest.mock("@mobile/features/users/presentation/access-provider", () => ({
  useAccess: () => ({ state: { status: "ready", user: { id: "user" }, company: { id: "company" } } }),
}));
jest.mock("@mobile/features/printing/composition", () => ({
  printing: {
    loadPrinterPreference: () => Promise.resolve({ success: true, data: null }),
    discoverPrinters: (...args: unknown[]) => mockDiscover(...args),
    selectPrinter: (...args: unknown[]) => mockSelect(...args),
  },
  cleanOldPrintDocuments: () => Promise.resolve({ success: true, data: undefined }),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const originalPlatform = Platform.OS;
beforeEach(() => { Platform.OS = "android"; mockDiscover.mockReset(); mockSelect.mockReset(); });
afterEach(() => { Platform.OS = originalPlatform; });

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
