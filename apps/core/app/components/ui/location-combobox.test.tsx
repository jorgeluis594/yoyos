// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { LocationCombobox, highlightMatch, matchesLocation, type LocationOption } from "@/components/ui/location-combobox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options: LocationOption[] = [
  { code: "150143", name: "VILLA EL SALVADOR" }, { code: "150144", name: "VILLA MARIA DEL TRIUNFO" },
  { code: "150122", name: "MIRAFLORES" }, { code: "150101", name: "LIMA" }, { code: "040110", name: "ÑAÑA" },
];
const mounted: (() => void)[] = [];
afterEach(() => { mounted.splice(0).forEach(unmount => unmount()); document.body.innerHTML = ""; });

async function mount(initial: string | null = null, changes: (string | null)[] = []) {
  function Harness() {
    const [value, setValue] = useState<string | null>(initial);
    return <LocationCombobox id="district" label="Distrito" placeholder="Selecciona un distrito" emptyText="Sin resultados" options={options} value={value}
      onChange={code => { changes.push(code); setValue(code); }} />;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  mounted.push(() => root.unmount());
  return container.querySelector<HTMLInputElement>("input")!;
}
async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    // Without an inputType the control treats the change as autofill and does not open the list.
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  });
}
const press = (input: HTMLInputElement, key: string) => act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const optionNames = () => [...document.querySelectorAll("[role=option]")].map(item => item.textContent);

test("matching ignores accents and case and never uses the code", () => {
  expect(matchesLocation("ÑAÑA", "nana")).toBe(true);
  expect(matchesLocation("VILLA MARÍA", "maria")).toBe(true);
  expect(matchesLocation("MIRAFLORES", "  MiRa ")).toBe(true);
  expect(matchesLocation("MIRAFLORES", "150122")).toBe(false);
  expect(matchesLocation("LIMA", "")).toBe(true);
});

test("highlightMatch splits the name around the accent-insensitive match", () => {
  expect(highlightMatch("VILLA MARÍA DEL TRIUNFO", "maria")).toEqual({ before: "VILLA ", match: "MARÍA", after: " DEL TRIUNFO" });
  expect(highlightMatch("LIMA", "xyz")).toBeNull();
  expect(highlightMatch("LIMA", "")).toBeNull();
});

test("exposes the combobox role with an accessible name and no code in the DOM", async () => {
  const input = await mount();
  expect(input.getAttribute("role")).toBe("combobox");
  expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Distrito");
  expect(input.placeholder).toBe("Selecciona un distrito");
  await type(input, "villa");
  expect(document.querySelector("[role=listbox]")).not.toBeNull();
  expect(document.body.textContent).not.toMatch(/\d{6}/);
});

test("typing villa lists the two matching districts with the match in bold", async () => {
  const input = await mount();
  await type(input, "villa");
  expect(optionNames()).toEqual(["VILLA EL SALVADOR", "VILLA MARIA DEL TRIUNFO"]);
  expect(document.querySelector("[role=option] strong")?.textContent?.toLowerCase()).toBe("villa");
});

test("shows the empty message when nothing matches", async () => {
  const input = await mount();
  await type(input, "zzz");
  expect(optionNames()).toEqual([]);
  expect(document.body.textContent).toContain("Sin resultados");
});

test("arrows and Enter pick the highlighted option and report only its code", async () => {
  const changes: (string | null)[] = [];
  const input = await mount(null, changes);
  await type(input, "villa");
  // The first option starts highlighted, so one ArrowDown reaches the second.
  await press(input, "ArrowDown");
  expect(input.getAttribute("aria-activedescendant")).toBe(document.querySelectorAll("[role=option]")[1]!.id);
  await press(input, "Enter");
  expect(changes).toEqual(["150144"]);
  expect(input.value).toBe("VILLA MARIA DEL TRIUNFO");
});

test("Escape closes the list without choosing", async () => {
  const changes: (string | null)[] = [];
  const input = await mount(null, changes);
  await type(input, "lima");
  expect(document.querySelector("[role=listbox]")).not.toBeNull();
  await press(input, "Escape");
  expect(document.querySelector("[role=listbox]")).toBeNull();
  expect(changes).toEqual([]);
});

test("a chosen value shows its name and opens the full list again", async () => {
  const input = await mount("150122");
  expect(input.value).toBe("MIRAFLORES");
  await press(input, "ArrowDown");
  expect(optionNames()).toHaveLength(options.length);
});

test("a parent that clears the value empties the input", async () => {
  function Harness() {
    const [value, setValue] = useState<string | null>("150122");
    return <><button id="clear" onClick={() => setValue(null)} /><LocationCombobox id="d" label="Distrito" placeholder="" emptyText="" options={options} value={value} onChange={setValue} /></>;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  mounted.push(() => root.unmount());
  const input = container.querySelector("input")!;
  expect(input.value).toBe("MIRAFLORES");
  await act(async () => container.querySelector<HTMLButtonElement>("#clear")!.click());
  expect(input.value).toBe("");
});

test("disabled combobox cannot be focused for typing", async () => {
  function Harness() { return <LocationCombobox id="d" label="Distrito" placeholder="" emptyText="" options={[]} value={null} onChange={() => undefined} disabled />; }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  mounted.push(() => root.unmount());
  expect(container.querySelector("input")!.disabled).toBe(true);
});
