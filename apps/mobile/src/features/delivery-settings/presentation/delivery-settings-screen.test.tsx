import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import DeliverySettingsScreen from "@mobile/features/delivery-settings/presentation/delivery-settings-screen";
import i18n from "@mobile/i18n";

jest.mock("@mobile/features/delivery-settings/composition", () => ({ deliverySettings: { get: jest.fn(), save: jest.fn() } }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { id: "company" } } }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
const get = jest.mocked(deliverySettings.get);
const save = jest.mocked(deliverySettings.save);
const point = { name: "Store", address: "Original", instructions: null };
beforeEach(() => {
  get.mockReset(); save.mockReset();
  get.mockResolvedValue(ok({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }));
});

test("initial empty settings can be enabled and saved, then disabled without losing the point", async () => {
  save.mockResolvedValueOnce(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: point } }))
    .mockResolvedValueOnce(ok({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: point } }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Recojo en tienda");
  expect(screen.getByLabelText("Ofrecer recojo en tienda").props.value).toBe(false);
  fireEvent(screen.getByLabelText("Ofrecer recojo en tienda"), "valueChange", true);
  fireEvent.changeText(screen.getByLabelText("Nombre del punto de recojo"), "Store");
  fireEvent.changeText(screen.getByLabelText("Dirección"), "Original");
  fireEvent.press(screen.getByText("Guardar configuración"));
  await screen.findByText("Configuración guardada.");
  expect(save).toHaveBeenLastCalledWith({ expectedVersion: 0, agencyEnabled: false, couriers: [], homeEnabled: false, storeEnabled: true, pickupName: "Store", pickupAddress: "Original", pickupInstructions: "" });
  fireEvent(screen.getByLabelText("Ofrecer recojo en tienda"), "valueChange", false);
  fireEvent.press(screen.getByText("Guardar configuración"));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith({ expectedVersion: 1, agencyEnabled: false, couriers: [], homeEnabled: false, storeEnabled: false, pickupName: "Store", pickupAddress: "Original", pickupInstructions: "" });
  expect(screen.getByLabelText("Dirección").props.value).toBe("Original");
});

test("a conflict preserves the draft across language changes and only reloads explicitly", async () => {
  get.mockResolvedValueOnce(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: point } }))
    .mockResolvedValueOnce(ok({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { ...point, address: "Concurrent" } } }));
  save.mockResolvedValue(err({ code: "DELIVERY_SETTINGS_CONFLICT", message: "Private detail" }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Recojo en tienda");
  fireEvent.changeText(screen.getByLabelText("Dirección"), "My draft");
  fireEvent.press(screen.getByText("Guardar configuración"));
  await screen.findByText(/Otra persona cambió/);
  expect(screen.getByLabelText("Dirección").props.value).toBe("My draft");
  expect(screen.getByRole("button", { name: "Guardar configuración" }).props.accessibilityState.disabled).toBe(true);
  await act(async () => { await i18n.changeLanguage("pt-BR"); });
  try {
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Outra pessoa alterou/)).toBeTruthy();
    expect(screen.queryByText(/Otra persona cambió/)).toBeNull();
    expect(screen.getByLabelText("Endereço").props.value).toBe("My draft");
    fireEvent.press(screen.getByText("Recarregar configuração"));
    await waitFor(() => expect(screen.getByLabelText("Endereço").props.value).toBe("Concurrent"));
    expect(screen.queryByText(/Outra pessoa alterou/)).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  } finally { screen.unmount(); await act(async () => { await i18n.changeLanguage("es"); }); }
});

test("a failed save keeps edited data and a pending save prevents duplicate submissions", async () => {
  let complete: ((value: Awaited<ReturnType<typeof deliverySettings.save>>) => void) | undefined;
  save.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Recojo en tienda");
  fireEvent.changeText(screen.getByLabelText("Nombre del punto de recojo"), "Draft store");
  fireEvent.press(screen.getByText("Guardar configuración"));
  fireEvent.press(screen.getByText("Guardar configuración"));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { complete?.(err({ code: "NETWORK_ERROR", message: "Offline" })); });
  await screen.findByText(/No se pudo guardar/);
  expect(screen.getByLabelText("Nombre del punto de recojo").props.value).toBe("Draft store");
  expect(screen.queryByText("Configuración guardada.")).toBeNull();
});


test("home can be enabled alone and store changes preserve its enablement", async () => {
  save.mockResolvedValueOnce(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false, pickupPoint: null } }))
    .mockResolvedValueOnce(ok({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: true, pickupPoint: point } }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Entrega a domicilio");
  expect(screen.getByLabelText("Ofrecer entrega a domicilio").props.value).toBe(false);
  fireEvent(screen.getByLabelText("Ofrecer entrega a domicilio"), "valueChange", true);
  fireEvent.press(screen.getByText("Guardar configuración"));
  await screen.findByText("Configuración guardada.");
  expect(save).toHaveBeenLastCalledWith({ expectedVersion: 0, agencyEnabled: false, couriers: [], homeEnabled: true, storeEnabled: false, pickupName: "", pickupAddress: "", pickupInstructions: "" });
  fireEvent(screen.getByLabelText("Ofrecer recojo en tienda"), "valueChange", true);
  fireEvent.changeText(screen.getByLabelText("Nombre del punto de recojo"), "Store");
  fireEvent.changeText(screen.getByLabelText("Dirección"), "Original");
  fireEvent.press(screen.getByText("Guardar configuración"));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 1, agencyEnabled: false, couriers: [], homeEnabled: true, storeEnabled: true }));
});


test("editing home preserves every loaded courier and agency enablement in the whole-configuration draft", async () => {
  const couriers = [{ id: "00000000-0000-4000-8000-000000000003", name: "Active", enabled: true }, { id: "00000000-0000-4000-8000-000000000004", name: "Inactive", enabled: false }];
  get.mockResolvedValue(ok({ version: 4, agency: { enabled: true }, couriers, home: { enabled: false }, store: { enabled: false, pickupPoint: null } }));
  save.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "Offline" }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Entrega a domicilio");
  fireEvent(screen.getByLabelText("Ofrecer entrega a domicilio"), "valueChange", true);
  fireEvent.press(screen.getByText("Guardar configuración"));
  await screen.findByText(/No se pudo guardar/);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, homeEnabled: true, agencyEnabled: true, couriers: couriers.map(courier => ({ ...courier, kind: "existing" })) }));
});
