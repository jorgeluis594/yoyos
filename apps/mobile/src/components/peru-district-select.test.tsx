import { useState } from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { PeruDistrictSelect } from "@mobile/components/peru-district-select";
import { getPeruDistrict, getPeruProvinces, peruDepartments, type PeruDistrictCode } from "@shared/peru-geography";
import "@mobile/i18n";

jest.mock("@expo/ui", () => {
  const { View, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  const Picker = ({ onValueChange, children, testID, enabled }: { onValueChange: (value: number) => void; children: React.ReactNode; testID?: string; enabled: boolean }) =>
    <View testID={testID} accessible accessibilityRole="adjustable" accessibilityState={{ disabled: !enabled }} {...{ onValueChange }}>{children}</View>;
  Picker.Item = function PickerItem({ label }: { label: string }) { return <Text>{label}</Text>; };
  return { Host: View, Picker };
});
const lima = getPeruDistrict("150122")!;
const arequipa = getPeruDistrict("040110")!;
function Selection() {
  const [value, setValue] = useState<PeruDistrictCode | null>(lima.code);
  return <PeruDistrictSelect value={value} onChange={setValue} />;
}
test("search preserves the chosen district and changing hierarchy requires a new official selection", () => {
  const screen = render(<Selection />);
  expect(screen.getByText("MIRAFLORES · LIMA METROPOLITANA · LIMA · 150122")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), "no results");
  expect(screen.getByText("No hay distritos con esa búsqueda.")).toBeTruthy();
  expect(screen.getByText("MIRAFLORES · LIMA METROPOLITANA · LIMA · 150122")).toBeTruthy();
  fireEvent(screen.getByTestId("delivery-department"), "valueChange", peruDepartments.findIndex(item => item.code === arequipa.departmentCode));
  expect(screen.queryByText("MIRAFLORES · LIMA METROPOLITANA · LIMA · 150122")).toBeNull();
  expect(screen.getByTestId("delivery-district").props.accessibilityState.disabled).toBe(true);
  fireEvent(screen.getByTestId("delivery-province"), "valueChange", getPeruProvinces(arequipa.departmentCode).findIndex(item => item.code === arequipa.provinceCode));
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), "miraflores");
  fireEvent(screen.getByTestId("delivery-district"), "valueChange", 0);
  expect(screen.getByText("MIRAFLORES · AREQUIPA · AREQUIPA · 040110")).toBeTruthy();
});
test("disabled district controls retain the loaded destination", () => {
  const change = jest.fn();
  const screen = render(<PeruDistrictSelect value={lima.code} onChange={change} disabled />);
  for (const id of ["delivery-department", "delivery-province", "delivery-district"])
    expect(screen.getByTestId(id).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByLabelText("Buscar distrito").props.editable).toBe(false);
  expect(change).not.toHaveBeenCalled();
});
