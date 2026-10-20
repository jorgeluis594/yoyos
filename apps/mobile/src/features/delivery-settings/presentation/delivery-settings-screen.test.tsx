import { ScrollView, TextInput } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import DeliverySettingsScreen from "@mobile/features/delivery-settings/presentation/delivery-settings-screen";
import "@mobile/i18n";

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
const mockUsePreventRemove = jest.fn();
const mockShowConfirmation = jest.fn();
const mockDispatch = jest.fn();
jest.mock("expo-router", () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: (...args: unknown[]) => mockUsePreventRemove(...args) }));
jest.mock("@mobile/components/ui/show-confirmation", () => ({ showConfirmation: (...args: unknown[]) => mockShowConfirmation(...args) }));
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
  get.mockReset(); getCourierCatalog.mockReset(); save.mockReset(); mockUsePreventRemove.mockReset(); mockShowConfirmation.mockReset(); mockDispatch.mockReset();
  getCourierCatalog.mockResolvedValue(ok(catalog)); getZones.mockReset(); saveZones.mockReset();
  getZones.mockResolvedValue(ok({ version: 0, currency: "PEN", zones: [], agencies: [], home: { enabled: false }, agency: { enabled: false } }));
  get.mockResolvedValue(ok({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }));
});

const empty = { version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false as const, pickupPoint: null } };
const switchOf = (screen: ReturnType<typeof render>, label: string) => screen.getByLabelText(label);

test("toggling home delivery saves it and shows Guardado on its row", async () => {
  save.mockResolvedValueOnce(ok({ ...empty, version: 1, home: { enabled: true } }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Entrega a domicilio");
  expect(screen.queryByText("Guardar configuración")).toBeNull();
  fireEvent(switchOf(screen, "Ofrecer entrega a domicilio"), "valueChange", true);
  expect(save).toHaveBeenCalledWith({ expectedVersion: 0, home: { enabled: true }, agency: { enabled: false }, store: { enabled: false, pickupPoint: null } });
  expect(screen.getByText("Guardando…")).toBeTruthy();
  await screen.findByText("Guardado");
  expect(switchOf(screen, "Ofrecer entrega a domicilio").props.value).toBe(true);
});

test("a failed agency save reverts the switch and Reintentar resends the same version", async () => {
  get.mockResolvedValue(ok({ ...empty, version: 4 }));
  save.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "Offline" })).mockResolvedValueOnce(ok({ ...empty, version: 5, agency: { enabled: true } }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Envío a agencia");
  fireEvent(switchOf(screen, "Ofrecer envío a agencia"), "valueChange", true);
  await screen.findByText("No se pudo guardar. Revisa tu conexión y vuelve a intentarlo.");
  expect(switchOf(screen, "Ofrecer envío a agencia").props.value).toBe(false);
  expect(screen.queryByText("Guardado")).toBeNull();
  fireEvent.press(screen.getByText("Reintentar"));
  await screen.findByText("Guardado");
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  expect(save.mock.calls[0]?.[0]).toMatchObject({ expectedVersion: 4, agency: { enabled: true } });
});

test("a conflict reverts the switch, disables switches and reload keeps the pickup text and zone draft", async () => {
  const stored = { ...empty, version: 1, store: { enabled: true as const, pickupPoint: point } };
  get.mockResolvedValueOnce(ok(stored)).mockResolvedValueOnce(ok({ ...stored, version: 2, agency: { enabled: true } }));
  getZones.mockResolvedValueOnce(ok({ ...zonesState, version: 1, zones: [homeZone] })).mockResolvedValueOnce(ok({ ...zonesState, version: 2, zones: [{ ...homeZone, name: "Lima norte" }] }));
  save.mockResolvedValueOnce(err({ code: "DELIVERY_SETTINGS_CONFLICT", message: "Private detail" }))
    .mockResolvedValueOnce(ok({ ...stored, version: 3, agency: { enabled: true }, store: { enabled: true as const, pickupPoint: { ...point, address: "My draft" } } }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Lima");
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar Lima" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByText("Editar Lima"));
  fireEvent.changeText(screen.getByLabelText("Nombre de la zona *"), "Zone draft");
  fireEvent.changeText(screen.getByLabelText("Dirección"), "My draft");
  fireEvent(switchOf(screen, "Ofrecer entrega a domicilio"), "valueChange", true);
  await screen.findByText(/Otra persona cambió la configuración/);
  expect(switchOf(screen, "Ofrecer entrega a domicilio").props.value).toBe(false);
  expect(switchOf(screen, "Ofrecer entrega a domicilio").props.disabled).toBe(true);
  expect(screen.queryByText("Private detail")).toBeNull();
  fireEvent.press(screen.getAllByText("Recargar configuración")[0]!);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  await screen.findByText(/Otra persona cambió esta zona/);
  expect(screen.queryByText(/Otra persona cambió la configuración/)).toBeNull();
  expect(screen.getByLabelText("Nombre de la zona *").props.value).toBe("Zone draft");
  expect(screen.getByLabelText("Dirección").props.value).toBe("My draft");
  // The pickup text left unsaved by the conflict saves on top of the reloaded version.
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]?.[0]).toMatchObject({ expectedVersion: 2, agency: { enabled: true }, store: { enabled: true, pickupPoint: { name: "Store", address: "My draft" } } });
});

test("tapping store pickup without a point opens the fields and activates after name and address are saved", async () => {
  save.mockResolvedValueOnce(ok({ ...empty, version: 1, store: { enabled: true as const, pickupPoint: { name: "Tienda Cercado", address: "Calle Mercaderes 210", instructions: null } } }));
  const focus = jest.spyOn(TextInput.prototype, "focus");
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Recojo en tienda");
  expect(screen.getByLabelText("Nombre del punto de recojo")).toBeTruthy();
  fireEvent(switchOf(screen, "Ofrecer recojo en tienda"), "valueChange", true);
  await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));
  expect(save).not.toHaveBeenCalled();
  expect(switchOf(screen, "Ofrecer recojo en tienda").props.value).toBe(false);
  expect(screen.getByText("Completa el nombre y la dirección para activar el recojo.")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Nombre del punto de recojo"), "Tienda Cercado");
  fireEvent.changeText(screen.getByLabelText("Dirección"), "Calle Mercaderes 210");
  fireEvent(screen.getByLabelText("Dirección"), "blur");
  await screen.findByText("Guardado");
  expect(save).toHaveBeenCalledWith({ expectedVersion: 0, home: { enabled: false }, agency: { enabled: false },
    store: { enabled: true, pickupPoint: { name: "Tienda Cercado", address: "Calle Mercaderes 210", instructions: null } } });
  expect(switchOf(screen, "Ofrecer recojo en tienda").props.value).toBe(true);
});

test("pickup text is saved after the pause and not on every keystroke", async () => {
  jest.useFakeTimers();
  try {
    get.mockResolvedValue(ok({ ...empty, version: 1, store: { enabled: true as const, pickupPoint: point } }));
    save.mockResolvedValue(ok({ ...empty, version: 2, store: { enabled: true as const, pickupPoint: { ...point, address: "Calle 2" } } }));
    const screen = render(<DeliverySettingsScreen />);
    await screen.findByLabelText("Dirección");
    fireEvent.changeText(screen.getByLabelText("Dirección"), "Calle 1");
    act(() => { jest.advanceTimersByTime(1000); });
    fireEvent.changeText(screen.getByLabelText("Dirección"), "Calle 2");
    act(() => { jest.advanceTimersByTime(1000); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(600); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1, store: { enabled: true, pickupPoint: { name: "Store", address: "Calle 2", instructions: null } } }));
    // Emptying a required field keeps the saved point and only reports the field once it is left.
    fireEvent.changeText(screen.getByLabelText("Nombre del punto de recojo"), "");
    fireEvent(screen.getByLabelText("Nombre del punto de recojo"), "blur");
    expect(screen.getByText("Completa los campos obligatorios.")).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test("leaving with an unsaved pickup text asks for confirmation", async () => {
  get.mockResolvedValue(ok({ ...empty, version: 1, store: { enabled: true as const, pickupPoint: point } }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByLabelText("Dirección");
  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
  fireEvent.changeText(screen.getByLabelText("Dirección"), "Calle 9");
  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  const leave = mockUsePreventRemove.mock.lastCall![1] as (event: { data: { action: unknown } }) => void;
  leave({ data: { action: "back" } });
  expect(mockShowConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: "Hay cambios del punto de recojo sin guardar.", confirmLabel: "Salir sin guardar", cancelLabel: "Seguir editando" }));
  mockShowConfirmation.mock.lastCall![0].onConfirm();
  expect(mockDispatch).toHaveBeenCalledWith("back");
  screen.unmount();
});

const zoneId = "00000000-0000-4000-8000-000000000010";
const optionId = "00000000-0000-4000-8000-000000000011";
const homeOption = { id: optionId, method: "home" as const, name: "Standard", enabled: true, price: { amount: 8, currency: "PEN" as const } };
const homeZone = { id: zoneId, name: "Lima", enabled: true, departmentCodes: [], provinceCodes: [], districtCodes: ["150122"], options: [homeOption] };
const zonesState = { version: 5, currency: "PEN" as const, home: { enabled: true }, agency: { enabled: false }, agencies: [], zones: [homeZone] };

test("mobile zone edit validates explicit zero and advances the shared version for the next settings save", async () => {
  getZones.mockResolvedValue(ok(zonesState));
  get.mockResolvedValue(ok({ version: 5, home: { enabled: true }, agency: { enabled: false }, couriers: [], store: { enabled: true, pickupPoint: point } }));
  saveZones.mockResolvedValue(ok({ ...zonesState, version: 6, zones: [{ ...homeZone, options: [{ ...homeOption, price: { amount: 0, currency: "PEN" } }] }] }));
  save.mockResolvedValue(ok({ version: 7, home: { enabled: false }, agency: { enabled: false }, couriers: [], store: { enabled: true, pickupPoint: point } }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Lima");
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar Lima" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByText("Editar Lima"));
  fireEvent.changeText(screen.getByLabelText("Tarifa por pedido (S/) *"), "");
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText(/Ingresa nombre, distritos/);
  expect(saveZones).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Tarifa por pedido (S/) *"), "0");
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText("Zona guardada.");
  expect(saveZones).toHaveBeenCalledWith({ expectedVersion: 5, zones: [{
    kind: "existing", id: zoneId, name: "Lima", enabled: true, departmentCodes: [], provinceCodes: [], districtCodes: ["150122"],
    options: [{ kind: "existing", id: optionId, method: "home", name: "Standard", enabled: true, price: { amount: 0, currency: "PEN" } }],
  }] });
  expect(screen.getByText(/Standard · Domicilio · Entrega gratis/)).toBeTruthy();
  fireEvent(switchOf(screen, "Ofrecer entrega a domicilio"), "valueChange", false);
  await screen.findByText("Guardado");
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 6, home: { enabled: false } }));
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
  expect(switchOf(screen, "Ofrecer entrega a domicilio").props.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Cancelar edición" }).props.accessibilityState.disabled).toBe(true);
  expect(saveZones).toHaveBeenCalledTimes(1);
  expect(getZones).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Private detail")).toBeNull();
  fireEvent.press(screen.getByText("Recargar configuración"));
  await waitFor(() => expect(getZones).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText(/No pudimos confirmar el guardado/)).toBeNull());
  expect(screen.getByLabelText("Nombre de la zona *").props.value).toBe("My draft");
  expect(screen.getByRole("button", { name: "Guardar zona" }).props.accessibilityState.disabled).toBe(false);
});

test("a failed courier refresh after a zone save is reported and offers a reload", async () => {
  getZones.mockResolvedValue(ok(zonesState));
  get.mockResolvedValueOnce(ok({ version: 5, home: { enabled: true }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }))
    .mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "Private detail" }));
  saveZones.mockResolvedValue(ok({ ...zonesState, version: 6 }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Lima");
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar Lima" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByText("Editar Lima"));
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText("Zona guardada.");
  expect(await screen.findByRole("alert", { name: "No se pudo cargar la configuración" })).toBeTruthy();
  fireEvent.press(screen.getByText("Recargar configuración"));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.queryByText("No se pudo cargar la configuración")).toBeNull());
});

const agencyOf = (n: number, name: string, enabled = true) => ({ id: `00000000-0000-4000-8000-0000000002${n}0`, courierId: shalomId, name, address: `Av. ${name} 1`, enabled,
  location: { country: "PE" as const, districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA" } });

test("agency options list their catalog agencies, flag options without eligible ones, save the chosen associations and refresh couriers", async () => {
  const central = agencyOf(1, "Central");
  const north = agencyOf(2, "Norte");
  const closed = agencyOf(3, "Cerrada", false);
  const agencyOption = { id: optionId, method: "agency" as const, name: "A agencia", enabled: true, price: { amount: 5, currency: "PEN" as const }, agencyIds: [central.id] };
  const orphan = { ...agencyOption, id: "00000000-0000-4000-8000-000000000012", name: "Sin agencia", agencyIds: [closed.id] };
  const state = { ...zonesState, agency: { enabled: true }, agencies: [central, closed], zones: [{ ...homeZone, options: [agencyOption, orphan] }] };
  getZones.mockResolvedValue(ok(state));
  getAgencyCatalog.mockResolvedValue(ok({ agencies: [central, north] }));
  const shalom = { id: "00000000-0000-4000-8000-0000000000a1", courierId: shalomId, name: "Shalom", enabled: true };
  get.mockResolvedValueOnce(ok({ version: 5, home: { enabled: true }, agency: { enabled: true }, couriers: [{ ...shalom, enabled: false }],
    store: { enabled: false, pickupPoint: null } }))
    .mockResolvedValueOnce(ok({ version: 6, home: { enabled: true }, agency: { enabled: true }, couriers: [shalom], store: { enabled: false, pickupPoint: null } }));
  saveZones.mockResolvedValue(ok({ ...state, version: 6 }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Lima");
  expect(screen.getByText(/A agencia · Agencia · S\/ 5.00 · Sin agencias elegibles/)).toBeTruthy();
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
  expect(await screen.findByText(/A agencia · Agencia · S\/ 5.00$/)).toBeTruthy();
  expect(screen.getByText(/Sin agencia · Agencia · S\/ 5.00 · Sin agencias elegibles/)).toBeTruthy();
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
  get.mockResolvedValue(ok({ ...empty, agency: { enabled: true } }));
  getAgencyCatalog.mockResolvedValue(ok({ agencies: [] }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Agregar zona");
  await waitFor(() => expect(screen.getByRole("button", { name: "Agregar zona" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByText("Agregar zona"));
  fireEvent.changeText(screen.getByLabelText("Nombre de la zona *"), "Lima");
  getAgencyCatalog.mockClear();
  fireEvent.press(screen.getByText("Agregar opción a agencia"));
  expect(screen.getByText("Sin agencias: la opción no se ofrecerá al cotizar.")).toBeTruthy();
  // No courier is saved yet: the picker offers the catalog, since saving the zone is what enables a courier.
  await waitFor(() => expect(getAgencyCatalog).toHaveBeenCalledWith(shalomId));
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText(/Ingresa nombre, distritos/);
  expect(saveZones).not.toHaveBeenCalled();
});

test("agency warning shows next to the switch when the only agency option has no eligible agency", async () => {
  const closed = agencyOf(3, "Cerrada", false);
  const orphan = { id: optionId, method: "agency" as const, name: "A agencia", enabled: true, price: { amount: 5, currency: "PEN" as const }, agencyIds: [closed.id] };
  getZones.mockResolvedValue(ok({ ...zonesState, agency: { enabled: true }, agencies: [closed], zones: [{ ...homeZone, options: [orphan] }] }));
  get.mockResolvedValue(ok({ ...empty, version: 5, home: { enabled: true }, agency: { enabled: true } }));
  const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Lima");
  // Home is covered by nothing either, so both warnings show, one per switch, and none inside the zones section.
  expect(screen.getAllByText("Falta una opción de agencia activa con cobertura")).toHaveLength(1);
  expect(screen.getAllByText("Ir a zonas y tarifas")).toHaveLength(2);
  expect(screen.getByText("Falta una opción de domicilio activa con cobertura")).toBeTruthy();
  fireEvent.press(screen.getAllByText("Ir a zonas y tarifas")[1]!);
  expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
});

test("a rejected settings request shows the required-fields text without Reintentar", async () => {
  save.mockResolvedValueOnce(err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid" }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Entrega a domicilio");
  fireEvent(switchOf(screen, "Ofrecer entrega a domicilio"), "valueChange", true);
  await screen.findByText("Completa los campos obligatorios.");
  expect(screen.queryByText("Reintentar")).toBeNull();
  expect(switchOf(screen, "Ofrecer entrega a domicilio").props.value).toBe(false);
});

test("with an empty courier catalog the agency row explains it instead of a coverage warning", async () => {
  getCourierCatalog.mockResolvedValue(ok({ couriers: [] }));
  get.mockResolvedValue(ok({ ...empty, agency: { enabled: true } }));
  getZones.mockResolvedValue(ok({ ...zonesState, agency: { enabled: true }, zones: [] }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Todavía no hay couriers disponibles para envío a agencia. Mientras tanto, ofrece entrega a domicilio o recojo en tienda.");
  expect(screen.queryByText("Falta una opción de agencia activa con cobertura")).toBeNull();
});

test("the agency warning disappears after saving a zone option with an eligible agency, without a reload", async () => {
  const closed = agencyOf(3, "Cerrada", false);
  const open = agencyOf(4, "Abierta");
  const orphan = { id: optionId, method: "agency" as const, name: "A agencia", enabled: true, price: { amount: 5, currency: "PEN" as const }, agencyIds: [closed.id] };
  const state = { ...zonesState, agency: { enabled: true }, agencies: [closed, open], zones: [{ ...homeZone, options: [orphan] }] };
  const shalom = { id: "00000000-0000-4000-8000-0000000000a1", courierId: shalomId, name: "Shalom", enabled: true };
  getZones.mockResolvedValue(ok(state));
  getAgencyCatalog.mockResolvedValue(ok({ agencies: [open] }));
  get.mockResolvedValue(ok({ ...empty, version: 5, agency: { enabled: true }, couriers: [shalom] }));
  saveZones.mockResolvedValue(ok({ ...state, version: 6, zones: [{ ...homeZone, options: [{ ...orphan, agencyIds: [open.id] }] }] }));
  const screen = render(<DeliverySettingsScreen />);
  await screen.findByText("Lima");
  expect(screen.getByText("Falta una opción de agencia activa con cobertura")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar Lima" }).props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByText("Editar Lima"));
  await screen.findAllByText(/Abierta · MIRAFLORES/);
  fireEvent(screen.getAllByLabelText(/Abierta · MIRAFLORES/)[0]!, "valueChange", true);
  fireEvent.press(screen.getByText("Guardar zona"));
  await screen.findByText("Zona guardada.");
  await waitFor(() => expect(screen.queryByText("Falta una opción de agencia activa con cobertura")).toBeNull());
  expect(get).toHaveBeenCalledTimes(2);
});
