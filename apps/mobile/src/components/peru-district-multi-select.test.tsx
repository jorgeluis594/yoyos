import { useState } from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { PeruDistrictMultiSelect } from "@mobile/components/peru-district-multi-select";
import { getPeruDistrict, getPeruProvinces, peruDepartments, type PeruDistrictCode } from "@shared/peru-geography";
import i18n from "@mobile/i18n";

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

function Selection() {
  const [value, setValue] = useState<readonly PeruDistrictCode[]>([]);
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
  expect(screen.getByText("MIRAFLORES · LIMA METROPOLITANA · LIMA · 150122")).toBeTruthy();
  fireEvent(screen.getByTestId("zone-department"), "valueChange", peruDepartments.indexOf(arequipaDepartment));
  fireEvent(screen.getByTestId("zone-province"), "valueChange", getPeruProvinces(arequipaDepartment.code).findIndex(item => item.code === arequipa.provinceCode));
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), "040110");
  fireEvent(screen.getByLabelText("MIRAFLORES · 040110"), "valueChange", true);
  expect(screen.getByText("2 distritos seleccionados")).toBeTruthy();
  await act(async () => { await i18n.changeLanguage("pt-BR"); });
  try {
    expect(screen.getByText("2 distritos selecionados")).toBeTruthy();
    expect(screen.getByText("MIRAFLORES · AREQUIPA · AREQUIPA · 040110")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Remover MIRAFLORES · LIMA METROPOLITANA · LIMA · 150122" }));
    expect(screen.getByText("1 distritos selecionados")).toBeTruthy();
    expect(screen.queryByText("MIRAFLORES · LIMA METROPOLITANA · LIMA · 150122")).toBeNull();
  } finally { screen.unmount(); await act(async () => { await i18n.changeLanguage("es"); }); }
});

test("disabled selection preserves coverage and disables both adding and removing", () => {
  const change = jest.fn();
  const screen = render(<PeruDistrictMultiSelect value={[lima.code]} onChange={change} disabled />);
  expect(screen.getByLabelText("MIRAFLORES · 150122").props.disabled).toBe(true);
  expect(screen.getByTestId("zone-department").props.accessibilityState.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Quitar MIRAFLORES · LIMA METROPOLITANA · LIMA · 150122" }).props.accessibilityState.disabled).toBe(true);
  expect(change).not.toHaveBeenCalled();
});
