import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import { DeliveryZonesSection } from "@mobile/features/delivery-settings/presentation/delivery-zones-section";
import "@mobile/i18n";

jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ children }: { children: import("react").ReactNode }) => children,
}));

const olva = { id: "00000000-0000-4000-8000-000000000102", code: "olva", name: "Olva" };
const legacy = { id: "00000000-0000-4000-8000-000000000011", method: "agency" as const, name: "Legado", enabled: true, price: { amount: 5, currency: "PEN" as const }, agencyIds: [] };
const state = { version: 5, currency: "PEN" as const, home: { enabled: true }, agency: { enabled: true }, agencies: [],
  zones: [{ id: "00000000-0000-4000-8000-000000000010", name: "Lima", enabled: true, districtCodes: ["150122"], options: [legacy] }] };

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
