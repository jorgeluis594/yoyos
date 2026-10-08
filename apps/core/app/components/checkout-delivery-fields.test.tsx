import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { CheckoutDeliveryFields } from "@core/app/components/checkout-delivery-fields";
import type { PublicCheckoutResponse } from "@shared/contracts/order-checkout";

const total = { amount: 10, currency: "PEN" as const };
const checkout: PublicCheckoutResponse = { companyName: "Shop", number: 1001, buyer: null, delivery: null,
  deliveryCharge: { amount: 0, currency: "PEN" }, itemsTotal: total, total,
  items: [{ productName: "Product", variantAttributes: {}, sku: null, quantity: 1, unitPrice: total, subtotal: total }], state: { kind: "pending" } };
const options = { home: { enabled: true }, agency: { enabled: false }, store: { enabled: false as const, pickupPoint: null } };
const render = (value = checkout, settings = options) => renderToStaticMarkup(<CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001" checkout={value} options={settings} onChange={() => undefined} />);

test("delivery controls wait for client hydration before accepting selections", () => {
  expect(render()).toMatch(/<fieldset disabled=""/);
});

test("unassigned delivery asks for a district and recipient and never offers implicit free pickup", () => {
  const html = render();
  expect(html).toContain("Distrito de entrega");
  expect(html).toContain("Nombre del destinatario");
  expect(html).toContain("Teléfono del destinatario");
  expect(html).not.toContain("Conservar entrega actual");
  expect(html).not.toContain("Recojo en tienda");
  expect(html).not.toContain("Tarifa de envío");
  expect(html).not.toContain("Dirección de entrega");
});

test("historical delivery shows saved address and charge without consulting a current district or rate", () => {
  const html = render({ ...checkout, deliveryCharge: { amount: 8, currency: "PEN" }, total: { amount: 18, currency: "PEN" }, delivery: {
    method: "home", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, destination: { address: "Old street", district: "Old district", instructions: null },
  } });
  expect(html).toContain("Conservar entrega actual");
  expect(html).toContain("Old street, Old district");
  expect(html.replace(/\s/g, " ")).toContain("S/ 8.00");
  expect(html).not.toContain("Distrito de entrega");
  expect(html).not.toContain("Nombre del destinatario");
});

test("pickup is offered explicitly only with an enabled configured point", () => {
  const html = renderToStaticMarkup(<CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001" checkout={checkout}
    options={{ ...options, store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } }} onChange={() => undefined} />);
  expect(html).toContain("Recojo en tienda · Gratis");
});

test("pickup-only businesses show the configured point without offering shipping or a district", () => {
  const html = renderToStaticMarkup(<CheckoutDeliveryFields orderId="00000000-0000-4000-8000-000000000001" checkout={checkout}
    options={{ home: { enabled: false }, agency: { enabled: false }, store: { enabled: true,
      pickupPoint: { name: "Shop", address: "Pickup street", instructions: "Door 2" } } }} onChange={() => undefined} />);
  expect(html).toContain("Pickup street");
  expect(html).toContain("Door 2");
  expect(html).not.toContain('value="ship"');
  expect(html).not.toContain("Distrito de entrega");
});

test("businesses without available delivery methods cannot offer an implicit delivery", () => {
  const html = render(checkout, { ...options, home: { enabled: false } });
  expect(html).toContain("No hay modalidades de entrega disponibles");
  expect(html).not.toContain('value="ship"');
  expect(html).not.toContain("Distrito de entrega");
  expect(html).not.toContain("Nombre del destinatario");
});
