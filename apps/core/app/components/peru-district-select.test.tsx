// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { PeruDistrictSelect, PeruLocationFields } from "@core/app/components/peru-district-select";
import { filterPeruDistricts, getPeruDistrict, getPeruDistricts, type PeruArea, type PeruProvinceCode } from "@shared/peru-geography";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const withI18n = (element: React.ReactElement) => <I18nextProvider i18n={i18n}>{element}</I18nextProvider>;

const district = getPeruDistrict("150122");
if (!district) throw new Error("Official district missing");

test("hierarchy preselects the department, province and district by name, never showing the ubigeo", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictSelect value={district.code} onChange={() => undefined} />));
  expect(html).toContain('value="Lima"');
  expect(html).toContain('value="Miraflores"');
  expect(html).not.toMatch(/\d{6}/);
  expect(html).not.toContain("<select");
});

test("empty selection requires hierarchy and provides labelled comboboxes", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictSelect value={null} onChange={() => undefined} />));
  for (const label of ["Departamento", "Provincia", "Distrito"]) expect(html).toContain(label);
  expect(html).not.toContain("Buscar distrito");
  expect((html.match(/<input[^>]*role="combobox"/g) ?? []).length).toBe(3);
  expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(html).toContain("Escribe para buscar y elige tu distrito en la misma lista.");
});

test("district search ignores accents and case and supports official codes within the selected province", () => {
  const districts = getPeruDistricts(district.provinceCode);
  expect(filterPeruDistricts(districts, "  míRAflores ").map(item => item.code)).toEqual(["150122", "150133"]);
  expect(filterPeruDistricts(districts, "150122")).toEqual([district]);
  expect(filterPeruDistricts(districts, "not a district")).toEqual([]);
  expect(filterPeruDistricts(districts, "")).toEqual(districts);
});

test("themed, department and province stay in two columns, also on phones, inside one field of the group", () => {
  const html = renderToStaticMarkup(withI18n(<PeruDistrictSelect themed value={district.code} onChange={() => undefined} />));
  expect(html).toMatch(/data-store-part="field" class="min-w-0"><div class="grid min-w-0 gap-3 grid-cols-2">[\s\S]*-department[\s\S]*-province/);
});

const mounted: (() => void)[] = [];
afterEach(() => { mounted.splice(0).forEach(unmount => unmount()); document.body.innerHTML = ""; });

async function mount(initial: string | null, changes: (string | null)[]) {
  function Harness() {
    const [code, setCode] = useState<string | null>(initial);
    return withI18n(<PeruDistrictSelect value={code as never} onChange={next => { changes.push(next); setCode(next); }} />);
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  mounted.push(() => root.unmount());
  const input = (label: string) => document.querySelector<HTMLInputElement>(`input[id$="-${label}"]`)!;
  return { department: () => input("department"), province: () => input("province"), district: () => input("district") };
}
async function choose(input: HTMLInputElement, text: string) {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
}

test("choosing by name emits only the district code and changing a parent clears the child", async () => {
  const changes: (string | null)[] = [];
  const fields = await mount(null, changes);
  await choose(fields.department(), "lima");
  await choose(fields.province(), "lima");
  await choose(fields.district(), "villa");
  expect(changes.at(-1)).toBe("150142");
  expect(fields.district().value).toBe("Villa El Salvador");
  expect(document.body.textContent).not.toMatch(/\d{6}/);
  await choose(fields.province(), "huaura");
  expect(changes.at(-1)).toBeNull();
  expect(fields.district().value).toBe("");
  await choose(fields.department(), "arequipa");
  expect(fields.province().value).toBe("");
  expect(fields.district().disabled).toBe(true);
});

test("a parent re-render while typing keeps the typed district query", async () => {
  let rerender = () => undefined as void;
  function Harness() {
    const [, setTick] = useState(0);
    rerender = () => setTick(tick => tick + 1);
    return withI18n(<PeruDistrictSelect value={"040101" as never} onChange={() => undefined} />);
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  mounted.push(() => root.unmount());
  const district = document.querySelector<HTMLInputElement>('input[id$="-district"]')!;
  expect(district.value).toBe("Arequipa");
  await act(async () => {
    district.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(district, "Miraflores");
    district.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Miraflores" }));
  });
  await act(async () => rerender());
  expect(district.value).toBe("Miraflores");
});

test("choosing the current department or province again keeps the children", async () => {
  const changes: (string | null)[] = [];
  const fields = await mount("150122", changes);
  await choose(fields.department(), "lima");
  await choose(fields.province(), "lima");
  expect(changes).toEqual([]);
  expect(fields.district().value).toBe("Miraflores");
});

const lima = { kind: "district", code: "150122" } as PeruArea;
const optionTexts = () => [...document.querySelectorAll('[role="option"]')].map(option => option.textContent);
const open = (input: HTMLInputElement) => act(async () => {
  input.focus();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
});
// Types a text that matches nothing so the popup opens on its empty text.
const typeOnly = (input: HTMLInputElement, text: string) => act(async () => {
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
});
async function mountFields(initial: PeruArea | null, props: Partial<React.ComponentProps<typeof PeruLocationFields>>, changes: [PeruArea | null, string][] = []) {
  function Harness() {
    const [area, setArea] = useState<PeruArea | null>(initial);
    return withI18n(<PeruLocationFields value={area} onChange={(next, level) => { changes.push([next, level]); setArea(next); }} {...props} />);
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  mounted.push(() => root.unmount());
  const input = (label: string) => document.querySelector<HTMLInputElement>(`input[id$="-${label}"]`)!;
  return { department: () => input("department"), province: () => input("province"), district: () => input("district") };
}
const texts = { groupHint: "Solo mostramos donde llega la tienda.", noResults: { department: "Sin departamentos", province: "Sin provincias", district: "Sin distritos" } };

test("location fields list only the given places and the whole country without them", async () => {
  const places = { departmentCodes: [], provinceCodes: ["1501" as PeruProvinceCode], districtCodes: [] };
  const limited = await mountFields({ kind: "province", code: "1501" as PeruProvinceCode }, { places });
  await open(limited.department());
  expect(optionTexts()).toEqual(["Lima"]);
  await open(limited.province());
  expect(optionTexts()).toEqual(["Lima"]);
  await open(limited.district());
  const districts = optionTexts();
  expect(districts).toHaveLength(43);
  expect(districts).not.toContain("Huamantanga");
  mounted.splice(0).forEach(unmount => unmount());
  const whole = await mountFields(null, {});
  await open(whole.department());
  expect(optionTexts()).toHaveLength(25);
});

test("location fields with checkout texts show the group hint as the description of Departamento only and the checkout empty texts per level", async () => {
  const fields = await mountFields(lima, { texts });
  const hint = document.querySelector("legend + p")!;
  expect(hint.textContent).toBe(texts.groupHint);
  expect(fields.department().getAttribute("aria-describedby")).toBe(hint.id);
  expect(fields.province().getAttribute("aria-describedby")).toBeNull();
  expect(fields.district().getAttribute("aria-describedby")).toBeNull();
  expect(document.body.textContent).not.toContain("Escribe para buscar y elige tu distrito");
  await typeOnly(fields.district(), "zzzz");
  expect(document.body.textContent).toContain("Sin distritos");
});

test("seller district select keeps its hint, its empty text and the 25 departments", async () => {
  const fields = await mount(null, []);
  expect(fields.department().getAttribute("aria-describedby")).toBeNull();
  expect(document.body.textContent).toContain("Escribe para buscar y elige tu distrito en la misma lista.");
  await open(fields.department());
  expect(optionTexts()).toHaveLength(25);
  await typeOnly(fields.department(), "zzzz");
  expect(document.body.textContent).toContain("No hay resultados. Prueba con otro nombre.");
});

test("location fields report the changed level and clear the levels below", async () => {
  const changes: [PeruArea | null, string][] = [];
  const fields = await mountFields(lima, {}, changes);
  await choose(fields.department(), "arequipa");
  expect(changes.at(-1)).toEqual([{ kind: "department", code: "04" }, "department"]);
  expect(fields.province().value).toBe("");
  await choose(fields.province(), "caylloma");
  expect(changes.at(-1)).toEqual([{ kind: "province", code: "0405" }, "province"]);
  await choose(fields.district(), "chivay");
  expect(changes.at(-1)).toEqual([{ kind: "district", code: "040501" }, "district"]);
  await choose(fields.province(), "");
  expect(changes.at(-1)).toEqual([{ kind: "department", code: "04" }, "province"]);
  expect(fields.district().value).toBe("");
});
