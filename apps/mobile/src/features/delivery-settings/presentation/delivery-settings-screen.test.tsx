import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import DeliverySettingsScreen from "@mobile/features/delivery-settings/presentation/delivery-settings-screen";
import i18n from "@mobile/i18n";

jest.mock("@mobile/features/delivery-settings/composition", () => ({ deliverySettings: { get: jest.fn(), getCourierCatalog: jest.fn(), save: jest.fn(), getZones: jest.fn(), saveZones: jest.fn(), getAgencyCatalog: jest.fn() } }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { id: "company", country: "PE" } } }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@expo/ui", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Picker = ({ onValueChange, children, testID }: { onValueChange: (value: number) => void; children: React.ReactNode; testID?: string }) =>
    <View testID={testID} accessible accessibilityRole="adjustable" {...{ onValueChange }}>{children}</View>;
  Picker.Item = function PickerItem({ label }: { label: string }) {
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return <Text>{label}</Text>;
  };
  return { Host: View, Picker };
});
const get = jest.mocked(deliverySettings.get);
const getCourierCatalog = jest.mocked(deliverySettings.getCourierCatalog);
const save = jest.mocked(deliverySettings.save);
const shalomId = "00000000-0000-4000-8000-000000000101";
const olvaId = "00000000-0000-4000-8000-000000000102";
const catalog = { couriers: [{ id: shalomId, code: "shalom", name: "Shalom" }, { id: olvaId, code: "olva", name: "Olva Courier" }] };
const getZones = jest.mocked(deliverySettings.getZones);
const saveZones = jest.mocked(deliverySettings.saveZones);
const getAgencyCatalog = jest.mocked(deliverySettings.getAgencyCatalog);
const point = { name: "Store", address: "Original", instructions: null };
beforeEach(() => {
  get.mockReset(); getCourierCatalog.mockReset(); save.mockReset();
  getCourierCatalog.mockResolvedValue(ok(catalog)); getZones.mockReset(); saveZones.mockReset();
  getZones.mockResolvedValue(ok({ version: 0, currency: "PEN", zones: [], agencies: [], home: { enabled: false }, agency: { enabled: false } }));
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
  const couriers = [{ id: "00000000-0000-4000-8000-000000000003", courierId: shalomId, name: "Shalom", enabled: true }, { id: "00000000-0000-4000-8000-000000000004", courierId: olvaId, name: "Olva Courier", enabled: false }];
  get.mockResolvedValue(ok({ version: 4, agency: { enabled: true }, couriers, home: { enabled: false }, store: { enabled: false, pickupPoint: null } }));
  save.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "Offline" }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Entrega a domicilio");
  fireEvent(screen.getByLabelText("Ofrecer entrega a domicilio"), "valueChange", true);
  fireEvent.press(screen.getByText("Guardar configuración"));
  await screen.findByText(/No se pudo guardar/);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, homeEnabled: true, agencyEnabled: true, couriers: couriers.map(courier => ({ ...courier, kind: "existing" })) }));
});

test("couriers are added from the catalog, offered once, removable while unsaved and keep catalog names after saving", async () => {
  const id = "00000000-0000-4000-8000-000000000003";
  save.mockResolvedValueOnce(ok({ version: 1, home: { enabled: false }, store: { enabled: false, pickupPoint: null }, agency: { enabled: true }, couriers: [{ id, courierId: olvaId, name: "Olva Courier", enabled: true }] }))
    .mockResolvedValueOnce(ok({ version: 2, home: { enabled: false }, store: { enabled: false, pickupPoint: null }, agency: { enabled: false }, couriers: [{ id, courierId: olvaId, name: "Olva Courier", enabled: false }] }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Envío a agencia");
  fireEvent(screen.getByLabelText("Ofrecer envío a agencia"), "valueChange", true);
  fireEvent.press(screen.getByLabelText("Agregar Shalom"));
  expect(screen.queryByLabelText("Agregar Shalom")).toBeNull();
  fireEvent.press(screen.getByLabelText("Quitar Shalom sin guardar"));
  expect(screen.getByLabelText("Agregar Shalom")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Agregar Olva Courier"));
  fireEvent.press(screen.getByText("Guardar configuración"));
  await screen.findByText("Configuración guardada.");
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ agencyEnabled: true, couriers: [{ kind: "new", courierId: olvaId, name: "Olva Courier", enabled: true, localKey: 2 }] }));
  expect(screen.queryByText("Quitar alta sin guardar")).toBeNull();
  fireEvent(screen.getByLabelText("Habilitar Olva Courier"), "valueChange", false);
  fireEvent(screen.getByLabelText("Ofrecer envío a agencia"), "valueChange", false);
  fireEvent.press(screen.getByText("Guardar configuración"));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 1, agencyEnabled: false, couriers: [{ kind: "existing", id, courierId: olvaId, name: "Olva Courier", enabled: false }] }));
});

test("courier configuration conflict retains new and existing rows and flags until explicit reload", async () => {
  const id = "00000000-0000-4000-8000-000000000003";
  get.mockResolvedValueOnce(ok({ version: 1, home: { enabled: false }, store: { enabled: false, pickupPoint: null }, agency: { enabled: true }, couriers: [{ id, courierId: shalomId, name: "Shalom", enabled: true }] }))
    .mockResolvedValueOnce(ok({ version: 2, home: { enabled: false }, store: { enabled: false, pickupPoint: null }, agency: { enabled: false }, couriers: [{ id, courierId: shalomId, name: "Shalom", enabled: false }] }));
  save.mockResolvedValue(err({ code: "DELIVERY_SETTINGS_CONFLICT", message: "Changed" }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Envío a agencia");
  fireEvent(screen.getByLabelText("Habilitar Shalom"), "valueChange", false);
  fireEvent.press(screen.getByLabelText("Agregar Olva Courier"));
  fireEvent.press(screen.getByText("Guardar configuración"));
  await screen.findByText(/Otra persona cambió/);
  expect(screen.getByLabelText("Habilitar Shalom").props.value).toBe(false);
  expect(screen.getByLabelText("Habilitar Olva Courier").props.value).toBe(true);
  expect(screen.getByLabelText("Ofrecer envío a agencia").props.value).toBe(true);
  expect(screen.getByRole("button", { name: "Guardar configuración" }).props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByText("Recargar configuración"));
  await waitFor(() => expect(screen.queryByLabelText("Habilitar Olva Courier")).toBeNull());
  expect(screen.getByLabelText("Habilitar Shalom").props.value).toBe(false);
});


const zoneId = "00000000-0000-4000-8000-000000000010";
const optionId = "00000000-0000-4000-8000-000000000011";
const homeOption = { id: optionId, method: "home" as const, name: "Standard", enabled: true, price: { amount: 8, currency: "PEN" as const } };
const homeZone = { id: zoneId, name: "Lima", enabled: true, districtCodes: ["150122"], options: [homeOption] };
const zonesState = { version: 5, currency: "PEN" as const, home: { enabled: true }, agency: { enabled: false }, agencies: [], zones: [homeZone] };

test("mobile zone edit validates explicit zero, preserves pickup edits and advances the shared version", async () => {
  getZones.mockResolvedValue(ok(zonesState));
  get.mockResolvedValue(ok({ version: 5, home: { enabled: true }, agency: { enabled: false }, couriers: [], store: { enabled: true, pickupPoint: point } }));
  saveZones.mockResolvedValue(ok({ ...zonesState, version: 6, zones: [{ ...homeZone, options: [{ ...homeOption, price: { amount: 0, currency: "PEN" } }] }] }));
  save.mockResolvedValue(ok({ version: 7, home: { enabled: true }, agency: { enabled: false }, couriers: [], store: { enabled: true, pickupPoint: { ...point, address: "Pickup draft" } } }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Lima");
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar Lima" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.changeText(screen.getByLabelText("Dirección"), "Pickup draft");
  fireEvent.press(screen.getByText("Editar Lima"));
  fireEvent.changeText(screen.getByLabelText("Tarifa por pedido (S/) *"), "");
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText(/Ingresa nombre, distritos/);
  expect(saveZones).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Tarifa por pedido (S/) *"), "0");
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText("Zona guardada.");
  expect(saveZones).toHaveBeenCalledWith({ expectedVersion: 5, zones: [{
    kind: "existing", id: zoneId, name: "Lima", enabled: true, districtCodes: ["150122"],
    options: [{ kind: "existing", id: optionId, method: "home", name: "Standard", enabled: true, price: { amount: 0, currency: "PEN" } }],
  }] });
  expect(screen.getByText(/Standard · Domicilio · Entrega gratis/)).toBeTruthy();
  expect(screen.getByLabelText("Dirección").props.value).toBe("Pickup draft");
  fireEvent.press(screen.getByText("Guardar configuración"));
  await screen.findByText("Configuración guardada.");
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 6, pickupAddress: "Pickup draft" }));
});

test("a new zone sends its options and rejects duplicate option names before the request", async () => {
  getZones.mockResolvedValue(ok({ ...zonesState, zones: [] }));
  get.mockResolvedValue(ok({ version: 5, home: { enabled: true }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Agregar zona");
  await waitFor(() => expect(screen.getByRole("button", { name: "Agregar zona" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByText("Agregar zona"));
  fireEvent.changeText(screen.getByLabelText("Nombre de la zona *"), "Lima");
  fireEvent.press(screen.getByText("Agregar opción a domicilio"));
  fireEvent.press(screen.getByText("Agregar opción a domicilio"));
  fireEvent.changeText(screen.getAllByLabelText("Nombre de la opción *")[0], "Standard");
  fireEvent.changeText(screen.getAllByLabelText("Nombre de la opción *")[1], " standard ");
  fireEvent.changeText(screen.getAllByLabelText("Tarifa por pedido (S/) *")[0], "8");
  fireEvent.changeText(screen.getAllByLabelText("Tarifa por pedido (S/) *")[1], "9");
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText(/Ingresa nombre, distritos/);
  expect(saveZones).not.toHaveBeenCalled();
});

test("uncertain zone save preserves the draft and blocks all saves until explicit reload", async () => {
  getZones.mockResolvedValueOnce(ok(zonesState)).mockResolvedValueOnce(ok({ ...zonesState, version: 6 }));
  saveZones.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "Private detail" }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Lima");
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar Lima" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByText("Editar Lima"));
  fireEvent.changeText(screen.getByLabelText("Nombre de la zona *"), "My draft");
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText(/No pudimos confirmar el guardado/);
  expect(screen.getByLabelText("Nombre de la zona *").props.value).toBe("My draft");
  expect(screen.getByRole("button", { name: "Guardar zona" }).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Guardar configuración" }).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Cancelar edición" }).props.accessibilityState.disabled).toBe(true);
  expect(saveZones).toHaveBeenCalledTimes(1);
  expect(getZones).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Private detail")).toBeNull();
  fireEvent.press(screen.getByText("Recargar configuración"));
  await waitFor(() => expect(getZones).toHaveBeenCalledTimes(2));
  await waitFor(() => {
    expect(screen.getByText("Editar Lima")).toBeTruthy();
    expect(screen.queryByLabelText("Nombre de la zona *")).toBeNull();
  });
});

const agencyOf = (n: number, name: string, enabled = true) => ({ id: `00000000-0000-4000-8000-0000000002${n}0`, courierId: shalomId, name, address: `Av. ${name} 1`, enabled,
  location: { country: "PE" as const, districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA" } });

test("agency options list their catalog agencies, flag options without eligible ones and save the chosen associations", async () => {
  const central = agencyOf(1, "Central");
  const north = agencyOf(2, "Norte");
  const closed = agencyOf(3, "Cerrada", false);
  const agencyOption = { id: optionId, method: "agency" as const, name: "A agencia", enabled: true, price: { amount: 5, currency: "PEN" as const }, agencyIds: [central.id] };
  const orphan = { ...agencyOption, id: "00000000-0000-4000-8000-000000000012", name: "Sin agencia", agencyIds: [closed.id] };
  const state = { ...zonesState, agency: { enabled: true }, agencies: [central, closed], zones: [{ ...homeZone, options: [agencyOption, orphan] }] };
  getZones.mockResolvedValue(ok(state));
  getAgencyCatalog.mockResolvedValue(ok({ agencies: [central, north] }));
  get.mockResolvedValue(ok({ version: 5, home: { enabled: true }, agency: { enabled: true }, couriers: [{ id: "00000000-0000-4000-8000-0000000000a1", courierId: shalomId, name: "Shalom", enabled: true }],
    store: { enabled: false, pickupPoint: null } }));
  saveZones.mockResolvedValue(ok({ ...state, version: 6 }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Lima");
  expect(screen.getByText(/A agencia · Agencia · S\/ 5.00$/)).toBeTruthy();
  expect(screen.getByText(/Sin agencia · Agencia · S\/ 5.00 · Sin agencias elegibles/)).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar Lima" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByText("Editar Lima"));
  await screen.findAllByText(/Norte · MIRAFLORES/);
  expect(getAgencyCatalog).toHaveBeenCalledWith(shalomId);
  expect(screen.getAllByText(/Central · MIRAFLORES/).length).toBeGreaterThan(0);
  fireEvent(screen.getAllByLabelText(/Norte · MIRAFLORES/)[0], "valueChange", true);
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText("Zona guardada.");
  expect(saveZones).toHaveBeenCalledWith({ expectedVersion: 5, zones: [expect.objectContaining({ options: [
    expect.objectContaining({ kind: "existing", id: optionId, method: "agency", agencyIds: [central.id, north.id] }),
    expect.objectContaining({ kind: "existing", id: orphan.id, method: "agency", agencyIds: [closed.id] }),
  ] })] });
});

test("a new agency option is offered only when agency delivery is enabled and needs a name and price before saving", async () => {
  getZones.mockResolvedValueOnce(ok({ ...zonesState, zones: [] }));
  const first = render(<DeliverySettingsScreen />);
  await first.findByText("Agregar zona");
  await waitFor(() => expect(first.getByRole("button", { name: "Agregar zona" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(first.getByText("Agregar zona"));
  expect(first.queryByText("Agregar opción a agencia")).toBeNull();
  first.unmount();
  getZones.mockResolvedValueOnce(ok({ ...zonesState, agency: { enabled: true }, zones: [] }));
  getAgencyCatalog.mockResolvedValue(ok({ agencies: [] }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Agregar zona");
  await waitFor(() => expect(screen.getByRole("button", { name: "Agregar zona" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByText("Agregar zona"));
  fireEvent.changeText(screen.getByLabelText("Nombre de la zona *"), "Lima");
  fireEvent.press(screen.getByText("Agregar opción a agencia"));
  expect(screen.getByText("Sin agencias: la opción no se ofrecerá al cotizar.")).toBeTruthy();
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText(/Ingresa nombre, distritos/);
  expect(saveZones).not.toHaveBeenCalled();
});
