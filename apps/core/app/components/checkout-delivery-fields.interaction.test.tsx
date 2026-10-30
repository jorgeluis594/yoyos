// @vitest-environment jsdom
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { CheckoutDeliveryFields } from "@core/app/components/checkout-delivery-fields";
import { enterLocationMethod } from "@core/app/components/checkout-location";
import { requestDeliveryQuotation } from "@core/src/features/delivery-settings/infrastructure/quotation-api";
import { err, ok } from "@shared/functional";
import { canonicalPeruArea } from "@shared/peru-geography";
import type { CheckoutDeliveryOptions, PublicCheckoutResponse } from "@shared/contracts/order-checkout";

vi.mock("@core/app/components/checkout-location", async importOriginal => {
  const actual = await importOriginal<typeof import("@core/app/components/checkout-location")>();
  return { ...actual, enterLocationMethod: vi.fn(actual.enterLocationMethod) };
});
vi.mock("@core/src/features/delivery-settings/infrastructure/quotation-api", () => ({ requestDeliveryQuotation: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const instances = { es: createInstance(), pt: createInstance() };
await instances.es.use(initReactI18next).init({ lng: "es", resources });
await instances.pt.use(initReactI18next).init({ lng: "pt", resources });

const total = { amount: 10, currency: "PEN" as const };
const checkout: PublicCheckoutResponse = { companyName: "Shop", number: 1001, buyer: null, delivery: null,
  deliveryCharge: { amount: 0, currency: "PEN" }, itemsTotal: total, total,
  items: [{ productName: "Product", variantAttributes: {}, sku: null, imageUrl: null, quantity: 1, unitPrice: total, subtotal: total }], state: { kind: "pending" } };
const savedHome = (districtCode: string): PublicCheckoutResponse => ({ ...checkout, deliveryCharge: { amount: 8, currency: "PEN" }, total: { amount: 18, currency: "PEN" }, delivery: {
  method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { address: "Old street", country: "PE", districtCode, district: "Old district", province: "Lima", department: "Lima", instructions: null },
  pricing: { quotationId: "00000000-0000-4000-8000-000000000020", rateId: "00000000-0000-4000-8000-000000000021", optionId: "00000000-0000-4000-8000-000000000022", settingsVersion: 1 },
} } as PublicCheckoutResponse);
type Area = ReturnType<typeof canonicalPeruArea>;
const savedStore = { ...checkout, delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
  pickupPoint: { name: "Shop", address: "Street", instructions: null } } } as unknown as PublicCheckoutResponse;
const places = (codes: Partial<{ departmentCodes: string[]; provinceCodes: string[]; districtCodes: string[] }>): Area =>
  canonicalPeruArea({ departmentCodes: [], provinceCodes: [], districtCodes: [], ...codes });
const store = { enabled: true as const, pickupPoint: { name: "Shop", address: "Street", instructions: null } };
const method = (area: Area | null) => area ? { offered: true as const, places: area } : { offered: false as const };
const optionsOf = (home: Area | null, agency: Area | null): CheckoutDeliveryOptions => ({ home: method(home), agency: method(agency), store }) as CheckoutDeliveryOptions;

const mounted: (() => void)[] = [];
const requests = vi.mocked(requestDeliveryQuotation);
beforeEach(() => { requests.mockReset(); requests.mockResolvedValue(ok({ rates: [] } as never)); });
afterEach(() => { mounted.splice(0).forEach(unmount => unmount()); document.body.innerHTML = ""; });

function element(options: CheckoutDeliveryOptions, value = checkout, language: "es" | "pt" = "es") {
  return <I18nextProvider i18n={instances[language]}><CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001" checkout={value} options={options}
    recipient={{ name: "Ana", phone: "+51977909427" }} onChange={() => undefined} /></I18nextProvider>;
}
async function mount(options: CheckoutDeliveryOptions, value = checkout, language: "es" | "pt" = "es") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element(options, value, language)));
  mounted.push(() => root.unmount());
  return container;
}
const input = (level: "department" | "province" | "district") => document.querySelector<HTMLInputElement>(`input[id$="-${level}"]`)!;
const regions = () => [...document.querySelectorAll('[role="status"]')].filter(item => item.getAttribute("aria-live") === "polite");
const notice = () => regions()[0]!.textContent;
const loading = () => regions()[1]!.textContent;
const values = () => [input("department").value, input("province").value, input("district").value];
const typed = (field: HTMLInputElement, text: string) => act(async () => {
  field.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
});
const enter = (field: HTMLInputElement) => act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
const choose = async (field: HTMLInputElement, text: string) => { await typed(field, text); await enter(field); };
const clear = async (field: HTMLInputElement) => { await typed(field, ""); await enter(field); };
const open = (field: HTMLInputElement) => act(async () => { field.focus(); field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
const optionTexts = () => [...document.querySelectorAll('[role="option"]')].map(option => option.textContent);
const pickMethod = (value: string) => act(async () => { document.querySelector<HTMLInputElement>(`input[type=radio][value=${value}]`)!.click(); });
const calls = () => requests.mock.calls.map(([request]) => [request.districtCode, request.trigger]);

const preselectedText = "Completamos automáticamente los campos que tienen una sola opción.";
const lima = places({ provinceCodes: ["1501"] });

test("a store covering province Lima opens home with Lima and Lima preselected, the preselection notice and no Huamantanga", async () => {
  await mount(optionsOf(lima, null));
  expect(values()).toEqual(["Lima", "Lima", ""]);
  expect(notice()).toBe(preselectedText);
  await open(input("district"));
  expect(optionTexts()).toHaveLength(43);
  expect(optionTexts()).not.toContain("Huamantanga");
  expect(requests).not.toHaveBeenCalled();
});

test("picking a province under a whole department empties the notice and quotes the picked district", async () => {
  await mount(optionsOf(places({ departmentCodes: ["15"] }), null));
  expect(values()).toEqual(["Lima", "", ""]);
  expect(notice()).toBe(preselectedText);
  await choose(input("province"), "canta");
  expect(notice()).toBe("");
  await choose(input("district"), "huaros");
  expect(calls()).toEqual([["150404", "picked"]]);
});

test("a store covering only Miraflores fills the three levels on load and requests one quotation without buyer action", async () => {
  await mount(optionsOf(places({ districtCodes: ["150122"] }), null));
  expect(values()).toEqual(["Lima", "Lima", "Miraflores"]);
  expect(notice()).toBe(preselectedText);
  expect(calls()).toEqual([["150122", "automatic"]]);
});

test("switching from home to agency shows a single cleared message and issues no quotation for the old district", async () => {
  await mount(optionsOf(lima, places({ departmentCodes: ["04"] })));
  await choose(input("district"), "miraflores");
  expect(calls()).toEqual([["150122", "picked"]]);
  await pickMethod("agency");
  expect(notice()).toBe("Envío a agencia no llega a Miraflores. Completamos los campos que tienen una sola opción; elige tu distrito.");
  expect(values()).toEqual(["Arequipa", "", ""]);
  expect(calls()).toEqual([["150122", "picked"]]);
  expect(regions()).toHaveLength(2);
});

test("switching methods with a covered district issues exactly one quotation for it", async () => {
  await mount(optionsOf(lima, lima));
  await choose(input("district"), "miraflores");
  await pickMethod("agency");
  expect(notice()).toBe("");
  expect(values()).toEqual(["Lima", "Lima", "Miraflores"]);
  expect(calls()).toEqual([["150122", "picked"], ["150122", "automatic"]]);
});

test("switching to agency where only Yanahuara is covered preselects it and requests its quotation with trigger automatic", async () => {
  await mount(optionsOf(lima, places({ districtCodes: ["040126"] })));
  await choose(input("district"), "miraflores");
  await pickMethod("agency");
  expect(values()).toEqual(["Arequipa", "Arequipa", "Yanahuara"]);
  expect(notice()).toBe("Envío a agencia no llega a Miraflores. Completamos los campos que tienen una sola opción.");
  expect(calls().at(-1)).toEqual(["040126", "automatic"]);
});

test("the last picked district survives keeping the saved delivery and returning to home", async () => {
  await mount(optionsOf(lima, null), savedHome("150101"));
  await pickMethod("home");
  expect(values()).toEqual(["Lima", "Lima", "Lima"]);
  await choose(input("district"), "miraflores");
  await pickMethod("keep");
  await pickMethod("home");
  expect(values()).toEqual(["Lima", "Lima", "Miraflores"]);
});

test("a fresh form starts home from the saved delivery district", async () => {
  await mount(optionsOf(lima, null), savedHome("150122"));
  expect(document.querySelector<HTMLInputElement>("input[type=radio][value=keep]")!.checked).toBe(true);
  await pickMethod("home");
  expect(values()).toEqual(["Lima", "Lima", "Miraflores"]);
  expect(notice()).toBe("");
  expect(calls()).toEqual([["150122", "automatic"]]);
});

test("a saved district outside coverage is reported cleared when entering home", async () => {
  await mount(optionsOf(lima, null), savedHome("150403"));
  await pickMethod("home");
  expect(values()).toEqual(["Lima", "Lima", ""]);
  expect(notice()).toBe("Entrega a domicilio no llega a Huamantanga. Completamos los campos que tienen una sola opción; elige tu distrito.");
});

test("clearing a preselected district leaves it empty, empties the notice and quotes nothing until it is picked again", async () => {
  await mount(optionsOf(places({ districtCodes: ["150122"] }), null));
  expect(calls()).toHaveLength(1);
  await clear(input("district"));
  expect(values()).toEqual(["Lima", "Lima", ""]);
  expect(notice()).toBe("");
  expect(calls()).toHaveLength(1);
  await choose(input("district"), "miraflores");
  expect(calls().at(-1)).toEqual(["150122", "picked"]);
});

test("clearing the department clears the three levels and picking it again preselects province and district with the notice", async () => {
  await mount(optionsOf(places({ districtCodes: ["150122", "040126"] }), null));
  expect(values()).toEqual(["", "", ""]);
  await choose(input("department"), "arequipa");
  expect(values()).toEqual(["Arequipa", "Arequipa", "Yanahuara"]);
  expect(notice()).toBe(preselectedText);
  await clear(input("department"));
  expect(values()).toEqual(["", "", ""]);
  expect(notice()).toBe("");
  await choose(input("department"), "lima");
  expect(values()).toEqual(["Lima", "Lima", "Miraflores"]);
  expect(notice()).toBe(preselectedText);
});

test("choosing the same department again changes nothing and does not preselect", async () => {
  await mount(optionsOf(places({ departmentCodes: ["15"] }), null));
  await choose(input("province"), "canta");
  expect(notice()).toBe("");
  await choose(input("department"), "lima");
  expect(values()).toEqual(["Lima", "Canta", ""]);
  expect(notice()).toBe("");
});

test("an explicit district clear survives a store pickup round trip with department and province kept", async () => {
  await mount(optionsOf(lima, null));
  await choose(input("district"), "miraflores");
  await clear(input("district"));
  await pickMethod("store");
  await pickMethod("home");
  expect(values()).toEqual(["Lima", "Lima", ""]);
  expect(calls()).toEqual([["150122", "picked"]]);
});

test("in a single-district store a store pickup round trip after clearing preselects the district again with the notice", async () => {
  await mount(optionsOf(places({ districtCodes: ["150122"] }), null));
  await clear(input("district"));
  await pickMethod("store");
  expect(notice()).toBe("");
  await pickMethod("home");
  expect(values()).toEqual(["Lima", "Lima", "Miraflores"]);
  expect(notice()).toBe(preselectedText);
});

test("a catalog order without saved delivery shows the group hint and no text naming a chat or channel", async () => {
  await mount(optionsOf(lima, null));
  const hint = document.querySelector("legend + p")!;
  expect(hint.textContent).toBe("Escribe para buscar. Solo aparecen los lugares donde la tienda entrega; si el tuyo no está, consulta con la tienda.");
  expect(input("department").getAttribute("aria-describedby")).toBe(hint.id);
  expect(input("district").getAttribute("aria-describedby")).toBeNull();
  expect(document.body.textContent).not.toMatch(/chat|WhatsApp|canal/i);
});

test("the checkout empty search shows the per-level checkout text and the hint keeps saying to check with the store", async () => {
  await mount(optionsOf(lima, null));
  await typed(input("department"), "zzzz");
  expect(document.body.textContent).toContain("Ningún departamento de la lista coincide. Revisa cómo lo escribiste.");
  await typed(input("district"), "zzzz");
  expect(document.body.textContent).toContain("Ningún distrito de la lista coincide. Revisa cómo lo escribiste.");
  expect(document.body.textContent).toContain("consulta con la tienda");
});

test("the notice is one polite status before the quotation status, empty while silent and never moves focus", async () => {
  await mount(optionsOf(lima, null));
  const [first, second] = regions();
  expect(regions()).toHaveLength(2);
  expect(first!.compareDocumentPosition(second!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(first!.querySelector("[tabindex],a,button,input")).toBeNull();
  expect(first!.contains(document.activeElement)).toBe(false);
  expect(loading()).toBe("");
  await choose(input("district"), "miraflores");
  expect(notice()).toBe("");
});

test("picking a district shows the loading text only after the request starts, inside the region that already existed", async () => {
  let release: (value: Awaited<ReturnType<typeof requestDeliveryQuotation>>) => void = () => undefined;
  requests.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await mount(optionsOf(lima, null));
  const region = regions()[1]!;
  expect(region.textContent).toBe("");
  await choose(input("district"), "miraflores");
  expect(regions()[1]).toBe(region);
  expect(region.textContent).toBe("Consultando opciones de envío…");
  await act(async () => release(ok({ rates: [] } as never)));
  expect(region.textContent).toBe("");
});

test("tabbing from the delivery methods reaches Departamento first even when it is preselected, and the notice is not focusable", async () => {
  await mount(optionsOf(lima, null));
  const focusable = [...document.querySelectorAll<HTMLElement>("input, select, button, [tabindex]")].filter(item => !item.hasAttribute("disabled") && item.tabIndex >= 0);
  const radios = focusable.filter(item => item.getAttribute("type") === "radio");
  expect(focusable[focusable.indexOf(radios.at(-1)!) + 1]).toBe(input("department"));
  expect(regions().every(region => !region.hasAttribute("tabindex"))).toBe(true);
});

test("entering Entrega a domicilio from Recojo en tienda in a single-district store inserts the preselection notice once, before the loading text", async () => {
  await mount(optionsOf(places({ districtCodes: ["150122"] }), null), savedStore);
  await pickMethod("store");
  const order: string[] = [];
  const observer = new MutationObserver(() => {
    const [first, second] = regions();
    if (first?.textContent && !order.includes("notice")) order.push("notice");
    if (second?.textContent && !order.includes("loading")) order.push("loading");
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  await pickMethod("home");
  observer.disconnect();
  expect(order).toEqual(["notice", "loading"]);
  expect(notice()).toBe(preselectedText);
});

test("cleared messages use the padded muted block and the preselection message uses the hint look", async () => {
  await mount(optionsOf(lima, places({ departmentCodes: ["04"] })));
  expect(regions()[0]!.querySelector("p")!.className).not.toContain("bg-muted");
  await choose(input("district"), "miraflores");
  await pickMethod("agency");
  const cleared = regions()[0]!.querySelector("p")!;
  expect(cleared.className).toContain("bg-muted");
  expect(cleared.className).toContain("p-4");
});

test("hint, empty texts and notice messages render in Portuguese", async () => {
  await mount(optionsOf(lima, places({ departmentCodes: ["04"] })), checkout, "pt");
  expect(document.querySelector("legend + p")!.textContent).toBe("Digite para buscar. Só aparecem os lugares onde a loja entrega; se o seu não estiver, consulte a loja.");
  expect(notice()).toBe("Preenchemos automaticamente os campos que têm uma só opção.");
  await choose(input("district"), "miraflores");
  await pickMethod("agency");
  expect(notice()).toBe("Envio para agência não chega a Miraflores. Preenchemos os campos que têm uma só opção; escolha seu distrito.");
  await typed(input("province"), "zzzz");
  expect(document.body.textContent).toContain("Nenhuma província da lista corresponde. Confira como você escreveu.");
});

test("a store covering all departments shows the hint and preselects nothing", async () => {
  await mount(optionsOf(places({ departmentCodes: Array.from({ length: 25 }, (_, index) => String(index + 1).padStart(2, "0")) }), null));
  expect(values()).toEqual(["", "", ""]);
  expect(notice()).toBe("");
  expect(document.querySelector("legend + p")!.textContent).toContain("Solo aparecen los lugares donde la tienda entrega");
});

test("the server render already shows the preselected levels and computes the initial location once, on the server and on the client", async () => {
  const enter = vi.mocked(enterLocationMethod);
  const tree = optionsOf(places({ districtCodes: ["150122"] }), places({ departmentCodes: ["04"] }));
  enter.mockClear();
  const html = renderToString(element(tree));
  expect(html).toContain('value="Lima"');
  expect(html).toContain('value="Miraflores"');
  expect(html).not.toContain("Completamos automáticamente");
  expect(enter).toHaveBeenCalledTimes(1);
  enter.mockClear();
  await mount(tree);
  // Hydration of the form, the quotation and its response re-render the component, none of which recomputes the initial location.
  await act(async () => undefined);
  expect(enter).toHaveBeenCalledTimes(1);
});

test("in a single-district store the server render has both status regions present and empty, and after hydration the notice text is inserted in an earlier update than the loading text", async () => {
  requests.mockImplementation(() => new Promise(() => undefined));
  const tree = element(optionsOf(places({ districtCodes: ["150122"] }), null));
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(tree);
  expect(regions()).toHaveLength(2);
  expect(regions().map(region => region.textContent)).toEqual(["", ""]);
  // Each region is a stable element, so the insertion of its text is a childList record on it; the records keep the order of the updates.
  const [noticeRegion, loadingRegion] = regions();
  const inserted: string[] = [];
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (!record.addedNodes.length) continue;
      if (record.target === noticeRegion) inserted.push("notice");
      if (record.target === loadingRegion) inserted.push("loading");
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  // Outside act, so React commits the hydration, the notice and the effect's update as separate updates, like a browser.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const root = hydrateRoot(container, tree);
  await new Promise(resolve => setTimeout(resolve, 100));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  observer.disconnect();
  mounted.push(() => root.unmount());
  expect(inserted).toEqual(["notice", "loading"]);
  expect(calls()).toEqual([["150122", "automatic"]]);
});

test("a picked district is quoted with trigger picked, while preselected, kept-on-switch and saved districts are quoted with trigger automatic, and Reintentar tarifas repeats the trigger of the failed request", async () => {
  requests.mockResolvedValueOnce(err({ code: "REQUEST_FAILED", message: "x" }));
  await mount(optionsOf(lima, lima));
  await choose(input("district"), "miraflores");
  const retry = [...document.querySelectorAll("button")].find(button => button.textContent === "Reintentar tarifas")!;
  await act(async () => retry.click());
  await pickMethod("agency");
  expect(calls()).toEqual([["150122", "picked"], ["150122", "picked"], ["150122", "automatic"]]);
});

test("a re-quotation caused by a confirmation recovery is quoted with trigger automatic even when the district was picked", async () => {
  const options = optionsOf(lima, null);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(() => root.unmount());
  const render = (recoveryVersion: number | object) => act(async () => root.render(<I18nextProvider i18n={instances.es}>
    <CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001" checkout={checkout} options={options}
      recipient={{ name: "Ana", phone: "+51977909427" }} onChange={() => undefined} recoveryVersion={recoveryVersion} /></I18nextProvider>));
  await render(0);
  await choose(input("district"), "miraflores");
  await render({});
  expect(calls()).toEqual([["150122", "picked"], ["150122", "automatic"]]);
});

test("Pasar a Entrega a domicilio is absent from the no-agencies message when home is not offered", async () => {
  await mount(optionsOf(null, places({ districtCodes: ["150122"] })));
  expect(document.body.textContent).toContain("No hay agencias disponibles para envío a MIRAFLORES.");
  expect(document.body.textContent).not.toContain("Pasar a Entrega a domicilio");
});

test("Pasar a Entrega a domicilio keeps a district covered by home and quotes it, as switching the method does", async () => {
  await mount(optionsOf(places({ districtCodes: ["150122"] }), places({ districtCodes: ["150122"] })));
  await pickMethod("agency");
  const switchToHome = [...document.querySelectorAll("button")].find(button => button.textContent === "Pasar a Entrega a domicilio")!;
  await act(async () => switchToHome.click());
  expect(document.querySelector<HTMLInputElement>("input[type=radio][value=home]")!.checked).toBe(true);
  expect(values()).toEqual(["Lima", "Lima", "Miraflores"]);
  expect(calls().at(-1)).toEqual(["150122", "automatic"]);
});

const arequipaAndCusco = places({ districtCodes: ["040126", "080101"] });
const motorizado = { id: "00000000-0000-4000-8000-0000000000a1", optionId: "00000000-0000-4000-8000-0000000000a2", name: "Motorizado", zoneName: "Canta",
  price: { amount: 10, currency: "PEN" as const }, method: "home" as const };

test("a store covering the whole department Lima lists its 10 provinces with none preselected and quotes Motorizado S/ 10.00 for Canta → Huamantanga", async () => {
  requests.mockResolvedValue(ok({ rates: [motorizado] } as never));
  await mount(optionsOf(places({ departmentCodes: ["15"] }), null));
  expect(values()).toEqual(["Lima", "", ""]);
  await open(input("province"));
  expect(optionTexts()).toHaveLength(10);
  await choose(input("province"), "canta");
  expect(notice()).toBe("");
  await choose(input("district"), "huamantanga");
  expect(calls()).toEqual([["150403", "picked"]]);
  const rates = document.querySelector<HTMLSelectElement>("#delivery-rate")!;
  expect(rates.textContent).toContain("Motorizado");
  expect(rates.textContent).toMatch(/10[.,]00/);
});

test("a catalog order whose buyer is outside the covered place has no saved delivery, no contact control and no confirmable delivery until a covered place is picked", async () => {
  const onChange = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(() => root.unmount());
  await act(async () => root.render(<I18nextProvider i18n={instances.es}><CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001"
    checkout={checkout} options={optionsOf(lima, null)} recipient={{ name: "Ana", phone: "+51977909427" }} onChange={onChange} /></I18nextProvider>));
  expect(values()).toEqual(["Lima", "Lima", ""]);
  expect(container.querySelectorAll("a")).toHaveLength(0);
  expect([...container.querySelectorAll("button")].map(button => button.textContent).join(" ")).not.toMatch(/contact|chat|whatsapp/i);
  expect(onChange.mock.calls.at(-1)).toEqual([null]);
  await choose(input("district"), "miraflores");
  expect(onChange.mock.calls.at(-1)).toEqual([null]);
});

test("the Portuguese checkout shows every cleared message that asks to pick another district and the department empty text", async () => {
  await mount(optionsOf(lima, arequipaAndCusco), checkout, "pt");
  await choose(input("district"), "miraflores");
  await pickMethod("agency");
  expect(notice()).toBe("Envio para agência não chega a Miraflores. Escolha outro distrito.");
  await typed(input("department"), "zzzz");
  expect(document.body.textContent).toContain("Nenhum departamento da lista corresponde. Confira como você escreveu.");
});

test("the Portuguese checkout shows the district empty text", async () => {
  await mount(optionsOf(lima, null), checkout, "pt");
  await typed(input("district"), "zzzz");
  expect(document.body.textContent).toContain("Nenhum distrito da lista corresponde. Confira como você escreveu.");
});

test("the Portuguese checkout shows the complete cleared message when every level has a single choice", async () => {
  await mount(optionsOf(lima, places({ districtCodes: ["040126"] })), checkout, "pt");
  await choose(input("district"), "miraflores");
  await pickMethod("agency");
  expect(notice()).toBe("Envio para agência não chega a Miraflores. Preenchemos os campos que têm uma só opção.");
});

test("the Spanish checkout shows the cleared message that asks to pick another district when nothing could be preselected", async () => {
  await mount(optionsOf(lima, arequipaAndCusco));
  await choose(input("district"), "miraflores");
  await pickMethod("agency");
  expect(notice()).toBe("Envío a agencia no llega a Miraflores. Elige otro distrito.");
});

test("typing Cuzco in Provincia under the whole department Lima shows the Spanish no-province text", async () => {
  await mount(optionsOf(places({ departmentCodes: ["15"] }), null));
  await typed(input("province"), "Cuzco");
  expect(document.body.textContent).toContain("Ninguna provincia de la lista coincide. Revisa cómo lo escribiste.");
});

test("the preselection-only message has the same look as the group hint and the empty notice region adds no blank gap", async () => {
  await mount(optionsOf(lima, null));
  const hint = document.querySelector("legend + p")!;
  const message = regions()[0]!.querySelector("p")!;
  const looks = (item: Element) => item.className.split(" ").filter(name => /^(text-|mb-)/.test(name) && name !== "mb-4").sort();
  expect(looks(message)).toEqual(looks(hint));
  await choose(input("district"), "miraflores");
  const empty = regions()[0]!;
  expect(empty.children).toHaveLength(0);
  expect(empty.textContent).toBe("");
  // The empty region pulls up by the fieldset gap it would otherwise add, so no blank row separates methods and fields.
  expect(empty.className).toContain("-mb-4");
});
