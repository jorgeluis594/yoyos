import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { expect, test } from "vitest";
import { CheckoutAgencyDestination } from "@core/app/components/checkout-agency-destination";
import type { AgencyChoice, AgencyChoices } from "@core/app/checkout-agency-choices";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

const choice = (id: string, name: string, price: number, districtCode: string, district: string): AgencyChoice => ({
  rateId: `rate-${id}`, optionName: "Agencia", price: { amount: price, currency: "PEN" },
  agency: { id, name, address: "Av. Test 1", courier: { id: "courier", name: "Shalom" }, location: { country: "PE" as const, districtCode, district, province: "AREQUIPA", department: "AREQUIPA" } },
});
const olva = choice("a1", "Olva Cayma", 10, "040103", "CAYMA");
const cayma = choice("a2", "Agencia Cayma", 12, "040103", "CAYMA");
const buyerDistrict = { district: "CHARACATO", province: "AREQUIPA", department: "AREQUIPA" };
const amount = (price: { amount: number }) => `S/ ${price.amount.toFixed(2)}`;
const render = (choices: AgencyChoices, props: { value?: string; homeOffered?: boolean } = {}) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>
  <CheckoutAgencyDestination choices={choices} buyerDistrict={buyerDistrict} value={props.value ?? ""} homeOffered={props.homeOffered ?? true}
    onChange={() => undefined} onChangeDistrict={() => undefined} onSwitchToHome={() => undefined} amount={amount} /></I18nextProvider>);

test("district level shows the destination agency list without a notice", () => {
  const html = render({ level: "district", choices: [olva, cayma] });
  expect(html).toContain("Agencia de destino");
  expect(html).toContain("Selecciona una agencia");
  expect(html).toContain("Olva Cayma · Shalom · Av. Test 1 · CAYMA, AREQUIPA · S/ 10.00");
  expect(html).not.toContain('role="status"');
});

test("province level shows the province notice above the list with catalog names", () => {
  const html = render({ level: "province", choices: [olva, cayma] });
  expect(html).toContain("No hay agencias en CHARACATO; te mostramos las de la provincia de AREQUIPA");
  expect(html.indexOf("No hay agencias en")).toBeLessThan(html.indexOf("Agencia de destino"));
});

test("department level shows the department notice naming district, province and department", () => {
  const html = render({ level: "department", choices: [olva] });
  expect(html).toContain("No hay agencias en CHARACATO ni en la provincia de AREQUIPA; te mostramos las del departamento de AREQUIPA");
});

test("no agencies offers Cambiar distrito and Pasar a Entrega a domicilio only when home is offered", () => {
  const withHome = render({ level: "none" });
  expect(withHome).toContain("No hay agencias disponibles para envío a CHARACATO.");
  expect(withHome).toContain("Cambiar distrito");
  expect(withHome).toContain("Pasar a Entrega a domicilio");
  expect(withHome).not.toContain("Agencia de destino");
  const withoutHome = render({ level: "none" }, { homeOffered: false });
  expect(withoutHome).toContain("Cambiar distrito");
  expect(withoutHome).not.toContain("Pasar a Entrega a domicilio");
});

test("a single agency renders selected", () => {
  const html = render({ level: "district", choices: [olva] }, { value: "a1" });
  expect(html).toMatch(/<option value="a1" selected=""/);
});
