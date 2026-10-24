import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { DispatchPrintProvider, useDispatchPrint } from "@mobile/features/orders/presentation/dispatch-print-review";
import i18n from "@mobile/i18n";
import type { DispatchLabel } from "@shared/dispatch-label/types";

const orderId = "00000000-0000-4000-8000-000000000001";
const mockReadSender = jest.fn();
const mockGetOrder = jest.fn();
const mockRendered: DispatchLabel[] = [];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-symbols", () => ({ SymbolView: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: { get: (...args: unknown[]) => mockGetOrder(...args) } }));
jest.mock("@mobile/features/orders/composition-dispatch-printing", () => ({ dispatchPrinting: {
  readSender: () => mockReadSender(),
  createFit: async () => () => true,
  reserve: async (run: (session: unknown) => Promise<unknown>) => ({ success: true, data: await run({
    printDocument: async ({ render: draw }: { render: (profile: unknown) => Promise<unknown> }) => { await draw({}); return { success: true, data: { status: "printed", receipt: {} } }; } }) }),
  render: async (label: DispatchLabel) => { mockRendered.push(label); return { success: true, data: {} }; },
} }));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ showPrinterPicker: jest.fn(), printerName: "Brother" }) }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", user: { id: "u1" }, company: { id: "c1", name: "Mi tienda", country: "PE" } } }) }));

const order = { id: orderId, number: 1042, status: "active", cancelled: false, scheduledDispatchDate: null, delivery: { method: "home", recipient: { name: "Ana", phone: "999111222", identity: { kind: "document", documentType: "national_id", document: "00123456" } },
  destination: { address: "Av. Ejemplo 123", department: "Lima", province: "Lima", district: "Villa El Salvador", instructions: null } } };

function Trigger() {
  const { open } = useDispatchPrint();
  return <ButtonProbe onOpen={() => open([{ id: orderId, number: 1042 }])} />;
}
function ButtonProbe({ onOpen }: { onOpen: () => void }) {
  const { Pressable, Text } = jest.requireActual("react-native");
  return <Pressable accessibilityRole="button" onPress={onOpen}><Text>abrir</Text></Pressable>;
}
const renderReview = () => render(<DispatchPrintProvider><Trigger /></DispatchPrintProvider>);
const openReview = async () => { await act(async () => { fireEvent.press(screen.getByText("abrir")); }); };

beforeEach(async () => {
  jest.clearAllMocks(); mockRendered.length = 0;
  await i18n.changeLanguage("es");
  mockGetOrder.mockResolvedValue(ok(order));
});
afterEach(cleanup);

test("every label of the review carries the configured sender name and phone", async () => {
  mockReadSender.mockResolvedValue(ok({ name: "Fantastidog", phone: "977000111" }));
  renderReview(); await openReview();
  await waitFor(() => screen.getByText("Imprimir 1 rótulos"));
  await act(async () => { fireEvent.press(screen.getByText("Imprimir 1 rótulos")); });
  await waitFor(() => expect(mockRendered).toHaveLength(1));
  expect(mockRendered[0].sender).toEqual({ name: "Fantastidog", phone: "977000111" });
});

test("a failed sender read shows Reintentar, prints nothing and never falls back to the company name", async () => {
  mockReadSender.mockResolvedValue(err({ message: "offline" }));
  renderReview(); await openReview();
  await waitFor(() => screen.getByText("Reintentar"));
  expect(screen.getByText(i18n.t("dispatchSenderError"))).toBeTruthy();
  expect(screen.queryByText("Imprimir 1 rótulos")).toBeNull();
  expect(mockGetOrder).not.toHaveBeenCalled();
  expect(mockRendered).toHaveLength(0);
});

test("Reintentar reads the sender again and then offers the labels", async () => {
  mockReadSender.mockResolvedValueOnce(err({ message: "offline" })).mockResolvedValueOnce(ok({ name: "Fantastidog", phone: null }));
  renderReview(); await openReview();
  await waitFor(() => screen.getByText("Reintentar"));
  await act(async () => { fireEvent.press(screen.getByText("Reintentar")); });
  await waitFor(() => screen.getByText("Imprimir 1 rótulos"));
  expect(mockReadSender).toHaveBeenCalledTimes(2);
  await act(async () => { fireEvent.press(screen.getByText("Imprimir 1 rótulos")); });
  await waitFor(() => expect(mockRendered[0]?.sender).toEqual({ name: "Fantastidog", phone: null }));
});

test("a sender changed between two reviews is reflected in the second", async () => {
  mockReadSender.mockResolvedValueOnce(ok({ name: "Antes", phone: null })).mockResolvedValueOnce(ok({ name: "Después", phone: "955" }));
  renderReview();
  await openReview();
  await waitFor(() => screen.getByText("Imprimir 1 rótulos"));
  fireEvent.press(screen.getAllByLabelText(i18n.t("close"))[0]);
  await openReview();
  await waitFor(() => expect(mockReadSender).toHaveBeenCalledTimes(2));
  await waitFor(() => screen.getByText("Imprimir 1 rótulos"));
  await act(async () => { fireEvent.press(screen.getByText("Imprimir 1 rótulos")); });
  await waitFor(() => expect(mockRendered).toHaveLength(1));
  expect(mockRendered[0].sender).toEqual({ name: "Después", phone: "955" });
});
