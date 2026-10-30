// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { expect, test } from "vitest";
import { CheckoutDeliveryFields } from "@core/app/components/checkout-delivery-fields";
import type { PeruAreaSelection } from "@shared/peru-geography";
import type { CheckoutDeliveryOptions, PublicCheckoutResponse } from "@shared/contracts/order-checkout";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const withI18n = (element: React.ReactElement) => <I18nextProvider i18n={i18n}>{element}</I18nextProvider>;

const total = { amount: 10, currency: "PEN" as const };
const checkout: PublicCheckoutResponse = { companyName: "Shop", number: 1001, buyer: null, delivery: null,
  deliveryCharge: { amount: 0, currency: "PEN" }, itemsTotal: total, total,
  items: [{ productName: "Product", variantAttributes: {}, sku: null, imageUrl: null, quantity: 1, unitPrice: total, subtotal: total }], state: { kind: "pending" } };
const places = { departmentCodes: ["15"], provinceCodes: [], districtCodes: [] } as unknown as PeruAreaSelection;
const offered = { offered: true as const, places };
const notOffered = { offered: false as const };
const options = { home: offered, agency: notOffered, store: { enabled: false as const, pickupPoint: null } };
const pickup = { enabled: true as const, pickupPoint: { name: "Shop", address: "Street", instructions: null } };
const render = (value = checkout, settings: CheckoutDeliveryOptions = options) => renderToStaticMarkup(withI18n(<CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001" checkout={value} options={settings} recipient={{ name: "Ana", phone: "+51977909427" }} onChange={() => undefined} />));

test("delivery controls wait for client hydration before accepting selections", () => {
  expect(render()).toMatch(/<fieldset disabled=""/);
});

test("unassigned delivery asks for a district, leaves the recipient to «Tus datos» and never offers implicit free pickup", () => {
  const html = render();
  expect(html).toContain("Distrito de entrega");
  expect(html).not.toContain("Nombre del destinatario");
  expect(html).not.toContain("Teléfono del destinatario");
  expect(html).not.toContain("Conservar entrega actual");
  expect(html).not.toContain("Recojo en tienda");
  expect(html).not.toContain("Tarifa de envío");
  expect(html).not.toContain("Dirección de entrega");
});

const savedHome: PublicCheckoutResponse = { ...checkout, deliveryCharge: { amount: 8, currency: "PEN" }, total: { amount: 18, currency: "PEN" }, delivery: {
  method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { address: "Old street", country: "PE", districtCode: "150101", district: "Old district", province: "Lima", department: "Lima", instructions: null },
  pricing: { quotationId: "00000000-0000-4000-8000-000000000020", rateId: "00000000-0000-4000-8000-000000000021", optionId: "00000000-0000-4000-8000-000000000022", settingsVersion: 1 },
} };

test("historical delivery shows saved address and charge without consulting a current district or rate", () => {
  const html = render(savedHome);
  expect(html).toContain("Conservar entrega actual");
  expect(html).toContain("Old street, Old district");
  expect(html).toContain("Recibe: Ana · +51977909427");
  expect(html.replace(/\s/g, " ")).toContain("S/ 8.00");
  expect(html).not.toContain("Distrito de entrega");
  expect(html).not.toContain("Nombre del destinatario");
});

test("a buyer without saved delivery sees Entrega a domicilio, Envío a agencia and Recojo en tienda with home delivery selected", () => {
  const html = render(checkout, { home: offered, agency: offered, store: pickup });
  expect(html).toContain("Entrega a domicilio");
  expect(html).toContain("Envío a agencia");
  expect(html).toContain("Recojo en tienda · Gratis");
  expect(html).toMatch(/checked="" value="home"/);
  expect(html).not.toMatch(/checked="" value="agency"/);
});

test("without home delivery the agency method is preselected when the business has agency coverage", () => {
  const html = render(checkout, { home: notOffered, agency: offered, store: pickup });
  expect(html).toMatch(/checked="" value="agency"/);
  expect(html).not.toContain("Entrega a domicilio");
  expect(html).toContain("Distrito de entrega");
});

test("hides Envío a agencia when the agency switch is off or the business has no agency coverage", () => {
  const html = render(checkout, { ...options, agency: notOffered });
  expect(html).not.toContain("Envío a agencia");
  expect(html).not.toContain('value="agency"');
});

test("checkout offers home only when covered and opens on agency or store pickup when home is uncovered", () => {
  const agencyFirst = render(checkout, { home: notOffered, agency: offered, store: pickup });
  expect(agencyFirst).not.toContain("Entrega a domicilio");
  expect(agencyFirst).toMatch(/checked="" value="agency"/);
  const storeFirst = render(checkout, { home: notOffered, agency: notOffered, store: pickup });
  expect(storeFirst).toMatch(/checked="" value="store"/);
  expect(storeFirst).not.toContain('value="home"');
});

test("checkout shows the kept delivery preselected when its district is no longer covered or its method is no longer offered", () => {
  const html = render(savedHome, { home: notOffered, agency: notOffered, store: pickup });
  expect(html).toMatch(/checked="" value="keep"/);
  expect(html).toContain("Conservar entrega actual");
  expect(html).not.toContain('value="home"');
  expect(html).not.toContain('value="agency"');
  expect(html).toContain("Old street, Old district");
});

test("checkout shows the no-method text that tells the buyer to check with the store in Spanish and Portuguese", async () => {
  const none = { home: notOffered, agency: notOffered, store: { enabled: false as const, pickupPoint: null } };
  expect(render(checkout, none)).toContain("No hay modalidades de entrega disponibles. Consulta con la tienda cómo recibir tu pedido.");
  const pt = createInstance();
  await pt.use(initReactI18next).init({ lng: "pt", resources });
  const html = renderToStaticMarkup(<I18nextProvider i18n={pt}><CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001" checkout={checkout} options={none}
    recipient={{ name: "Ana", phone: "+51977909427" }} onChange={() => undefined} /></I18nextProvider>);
  expect(html).toContain("Consulte a loja sobre como receber seu pedido.");
});

test("pickup is offered explicitly only with an enabled configured point", () => {
  const html = renderToStaticMarkup(withI18n(<CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001" checkout={checkout}
    options={{ ...options, store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }} recipient={{ name: "Ana", phone: "+51977909427" }} onChange={() => undefined} />));
  expect(html).toContain("Recojo en tienda · Gratis");
});

test("pickup-only businesses show the configured point without offering shipping or a district", () => {
  const html = renderToStaticMarkup(withI18n(<CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001" checkout={checkout}
    options={{ home: notOffered, agency: notOffered, store: { enabled: true,
      pickupPoint: { name: "Shop", address: "Pickup street", instructions: "Door 2" } } }} recipient={{ name: "Ana", phone: "+51977909427" }} onChange={() => undefined} />));
  expect(html).toContain("Pickup street");
  expect(html).toContain("Door 2");
  expect(html).not.toContain('value="home"');
  expect(html).not.toContain('value="agency"');
  expect(html).not.toContain("Distrito de entrega");
});

test("businesses without available delivery methods cannot offer an implicit delivery", () => {
  const html = render(checkout, { ...options, home: notOffered });
  expect(html).toContain("No hay modalidades de entrega disponibles");
  expect(html).not.toContain('value="home"');
  expect(html).not.toContain('value="agency"');
  expect(html).not.toContain("Distrito de entrega");
  expect(html).not.toContain("Nombre del destinatario");
});

test("a saved agency delivery is summarized as Envío a agencia with courier, agency and address", () => {
  const district = { country: "PE" as const, districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
  const html = render({ ...checkout, deliveryCharge: { amount: 5, currency: "PEN" }, total: { amount: 15, currency: "PEN" }, delivery: {
    method: "agency", recipient: { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } }, destination: district,
    pricing: { quotationId: "00000000-0000-4000-8000-000000000020", rateId: "00000000-0000-4000-8000-000000000021", optionId: "00000000-0000-4000-8000-000000000022", settingsVersion: 1 },
    courier: { id: "00000000-0000-4000-8000-000000000023", name: "Shalom" },
    agency: { id: "00000000-0000-4000-8000-000000000024", name: "Branch", address: "Av. Test 123", location: district },
  } });
  expect(html).toContain("Envío a agencia");
  expect(html).toContain("Shalom · Branch · Av. Test 123");
});

test("every text field and select of the delivery step sits in a field group, so each theme gives it the boundary of its buyer fields", () => {
  const container = document.createElement("div");
  container.innerHTML = render();
  const controls = [...container.querySelectorAll("input:not([type=radio]):not([type=hidden]), select")];
  expect(controls.map((control) => control.id)).not.toEqual(expect.arrayContaining(["delivery-name"]));
  expect(controls.length).toBeGreaterThanOrEqual(3);
  for (const control of controls) {
    expect(control.closest("[data-store-part=field-group]"), control.id).not.toBeNull();
    expect(control.closest("[data-store-part=field]"), control.id).not.toBeNull();
  }
});
