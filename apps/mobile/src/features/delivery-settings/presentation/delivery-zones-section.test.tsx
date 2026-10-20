import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import type { DeliveryZonesResponse } from "@shared/contracts/delivery-settings";
import { DeliveryZonesSection } from "@mobile/features/delivery-settings/presentation/delivery-zones-section";
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
