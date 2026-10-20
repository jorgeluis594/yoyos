import { useState } from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { PeruDistrictMultiSelect } from "@mobile/components/peru-district-multi-select";
import { getPeruDistrict, getPeruProvinces, peruDepartments, type PeruAreaSelection } from "@shared/peru-geography";
import i18n from "@mobile/i18n";

jest.mock("@expo/ui/community/menu", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { MenuView: ({ children, onPressAction }: { children: React.ReactNode; onPressAction: (event: { nativeEvent: { event: string } }) => void }) =>
    <View {...{ onValueChange: (index: number) => onPressAction({ nativeEvent: { event: String(index) } }) }}>{children}</View> };
});
jest.mock("@expo/ui", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Picker = ({ onValueChange, children, testID, enabled }: { onValueChange: (value: number) => void; children: React.ReactNode; testID?: string; enabled: boolean }) =>
    <View testID={testID} accessible accessibilityRole="adjustable" accessibilityState={{ disabled: !enabled }} {...{ onValueChange }}>{children}</View>;
  Picker.Item = function PickerItem({ label }: { label: string }) {
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return <Text>{label}</Text>;
  };
  return { Host: View, Picker };
});
const lima = getPeruDistrict("150122");
const arequipa = getPeruDistrict("040110");
if (!lima || !arequipa) throw new Error("Official districts missing");
const limaDepartment = peruDepartments.find(item => item.code === lima.departmentCode)!;
const arequipaDepartment = peruDepartments.find(item => item.code === arequipa.departmentCode)!;

const none: PeruAreaSelection = { departmentCodes: [], provinceCodes: [], districtCodes: [] };
function Selection({ initial = none }: Readonly<{ initial?: PeruAreaSelection }>) {
  const [value, setValue] = useState<PeruAreaSelection>(initial);
  return <PeruDistrictMultiSelect value={value} onChange={setValue} />;
}
test("district selection persists across provinces, search and language changes without duplicates", async () => {
  const screen = render(<Selection />);
  fireEvent(screen.getByTestId("zone-department"), "valueChange", peruDepartments.indexOf(limaDepartment));
  fireEvent(screen.getByTestId("zone-province"), "valueChange", getPeruProvinces(limaDepartment.code).findIndex(item => item.code === lima.provinceCode));
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), "150122");
  fireEvent(screen.getByLabelText("MIRAFLORES · 150122"), "valueChange", true);
  fireEvent(screen.getByLabelText("MIRAFLORES · 150122"), "valueChange", true);
  expect(screen.getByText("1 distritos seleccionados")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), "not a district");
  expect(screen.getByText("No hay distritos con esa búsqueda.")).toBeTruthy();
  expect(screen.getByText("Miraflores · 150122")).toBeTruthy();
  fireEvent(screen.getByTestId("zone-department"), "valueChange", peruDepartments.indexOf(arequipaDepartment));
  fireEvent(screen.getByTestId("zone-province"), "valueChange", getPeruProvinces(arequipaDepartment.code).findIndex(item => item.code === arequipa.provinceCode));
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), "040110");
  fireEvent(screen.getByLabelText("MIRAFLORES · 040110"), "valueChange", true);
  expect(screen.getByText("2 distritos seleccionados")).toBeTruthy();
  await act(async () => { await i18n.changeLanguage("pt-BR"); });
  try {
    expect(screen.getByText("2 distritos selecionados")).toBeTruthy();
    expect(screen.getByText("Miraflores · 040110")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Remover Miraflores · 150122" }));
    expect(screen.getByText("1 distritos selecionados")).toBeTruthy();
    expect(screen.queryByText("Miraflores · 150122")).toBeNull();
  } finally { screen.unmount(); await act(async () => { await i18n.changeLanguage("es"); }); }
});

test("disabled selection preserves coverage and disables both adding and removing", () => {
  const change = jest.fn();
  const screen = render(<PeruDistrictMultiSelect value={{ ...none, districtCodes: [lima.code] }} onChange={change} disabled />);
  expect(screen.getByLabelText("MIRAFLORES · 150122").props.disabled).toBe(true);
  expect(screen.getByTestId("zone-department").props.accessibilityState.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Quitar Miraflores · 150122" }).props.accessibilityState.disabled).toBe(true);
  expect(change).not.toHaveBeenCalled();
});

test("marking Arequipa complete shows one entry and disables its provinces and districts", () => {
  const cayma = getPeruDistrict("040103")!;
  const screen = render(<Selection initial={{ ...none, districtCodes: [cayma.code] }} />);
  expect(screen.getByText("Cayma · 040103")).toBeTruthy();
  fireEvent(screen.getByLabelText("Todos los distritos de Arequipa"), "valueChange", true);
  expect(screen.getByText("109 distritos seleccionados")).toBeTruthy();
  expect(screen.getByText("Arequipa, todos los distritos")).toBeTruthy();
  expect(screen.queryByText("Cayma · 040103")).toBeNull();
  expect(screen.getByText("Arequipa ya está completo en la zona.")).toBeTruthy();
  expect(screen.getByTestId("zone-province").props.accessibilityState.disabled).toBe(true);
  expect(screen.queryByLabelText("CAYMA · 040103")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Quitar Arequipa" }));
  expect(screen.getByText("0 distritos seleccionados")).toBeTruthy();
  expect(screen.queryByText("Arequipa, todos los distritos")).toBeNull();
});

test("marking a province complete shows it as Lima and unmarking leaves nothing", () => {
  const screen = render(<Selection initial={{ ...none, provinceCodes: [getPeruDistrict("150122")!.provinceCode] }} />);
  expect(screen.getByText("Lima (provincia), todos los distritos")).toBeTruthy();
  expect(screen.getByText("Lima (provincia) ya está completa en la zona.")).toBeTruthy();
  fireEvent(screen.getByLabelText("Todos los distritos de la provincia Lima"), "valueChange", false);
  expect(screen.queryByText("Lima (provincia), todos los distritos")).toBeNull();
});
