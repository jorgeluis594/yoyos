import { deliverySettings } from "@mobile/features/delivery-settings";
// Run by core/tests/e2e/mobile-order-creation.spec.ts against its isolated API/database.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";
import { createOrderOperations } from "@mobile/features/orders/application/order-operations";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";
import NewOrderScreen from "@mobile/features/orders/presentation/new-order-screen";
import "@mobile/i18n";
import { deliveryZonesSchema } from "@shared/contracts/delivery-settings";
import { getPeruDistrict, getPeruProvinces, peruDepartments } from "@shared/peru-geography";

const mockReplace = jest.fn();
let mockOrders: ReturnType<typeof createOrderOperations>;
let mockLoseResponse = false;
let mockOfflineRead = false;
let mockPosts = 0;
let directory: string;

// Native navigation/session are supplied by the harness; feature code and HTTP remain real.
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: mockReplace }), useNavigation: () => ({ dispatch: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => jest.requireActual<typeof import("node:crypto")>("node:crypto").randomUUID() }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  readPendingOrderConfirmation: (...args: Parameters<typeof mockOrders.readPendingOrderConfirmation>) => mockOrders.readPendingOrderConfirmation(...args),
  resolvePendingOrderConfirmation: (...args: Parameters<typeof mockOrders.resolvePendingOrderConfirmation>) => mockOrders.resolvePendingOrderConfirmation(...args),
  searchOrderCatalog: (...args: Parameters<typeof mockOrders.searchOrderCatalog>) => mockOrders.searchOrderCatalog(...args),
  searchOrderContacts: (...args: Parameters<typeof mockOrders.searchOrderContacts>) => mockOrders.searchOrderContacts(...args),
  completeOrder: (...args: Parameters<typeof mockOrders.completeOrder>) => mockOrders.completeOrder(...args),
  resendPendingOrder: (...args: Parameters<typeof mockOrders.resendPendingOrder>) => mockOrders.resendPendingOrder(...args),
  loadPendingOrderReview: (...args: Parameters<typeof mockOrders.loadPendingOrderReview>) => mockOrders.loadPendingOrderReview(...args),
  reviewPendingOrder: (...args: Parameters<typeof mockOrders.reviewPendingOrder>) => mockOrders.reviewPendingOrder(...args),
  reviewLegacyPendingDelivery: (...args: Parameters<typeof mockOrders.reviewLegacyPendingDelivery>) => mockOrders.reviewLegacyPendingDelivery(...args),
} }));
jest.mock("@mobile/features/delivery-settings/composition", () => {
  const { createDeliverySettingsApi } = jest.requireActual<typeof import("@mobile/features/delivery-settings/infrastructure/delivery-settings-api")>("@mobile/features/delivery-settings/infrastructure/delivery-settings-api");
  const { createQuotationApi } = jest.requireActual<typeof import("@mobile/features/delivery-settings/infrastructure/quotation-api")>("@mobile/features/delivery-settings/infrastructure/quotation-api");
  return { deliverySettings: { get: () => createDeliverySettingsApi(mockRequest).get(),
    createQuotation: (districtCode: string) => createQuotationApi(mockRequest)(districtCode) } };
});
jest.mock("@expo/ui/community/menu", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { MenuView: ({ children, onPressAction }: { children: React.ReactNode; onPressAction: (event: { nativeEvent: { event: string } }) => void }) =>
    <View {...{ onValueChange: (index: number) => onPressAction({ nativeEvent: { event: String(index) } }) }}>{children}</View> };
});
jest.mock("@expo/ui", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Picker = ({ children, testID, onValueChange }: { children: React.ReactNode; testID?: string; onValueChange: (value: number) => void }) =>
    <View testID={testID} accessible accessibilityRole="adjustable" {...{ onValueChange }}>{children}</View>;
  Picker.Item = function PickerItem() { return null; };
  return { Host: View, Picker };
});
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", company: { id: process.env.ORDER_JOURNEY_COMPANY, name: "Journey company", country: "PE" }, user: { id: "seller" },
} }) }));
jest.mock("@mobile/features/orders/presentation/order-draft-guard", () => ({ useOrderDraft: () => ({ dirty: false, setDirty: jest.fn(), discardVersion: 0 }) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ show: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

async function mockRequest(path: string, init: RequestInit = {}): Promise<Result<unknown, TransportError>> {
  if (mockOfflineRead && path.endsWith("/aggregate")) return err({ code: "NETWORK_ERROR", message: "Read unavailable" });
  const result = await new Promise<Result<unknown, TransportError>>((resolve) => {
    const outgoing = httpRequest(new URL(path, process.env.ORDER_JOURNEY_ORIGIN), {
      method: init.method ?? "GET", headers: { "content-type": "application/json", cookie: process.env.ORDER_JOURNEY_COOKIE! },
    }, incoming => {
      let raw = "";
      incoming.setEncoding("utf8");
      incoming.on("data", chunk => { raw += chunk; });
      incoming.on("end", () => {
        try {
          const body: unknown = JSON.parse(raw);
          resolve(incoming.statusCode! < 400 ? ok(body) : err({ code: "API_ERROR", message: "API rejected request", http: { status: incoming.statusCode!, body } }));
        } catch { resolve(err({ code: "INVALID_RESPONSE", message: "Invalid JSON" })); }
      });
    });
    outgoing.on("error", () => resolve(err({ code: "NETWORK_ERROR", message: "HTTP unavailable" })));
    outgoing.end(typeof init.body === "string" ? init.body : undefined);
  });
  if (path === "/api/orders" && init.method === "POST") {
    mockPosts++;
    if (mockLoseResponse) return err({ code: "NETWORK_ERROR", message: "Response lost after commit" });
  }
  return result;
}

function restartOperations() {
  const store = createPendingOrderConfirmationStore({
    getItemAsync: async key => {
      try { return readFileSync(join(directory, key), "utf8"); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; }
    },
    setItemAsync: async (key, value) => { writeFileSync(join(directory, key), value); },
    deleteItemAsync: async key => { unlinkSync(join(directory, key)); },
  });
  mockOrders = createOrderOperations(createOrderApi(mockRequest), store);
}

beforeEach(() => {
  mockReplace.mockClear(); mockLoseResponse = false; mockOfflineRead = false; mockPosts = 0;
  directory = mkdtempSync(join(tmpdir(), "mobile-order-journey-"));
  restartOperations();
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

async function review() {
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Journey product");
  fireEvent.press(screen.getByRole("button", { name: /Journey product/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar venta" }));
  return screen;
}

test("mobile interface creates a pending order without payments or stock changes", async () => {
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  const id = mockReplace.mock.calls[0][0].split("/").at(-1);
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: {
    status: "active", paymentStatus: "pending", deliveryStatus: "pending", payments: [], stockDeducted: false, completedAt: null,
  } });
  expect(mockPosts).toBe(1);
}, 15000);

test("mobile interface creates an immediate sale with payment, stock deduction and delivery", async () => {
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "10");
  fireEvent(screen.getByRole("switch", { name: "Marcar como entregado al guardar" }), "valueChange", true);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  const id = mockReplace.mock.calls[0][0].split("/").at(-1);
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: {
    status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", stockDeducted: true, completedAt: expect.any(String),
    payments: [expect.objectContaining({ status: "confirmed", amount: { amount: 10, currency: "PEN" } })],
  } });
  expect(mockPosts).toBe(1);
});

test("mobile recovers a persisted pending creation after a lost response and restart without reposting", async () => {
  const screen = await review();
  mockLoseResponse = true; mockOfflineRead = true;
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await screen.findByText("Venta pendiente de confirmar");
  expect(mockReplace).not.toHaveBeenCalled();
  const saved = await mockOrders.readPendingOrderConfirmation(process.env.ORDER_JOURNEY_COMPANY!);
  expect(saved).toMatchObject({ success: true, data: { version: 2, request: { contactId: null } } });
  if (!saved.success || !saved.data) throw new Error("Missing persisted attempt");
  const id = saved.data.id;
  screen.unmount();
  mockOfflineRead = false; mockLoseResponse = false;
  restartOperations();
  const reopened = render(<NewOrderScreen />);
  await reopened.findByText("Venta pendiente de confirmar");
  fireEvent.press(reopened.getByRole("button", { name: "Verificar venta" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/orders/${id}`));
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: {
    status: "active", payments: [], stockDeducted: false, deliveryStatus: "pending", completedAt: null,
  } });
  expect(mockPosts).toBe(1);
  expect(await mockOrders.clearPendingOrderConfirmation(process.env.ORDER_JOURNEY_COMPANY!, id)).toMatchObject({ success: true });
  expect(await mockOrders.readPendingOrderConfirmation(process.env.ORDER_JOURNEY_COMPANY!)).toEqual(ok(null));
});

async function ratedReview(method: "home" | "agency" = "home", rateIndex = 0) {
  const screen = await review();
  fireEvent(screen.getByLabelText("Configurar datos de entrega"), "valueChange", true);
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", method === "home" ? 1 : 2);
  const district = getPeruDistrict("150122")!;
  fireEvent(screen.getByTestId("delivery-department"), "valueChange", peruDepartments.findIndex(value => value.code === district.departmentCode));
  fireEvent(screen.getByTestId("delivery-province"), "valueChange", getPeruProvinces(district.departmentCode).findIndex(value => value.code === district.provinceCode));
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), district.code);
  fireEvent(screen.getByTestId("delivery-district"), "valueChange", 0);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", rateIndex);
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Journey recipient");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999123456");
  if (method === "home") fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Journey street");
  else {
    fireEvent(screen.getByTestId("delivery-document-type"), "valueChange", 0);
    fireEvent.changeText(screen.getByLabelText(/Número de documento/), "00123456");
  }
  return screen;
}

test("mobile creates a rated home order and payment atomically with the full selected charge", async () => {
  const screen = await ratedReview();
  expect(screen.getByText(/Total:\sS\/\s18\.00/)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "18");
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  const id = mockReplace.mock.calls[0][0].split("/").at(-1);
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: {
    status: "active", paymentStatus: "paid", deliveryStatus: "pending", stockDeducted: true,
    itemsTotal: { amount: 10, currency: "PEN" }, deliveryCost: { amount: 8, currency: "PEN" },
    deliveryCharge: { amount: 8, currency: "PEN" }, total: { amount: 18, currency: "PEN" },
    delivery: { method: "home", destination: { districtCode: "150122" }, pricing: { rateId: expect.any(String) }, recordedBy: { kind: "seller" } },
    payments: [expect.objectContaining({ amount: { amount: 18, currency: "PEN" } })],
  } });
  expect(mockPosts).toBe(1);
});

test("mobile creates free rated agency delivery without operational courier or agency fields", async () => {
  const screen = await ratedReview("agency");
  expect(screen.queryByTestId("delivery-courier")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  const id = mockReplace.mock.calls[0][0].split("/").at(-1);
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: {
    total: { amount: 10, currency: "PEN" }, deliveryCharge: { amount: 0, currency: "PEN" }, stockDeducted: false,
    delivery: { method: "agency", courier: null, agency: null, destination: { districtCode: "150122" },
      recipient: { identity: { kind: "document", document: "00123456" } }, pricing: { rateId: expect.any(String) } },
  } });
});

test("mobile price conflict leaves no order and preserves fields for explicit rate review", async () => {
  const screen = await ratedReview();
  const configuration = await mockRequest("/api/delivery-settings/zones");
  if (!configuration.success) throw new Error("Cannot read zones");
  const { version, zones } = deliveryZonesSchema.parse(configuration.data);
  const saved = await mockRequest("/api/delivery-settings/zones", { method: "PUT", body: JSON.stringify({ method: "home", expectedVersion: version,
    zones: zones.filter(zone => zone.method === "home").map(({ id, name, enabled, districtCodes, price }) => ({ kind: "existing", id, name, enabled, districtCodes,
      price: name === "Journey home" ? { amount: 10, currency: "PEN" } : price })),
  }) });
  expect(saved.success).toBe(true);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await screen.findByText(/La tarifa cambió/);
  expect(mockReplace).not.toHaveBeenCalled();
  expect(await mockOrders.readPendingOrderConfirmation(process.env.ORDER_JOURNEY_COMPANY!)).toEqual(ok(null));
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Journey street");
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  expect(screen.getByText(/Total:\sS\/\s20\.00/)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  const id = mockReplace.mock.calls[0][0].split("/").at(-1);
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: { total: { amount: 20, currency: "PEN" } } });
  expect(mockPosts).toBe(2);
});

test("rated mobile creation recovers the same charge after a lost response and restart without reposting", async () => {
  const screen = await ratedReview("home", 1);
  mockLoseResponse = true; mockOfflineRead = true;
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await screen.findByText("Venta pendiente de confirmar");
  const saved = await mockOrders.readPendingOrderConfirmation(process.env.ORDER_JOURNEY_COMPANY!);
  expect(saved).toMatchObject({ success: true, data: { version: 2, shownTotal: { amount: 22, currency: "PEN" },
    request: { delivery: { expectedPrice: { amount: 12, currency: "PEN" }, delivery: { method: "home", rateId: expect.any(String) } } } } });
  if (!saved.success || !saved.data) throw new Error("Missing persisted attempt");
  const id = saved.data.id;
  screen.unmount(); mockOfflineRead = false; mockLoseResponse = false;
  restartOperations();
  const reopened = render(<NewOrderScreen />);
  await reopened.findByText("Venta pendiente de confirmar");
  fireEvent.press(reopened.getByRole("button", { name: "Verificar venta" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/orders/${id}`));
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: {
    total: { amount: 22, currency: "PEN" }, deliveryCharge: { amount: 12, currency: "PEN" }, stockDeducted: false, payments: [],
  } });
  expect(mockPosts).toBe(1);
});

test("legacy recovery reviews a current rate and resends the same order and payments through the real API", async () => {
  const catalog = await mockOrders.searchOrderCatalog("Journey product");
  if (!catalog.success || !catalog.data[0]?.variants[0]) throw new Error("Missing recovery product");
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const companyId = process.env.ORDER_JOURNEY_COMPANY!;
  const pending = { version: 2, companyId, id: orderId, shownTotal: { amount: 10, currency: "PEN" },
    request: { id: orderId, contactId: null, items: [{ variantId: catalog.data[0].variants[0].id, quantity: 1 }],
      payments: [{ paymentId, amount: { amount: 4.5, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false }],
      delivery: { chargeDeliveryToCustomer: false, delivery: { method: "home",
        recipient: { name: "Recovery recipient", phone: "999123456", identity: { kind: "absent" } },
        destination: { address: "Recovery street", district: "Miraflores", instructions: "Door 2" } } } } };
  writeFileSync(join(directory, `yoyos_pending_order_${companyId}`), JSON.stringify(pending));
  restartOperations();
  const screen = render(<NewOrderScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Revisar entrega guardada" }));
  await screen.findByLabelText(/Dirección de entrega/);
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Recovery street");
  const district = getPeruDistrict("150122")!;
  fireEvent(screen.getByTestId("delivery-department"), "valueChange", peruDepartments.findIndex(value => value.code === district.departmentCode));
  fireEvent(screen.getByTestId("delivery-province"), "valueChange", getPeruProvinces(district.departmentCode).findIndex(value => value.code === district.provinceCode));
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), district.code);
  fireEvent(screen.getByTestId("delivery-district"), "valueChange", 0);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 1);
  expect(screen.getByText(/Total:\sS\/\s22\.00/)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Guardar entrega revisada" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Guardar entrega revisada" })).toBeNull(), { timeout: 10000 });
  expect(mockPosts).toBe(0);
  expect(await mockOrders.readPendingOrderConfirmation(companyId)).toMatchObject({ success: true, data: {
    id: orderId, request: { id: orderId, payments: pending.request.payments,
      delivery: { expectedPrice: { amount: 12, currency: "PEN" }, delivery: { method: "home", destination: { address: "Recovery street", districtCode: "150122" } } } },
  } });
  screen.unmount(); restartOperations();
  const reopened = render(<NewOrderScreen />);
  await reopened.findByText("Venta pendiente de confirmar");
  for (let index = 0; index < 2; index++) {
    fireEvent.press(reopened.getByRole("button", { name: "Verificar venta" }));
    await waitFor(() => expect(reopened.getByRole("button", { name: "Verificar venta" })).toBeEnabled());
  }
  fireEvent.press(await reopened.findByRole("button", { name: "Reenviar mismo intento" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/orders/${orderId}`));
  expect(await mockOrders.loadOrder(orderId)).toMatchObject({ success: true, data: {
    total: { amount: 22, currency: "PEN" }, deliveryCharge: { amount: 12, currency: "PEN" }, stockDeducted: false,
    payments: [expect.objectContaining({ id: paymentId, amount: { amount: 4.5, currency: "PEN" } })],
  } });
  expect(mockPosts).toBe(1);
}, 20000);

test("a restarted rated attempt retains a real HTTP price conflict and saves a fresh review", async () => {
  const companyId = process.env.ORDER_JOURNEY_COMPANY!;
  const catalog = await mockOrders.searchOrderCatalog("Journey product");
  const quote = await deliverySettings.createQuotation("150122");
  if (!catalog.success || !catalog.data[0]?.variants[0] || !quote.success) throw new Error("Missing recovery fixtures");
  const rate = quote.data.rates.find(value => value.method === "home" && value.price.amount === 10);
  if (!rate) throw new Error("Missing changed price rate");
  const orderId = randomUUID();
  const pending = { version: 2, companyId, id: orderId, shownTotal: { amount: 18, currency: "PEN" },
    request: { id: orderId, contactId: null, items: [{ variantId: catalog.data[0].variants[0].id, quantity: 1 }],
      delivery: { expectedPrice: { amount: 8, currency: "PEN" }, delivery: { method: "home", rateId: rate.id,
        recipient: { name: "Restart recipient", phone: "999123456", identity: { kind: "absent" } },
        destination: { address: "Restart street", districtCode: "150122", instructions: null } } } } };
  writeFileSync(join(directory, `yoyos_pending_order_${companyId}`), JSON.stringify(pending));
  restartOperations();
  expect(await mockOrders.resendPendingOrder(companyId)).toMatchObject({ success: false,
    error: { code: "TOTAL_CHANGED", currentPrice: { amount: 10, currency: "PEN" } } });
  expect(await mockOrders.readPendingOrderConfirmation(companyId)).toEqual(ok(pending));
  const screen = render(<NewOrderScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Revisar entrega guardada" }));
  expect(await screen.findByLabelText(/Dirección de entrega/)).toHaveProp("value", "Restart street");
  const district = getPeruDistrict("150122")!;
  fireEvent(screen.getByTestId("delivery-department"), "valueChange", peruDepartments.findIndex(value => value.code === district.departmentCode));
  fireEvent(screen.getByTestId("delivery-province"), "valueChange", getPeruProvinces(district.departmentCode).findIndex(value => value.code === district.provinceCode));
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), district.code);
  fireEvent(screen.getByTestId("delivery-district"), "valueChange", 0);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 1);
  expect(screen.getByText(/Total:\sS\/\s22\.00/)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Guardar entrega revisada" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Guardar entrega revisada" })).toBeNull(), { timeout: 10000 });
  expect(await mockOrders.readPendingOrderConfirmation(companyId)).toMatchObject({ success: true,
    data: { id: orderId, shownTotal: { amount: 22, currency: "PEN" }, request: { items: pending.request.items,
      delivery: { expectedPrice: { amount: 12, currency: "PEN" } } } } });
  expect(mockPosts).toBe(1);
  expect(mockReplace).not.toHaveBeenCalled();
}, 20000);


test("restarted stock rejection keeps the paid attempt editable and resends its original identities", async () => {
  const companyId = process.env.ORDER_JOURNEY_COMPANY!;
  const catalog = await mockOrders.searchOrderCatalog("Journey product");
  if (!catalog.success || !catalog.data[0]?.variants[0]) throw new Error("Missing catalog fixture");
  const variantId = catalog.data[0].variants[0].id;
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const pending = { version: 2, companyId, id: orderId, shownTotal: { amount: 40, currency: "PEN" },
    request: { id: orderId, contactId: null, items: [{ variantId, quantity: 4 }],
      payments: [{ paymentId, amount: { amount: 40, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false }] } };
  writeFileSync(join(directory, `yoyos_pending_order_${companyId}`), JSON.stringify(pending));
  restartOperations();
  expect(await mockOrders.resendPendingOrder(companyId)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
  expect(await mockOrders.readPendingOrderConfirmation(companyId)).toEqual(ok(pending));
  const screen = render(<NewOrderScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Corregir intento guardado" }));
  await screen.findByRole("button", { name: "Guardar correcciones" });
  expect(screen.getByLabelText(/Importe recibido/)).toHaveProp("value", "40");
  for (let count = 0; count < 3; count++) fireEvent.press(screen.getByRole("button", { name: "−" }));
  fireEvent.press(screen.getByRole("button", { name: "Guardar correcciones" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Guardar correcciones" })).toBeNull(), { timeout: 10000 });
  expect(await mockOrders.readPendingOrderConfirmation(companyId)).toEqual(ok({ ...pending, shownTotal: { amount: 10, currency: "PEN" },
    request: { ...pending.request, items: [{ variantId, quantity: 1 }] } }));
  expect(mockPosts).toBe(1);
  screen.unmount(); restartOperations();
  const reopened = render(<NewOrderScreen />);
  await reopened.findByText("Venta pendiente de confirmar");
  for (let count = 0; count < 2; count++) {
    fireEvent.press(reopened.getByRole("button", { name: "Verificar venta" }));
    await waitFor(() => expect(reopened.getByRole("button", { name: "Verificar venta" })).toBeEnabled());
  }
  fireEvent.press(await reopened.findByRole("button", { name: "Reenviar mismo intento" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/orders/${orderId}`));
  expect(await mockOrders.loadOrder(orderId)).toMatchObject({ success: true, data: {
    total: { amount: 10, currency: "PEN" }, stockDeducted: true, overpaidAmount: { amount: 30, currency: "PEN" },
    payments: [expect.objectContaining({ id: paymentId, amount: { amount: 40, currency: "PEN" } })],
    items: [expect.objectContaining({ variantId, quantity: 1 })],
  } });
  expect(mockPosts).toBe(2);
}, 20000);
