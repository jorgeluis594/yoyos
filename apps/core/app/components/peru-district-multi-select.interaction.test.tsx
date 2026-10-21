// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { PeruDistrictMultiSelect } from "@core/app/components/peru-district-multi-select";
import { selectPeruArea, type PeruAreaSelection } from "@shared/peru-geography";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const none: PeruAreaSelection = { departmentCodes: [], provinceCodes: [], districtCodes: [] };

async function uncheck(value: PeruAreaSelection, label: string) {
  const changes: PeruAreaSelection[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<I18nextProvider i18n={i18n}><PeruDistrictMultiSelect value={value} onChange={change => changes.push(change)} /></I18nextProvider>));
  const checkbox = [...container.querySelectorAll("label")].find(item => item.textContent === label)!.querySelector<HTMLButtonElement>("button[role=checkbox]")!;
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  await act(async () => checkbox.click());
  root.unmount();
  return changes;
}

test("unchecking a complete department or province removes only that unit", async () => {
  const department = selectPeruArea({ ...none, districtCodes: ["150122" as never] }, { kind: "department", code: "04" as never }, true);
  expect(await uncheck(department, "Todos los distritos de Arequipa")).toEqual([{ ...none, districtCodes: ["150122"] }]);
  expect(await uncheck({ ...none, provinceCodes: ["1501" as never] }, "Todos los distritos de la provincia Lima")).toEqual([none]);
});
