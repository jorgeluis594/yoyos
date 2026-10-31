import { fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import type { DeliveryZonesResponse } from "@shared/contracts/delivery-settings";
import { DeliveryZonesSection, coverageWarnings, useZonesCoverage, zonesCoverage } from "@mobile/features/delivery-settings/presentation/delivery-zones-section";
import "@mobile/i18n";

jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ children }: { children: import("react").ReactNode }) => children,
}));

const olva = { id: "00000000-0000-4000-8000-000000000102", code: "olva", name: "Olva" };
const legacy = { id: "00000000-0000-4000-8000-000000000011", method: "agency" as const, name: "Legado", enabled: true, price: { amount: 5, currency: "PEN" as const }, agencyIds: [] };
const state = { version: 5, currency: "PEN" as const, home: { enabled: true }, agency: { enabled: true }, agencies: [],
  zones: [{ id: "00000000-0000-4000-8000-000000000010", name: "Lima", enabled: true, departmentCodes: [], provinceCodes: [], districtCodes: ["150122"], options: [legacy] }] };

test("a new agency option needs an agency before saving, while a saved one without agencies stays saveable", async () => {
  const onSave = jest.fn(async () => ok(state));
  const screen = render(<DeliveryZonesSection state={state} couriers={[]} catalog={[olva]} loadAgencies={async () => ok({ agencies: [] })}
    disabled={false} blocked={false} onSave={onSave} onReload={() => undefined} />);
  fireEvent.press(screen.getByText("Editar Lima"));
  fireEvent.press(screen.getByText("Agregar opción a agencia"));
  fireEvent.changeText(screen.getAllByLabelText(/Nombre de la opción/)[1], "Olva");
  fireEvent.changeText(screen.getAllByLabelText(/Tarifa por pedido/)[1], "8");
  fireEvent.press(screen.getByText("Guardar zona"));
  expect(screen.getByText("Elige al menos una agencia de destino.")).toBeTruthy();
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText("Quitar opción"));
  fireEvent.press(screen.getByText("Guardar zona"));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ expectedVersion: 5, zones: [expect.objectContaining({ options: [
    expect.objectContaining({ kind: "existing", id: legacy.id, agencyIds: [] })] })] }));
});

const home = (name: string, amount: number) => ({ id: "00000000-0000-4000-8000-0000000000a1", method: "home" as const, name, enabled: true, price: { amount, currency: "PEN" as const } });
type Zone = DeliveryZonesResponse["zones"][number];
const zone = (id: string, name: string, enabled: boolean, areas: Partial<Pick<Zone, "departmentCodes" | "provinceCodes" | "districtCodes">>): Zone =>
  ({ id, name, enabled, departmentCodes: [], provinceCodes: [], districtCodes: [], options: [home(name, 15)], ...areas });
const withZones = (zones: Zone[]) => ({ ...state, zones });
const zonaSur = zone("00000000-0000-4000-8000-000000000020", "Zona sur", true, { departmentCodes: ["04", "08"] });
const renderSection = (zones: Zone[], onSave = jest.fn(async () => ok(state))) => ({ onSave, screen: render(<DeliveryZonesSection state={withZones(zones)} couriers={[]} catalog={[olva]}
  loadAgencies={async () => ok({ agencies: [] })} disabled={false} blocked={false} onSave={onSave} onReload={() => undefined} />) });

test("saved zone with Arequipa and Cusco reopens with both departments complete", async () => {
  const { screen, onSave } = renderSection([zonaSur, zone("00000000-0000-4000-8000-000000000021", "Lima", true, { districtCodes: ["150122", "150131"] })]);
  expect(screen.getByText("Arequipa, todos los distritos; Cusco, todos los distritos")).toBeTruthy();
  expect(screen.getByText("Miraflores · 150122; San Isidro · 150131")).toBeTruthy();
  fireEvent.press(screen.getByText("Editar Zona sur"));
  expect(screen.getByText("225 distritos seleccionados")).toBeTruthy();
  expect(screen.getByText("Arequipa ya está completo en la zona.")).toBeTruthy();
  expect(screen.getByLabelText("Todos los distritos de Arequipa").props.value).toBe(true);
  fireEvent.press(screen.getByText("Guardar zona"));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ expectedVersion: 5, zones: expect.arrayContaining([
    expect.objectContaining({ id: zonaSur.id, departmentCodes: ["04", "08"], provinceCodes: [], districtCodes: [] })]) }));
});

test("overlap notice counts districts shared with another enabled zone and ignores disabled ones", () => {
  const ciudad = zone("00000000-0000-4000-8000-000000000022", "Arequipa ciudad", true, { districtCodes: ["040103"] });
  const off = zone("00000000-0000-4000-8000-000000000023", "Inactiva", false, { districtCodes: ["040103"] });
  const { screen } = renderSection([zonaSur, ciudad, off]);
  fireEvent.press(screen.getByText("Editar Zona sur"));
  expect(screen.getByText("Comparte 1 distrito con Arequipa ciudad. Esos distritos recibirán las tarifas de ambas zonas.")).toBeTruthy();
});

test("a zone without any entry is not saved and asks for a district, province or department", () => {
  const { screen, onSave } = renderSection([]);
  fireEvent.press(screen.getByText("Agregar zona"));
  fireEvent.changeText(screen.getByLabelText(/Nombre de la zona/), "Vacía");
  fireEvent.press(screen.getByText("Agregar opción a domicilio"));
  fireEvent.changeText(screen.getByLabelText(/Nombre de la opción/), "Casa");
  fireEvent.changeText(screen.getByLabelText(/Tarifa por pedido/), "5");
  fireEvent.press(screen.getByText("Guardar zona"));
  expect(screen.getByText("Selecciona al menos un distrito, provincia o departamento.")).toBeTruthy();
  expect(onSave).not.toHaveBeenCalled();
});

test("a draft with a district inside a complete department is reported as invalid, not as empty", () => {
  const broken = zone("00000000-0000-4000-8000-000000000024", "Rota", true, { departmentCodes: ["04"], districtCodes: ["040103"] });
  const { screen, onSave } = renderSection([broken]);
  fireEvent.press(screen.getByText("Editar Rota"));
  fireEvent.press(screen.getByText("Guardar zona"));
  expect(screen.queryByText("Selecciona al menos un distrito, provincia o departamento.")).toBeNull();
  expect(screen.getByText(/Ingresa nombre, distritos y opciones/)).toBeTruthy();
  expect(onSave).not.toHaveBeenCalled();
});

const arequipaDistrict = "040101";
const cuscoDistrict = "080101";
const shalomId = "00000000-0000-4000-8000-000000000101";
const agencyIn = (n: number, districtCode: string, enabled = true): DeliveryZonesResponse["agencies"][number] => ({ id: `00000000-0000-4000-8000-0000000003${n}0`, courierId: shalomId,
  name: `Agencia ${n}`, address: "Av. 1", enabled, location: { country: "PE", districtCode, district: "D", province: "P", department: "X" } });
const viaAgencies = (...agencies: DeliveryZonesResponse["agencies"]) => ({ id: "00000000-0000-4000-8000-0000000000b1", method: "agency" as const, name: "Shalom", enabled: true,
  price: { amount: 8, currency: "PEN" as const }, agencyIds: agencies.map(agency => agency.id) });
const agencyWarning = (areas: Partial<Pick<Zone, "departmentCodes" | "provinceCodes" | "districtCodes">>, agencies: DeliveryZonesResponse["agencies"], enabledCourier = true) =>
  coverageWarnings(zonesCoverage([{ ...zone("00000000-0000-4000-8000-000000000030", "Zona", true, areas), options: [viaAgencies(...agencies)] }], agencies,
    [{ courierId: shalomId, name: "Shalom", enabled: enabledCourier }]), { home: true, agency: true }).agency;

test("agency coverage warning appears when the only zone covers Cusco and its agencies are all in Arequipa", () => {
  expect(agencyWarning({ departmentCodes: ["08"] }, [agencyIn(1, arequipaDistrict)])).toBe(true);
});

test("agency coverage warning disappears after adding an eligible agency in Cusco", () => {
  expect(agencyWarning({ departmentCodes: ["08"] }, [agencyIn(1, arequipaDistrict), agencyIn(2, cuscoDistrict)])).toBe(false);
});

test("agency coverage warning appears when the only agency is inactive because its catalog courier was retired", () => {
  expect(agencyWarning({ districtCodes: [arequipaDistrict] }, [agencyIn(1, arequipaDistrict, false)])).toBe(true);
  expect(agencyWarning({ districtCodes: [arequipaDistrict] }, [agencyIn(1, arequipaDistrict)], false)).toBe(true);
});

test("a zone over Arequipa, Cusco and Puno with agencies in Arequipa shows no warning", () => {
  expect(agencyWarning({ departmentCodes: ["04", "08", "21"] }, [agencyIn(1, arequipaDistrict)])).toBe(false);
});

test("home coverage warning follows the switch and the loaded zones", () => {
  const covered = zonesCoverage([zone("00000000-0000-4000-8000-000000000031", "Lima", true, { districtCodes: ["150122"] })], [], []);
  expect(coverageWarnings(covered, { home: true, agency: false })).toEqual({ home: false, agency: false });
  expect(coverageWarnings(zonesCoverage([], [], []), { home: true, agency: false })).toEqual({ home: true, agency: false });
  expect(coverageWarnings(zonesCoverage([], [], []), { home: false, agency: false })).toEqual({ home: false, agency: false });
  expect(coverageWarnings(null, { home: true, agency: true })).toEqual({ home: false, agency: false });
});

test("zones coverage hook returns the same object while zones and couriers keep their identity", () => {
  const zones = [zone("00000000-0000-4000-8000-000000000032", "Lima", true, { districtCodes: ["150122"] })];
  const couriers: { courierId: string; name: string; enabled: boolean }[] = [];
  const agencies: DeliveryZonesResponse["agencies"] = [];
  const hook = renderHook((props: { loaded: boolean; couriers: typeof couriers }) => useZonesCoverage(props.loaded ? zones : null, props.loaded ? agencies : null, props.couriers),
    { initialProps: { loaded: false, couriers } });
  expect(hook.result.current).toBeNull();
  hook.rerender({ loaded: true, couriers });
  const first = hook.result.current;
  expect(first).not.toBeNull();
  hook.rerender({ loaded: true, couriers });
  expect(hook.result.current).toBe(first);
  hook.rerender({ loaded: true, couriers: [...couriers] });
  expect(hook.result.current).not.toBe(first);
});
