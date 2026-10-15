import { fireEvent, render } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import { AgencyPicker } from "@mobile/features/delivery-settings/presentation/agency-picker";
import "@mobile/i18n";

jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ actions, onPressAction, children }: { actions: { id: string; title: string }[]; onPressAction: (event: { nativeEvent: { event: string } }) => void; children: import("react").ReactNode }) => {
    const mockReact = jest.requireActual("react");
    const mockRN = jest.requireActual("react-native");
    return mockReact.createElement(mockReact.Fragment, null, children, ...actions.map(action => mockReact.createElement(
      mockRN.Pressable,
      { key: action.id, accessibilityRole: "menuitem", accessibilityLabel: action.title, onPress: () => onPressAction({ nativeEvent: { event: action.id } }) },
    )));
  },
}));

const retiredId = "00000000-0000-4000-8000-000000000101";
const olvaId = "00000000-0000-4000-8000-000000000102";
const agency = { id: "00000000-0000-4000-8000-000000000210", courierId: retiredId, name: "Central", address: "Av. Central 1", enabled: true,
  location: { country: "PE" as const, districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA" } };

test("a saved option keeps its retired courier without browsing another catalog, and changing courier drops its agencies", () => {
  const loadCatalog = jest.fn(async () => ok({ agencies: [] }));
  const onChange = jest.fn();
  const screen = render(<AgencyPicker couriers={[{ courierId: olvaId, name: "Olva" }]} knownCouriers={[{ courierId: retiredId, name: "Shalom" }]}
    known={[agency]} value={[agency.id]} disabled={false} loadCatalog={loadCatalog} onChange={onChange} />);
  expect(screen.getByTestId("agency-courier").props.accessibilityLabel).toBe("Courier: Shalom");
  expect(screen.getByText(/Este courier ya no está disponible/)).toBeTruthy();
  expect(screen.queryByLabelText("Buscar agencia por nombre, distrito o dirección")).toBeNull();
  expect(loadCatalog).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("menuitem", { name: "Olva" }));
  expect(onChange).toHaveBeenCalledWith([]);
});
