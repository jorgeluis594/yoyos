// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { ok } from "@shared/functional";
import { OrderDeliveryCard } from "@core/src/features/orders/presentation/order-delivery-card";
import {
  buildCreateRequest, clearCustomer, initialDraft, invalidFields, setCustomer, type DeliveryDraft, type OrderViewState,
} from "@core/src/features/orders/presentation/order-view-state";

vi.mock("@core/src/features/delivery-settings/infrastructure/quotation-api", () => ({ requestDeliveryQuotation: vi.fn() }));
vi.mock("@core/app/components/peru-district-select", () => ({
  PeruDistrictSelect: ({ value, onChange, disabled }: { value: string | null; onChange: (code: string) => void; disabled?: boolean }) =>
    <button type="button" data-testid="district" data-value={value ?? ""} disabled={disabled} onClick={() => onChange("150122")}>Distrito</button>,
}));
import { requestDeliveryQuotation } from "@core/src/features/delivery-settings/infrastructure/quotation-api";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const orderId = "00000000-0000-4000-8000-000000001042";
const rateId = "00000000-0000-4000-8000-0000000000e1";
const newRateId = "00000000-0000-4000-8000-0000000000e2";
const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const recipient = { name: "Jorge Gonzalez", phone: "+51977909427", identity: { kind: "absent" as const } };
const homeDelivery = {
  method: "home" as const, recipient,
  destination: { address: "Av. Lima 123", district: "Miraflores", instructions: null, country: "PE" as const, districtCode: "150122", province: "Lima", department: "Lima" },
  pricing: { quotationId: "00000000-0000-4000-8000-0000000000f1", rateId, optionId: "00000000-0000-4000-8000-0000000000f2", settingsVersion: 1 },
  recordedBy: { kind: "seller" as const, userId: "user-1" },
};
const agencyDelivery = {
  method: "agency" as const, recipient: { ...recipient, identity: { kind: "document" as const, documentType: "national_id" as const, document: "12345678" } },
  destination: { country: "PE" as const, districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" },
  pricing: homeDelivery.pricing, courier: { id: "00000000-0000-4000-8000-0000000000c1", name: "Olva Courier" },
  agency: { id: "00000000-0000-4000-8000-0000000000c2", name: "Agencia Centro", address: "Jr. Callao 456", location: { country: "PE" as const, districtCode: "150101", district: "Lima", province: "Lima", department: "Lima" } },
  recordedBy: { kind: "seller" as const, userId: "user-1" },
};
const order = (patch: Partial<OrderAggregateResponse> = {}) => ({
  id: orderId, buyer: { contactId: null, name: "Jorge Gonzalez", phone: "+51977909427" }, cancelled: false, deliveryStatus: "pending", stockDeducted: false, stockDue: null,
  items: [], payments: [], paidAmount: pen(0), delivery: homeDelivery, itemsTotal: pen(298), deliveryCost: pen(5), deliveryCharge: pen(0), total: pen(298), ...patch,
}) as unknown as OrderAggregateResponse;
const revisions = { items: "A".repeat(43), customer: "B".repeat(43), delivery: "C".repeat(43) };
const savedState = (patch: Partial<OrderAggregateResponse> = {}) => initialDraft({ kind: "saved", order: order(patch), revisions, lineCatalog: null });
const newState = () => initialDraft({ kind: "new", orderId, currency: "PEN" });

const settings = { version: 1, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: true, pickupPoint: { name: "Tienda", address: "Jr. Unión 1", instructions: null } } } as unknown as DeliverySettingsResponse;
const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });

describe("OrderDeliveryCard", () => {
  let root: Root | undefined;
  let latest: OrderViewState;
  let setState: (update: (state: OrderViewState) => OrderViewState) => void;
  beforeEach(() => {
    vi.mocked(requestDeliveryQuotation).mockResolvedValue(ok({ rates: [{ id: newRateId, method: "home", price: pen(12), optionId: "o", zoneId: "z", zoneName: "Lima" }] } as never));
  });
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); });

  function Harness({ initial, settings: provided }: { initial: OrderViewState; settings: DeliverySettingsResponse | null }) {
    const [state, set] = useState(initial);
    latest = state; setState = (update) => set(update);
    return <I18nextProvider i18n={i18n}><MemoryRouter>
      <OrderDeliveryCard state={state} settings={provided} invalid={invalidFields(state)} settingsHref="/pe/settings/delivery"
        onChange={(delivery: DeliveryDraft) => set(current => ({ ...current, draft: { ...current.draft, delivery } }))}
        onDeliverImmediatelyChange={(deliverImmediately) => set(current => ({ ...current, draft: { ...current.draft, deliverImmediately } }))} />
    </MemoryRouter></I18nextProvider>;
  }
  async function mount(initial: OrderViewState, provided: DeliverySettingsResponse | null = settings) {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root!.render(<Harness initial={initial} settings={provided} />));
  }
  const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")].find(node => node.textContent === name)!;
  const choose = (name: string) => act(async () => { tab(name).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
  const field = (id: string) => document.getElementById(`order-delivery-${id}`) as HTMLInputElement;
  const type = (id: string, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(id), value);
    field(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
  const same = () => document.getElementById("order-delivery-same") as HTMLElement;

  test("starts a new sale at Por definir and discards a half-filled method when chosen again", async () => {
    await mount(newState());
    expect(tab("Por definir").getAttribute("aria-selected")).toBe("true");
    expect(document.body.textContent).toContain("Entrega por definir. Puedes guardar sin entrega y elegirla después.");
    await choose("Domicilio");
    await type("address", "Av. Lima 123");
    await choose("Por definir");
    expect(latest.draft.delivery.tab).toBe("none");
    expect(latest.draft.delivery.fields.address).toBe("");
    const line = { variantId: "00000000-0000-4000-8000-0000000000a1", productName: "Corona", attributes: {}, sku: null, unitPrice: pen(35), quantityText: "1", stock: 5, sellable: true };
    await act(async () => setState(state => ({ ...state, draft: { ...state.draft, items: [line] } })));
    const request = buildCreateRequest(latest);
    expect(request.success && request.data.delivery).toBeFalsy();
    expect(invalidFields(latest)).toEqual([]);
  });

  test("shows only the enabled methods after Por definir", async () => {
    await mount(newState(), { ...settings, home: { enabled: false } } as DeliverySettingsResponse);
    expect([...document.querySelectorAll("[role=tab]")].map(node => node.textContent)).toEqual(["Por definir", "Recojo en tienda"]);
  });

  test("disables Por definir on a saved order with a delivery", async () => {
    await mount(savedState());
    expect(tab("Por definir").disabled).toBe(true);
    expect(document.body.textContent).toContain("Una entrega guardada se puede cambiar, pero no quitar.");
  });

  test("starts Igual que el cliente unchecked when the saved recipient differs", async () => {
    await mount(savedState({ delivery: { ...homeDelivery, recipient: { ...recipient, name: "María Pérez", phone: "+51911111111" } } as never }));
    expect(same().getAttribute("aria-checked")).toBe("false");
    expect(field("name").value).toBe("María Pérez");
  });

  test("unchecks Igual que el cliente and keeps the mirrored values on Quitar cliente", async () => {
    await mount(savedState());
    expect(same().getAttribute("aria-checked")).toBe("true");
    await act(async () => setState(clearCustomer));
    expect(same().getAttribute("aria-checked")).toBe("false");
    expect(field("name").value).toBe("Jorge Gonzalez");
  });

  test("mirrors the customer while checked and unchecks when the recipient is edited", async () => {
    await mount(savedState());
    await act(async () => setState(state => setCustomer(state, { name: "Ana", phone: "+51922222222" })));
    expect(field("name").value).toBe("Ana");
    await type("name", "Otra persona");
    expect(same().getAttribute("aria-checked")).toBe("false");
    await act(async () => setState(state => setCustomer(state, { name: "Beto", phone: "+51933333333" })));
    expect(field("name").value).toBe("Otra persona");
  });

  test("sets the quoted price of the chosen rate so a replaced delivery can be saved", async () => {
    await mount(savedState());
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-testid=district]")!.click(); });
    expect(latest.draft.delivery.fields.rateId).toBe("");
    await act(async () => { await Promise.resolve(); });
    const trigger = document.getElementById("order-delivery-rateId")!;
    expect(trigger).not.toBeNull();
    await act(async () => { trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false })); trigger.click(); });
    const option = [...document.querySelectorAll<HTMLElement>("[role=option]")][0];
    await act(async () => { option.click(); });
    expect(latest.draft.delivery.fields.ratePrice).toEqual(pen(12));
    expect(document.body.textContent).toContain("Costo de entrega (interno)");
  });

  test("names the incomplete delivery differently on a new sale and on a saved delivery", async () => {
    await mount(newState());
    await choose("Domicilio");
    expect(document.body.textContent).toContain("Completa la entrega o elige Por definir.");
    act(() => root!.unmount());
    document.body.innerHTML = "";
    await mount(savedState());
    await type("address", "");
    expect(document.body.textContent).toContain("Completa la entrega o descarta sus cambios.");
    expect(field("address").getAttribute("aria-invalid")).toBe("true");
  });

  test("shows Elegida por el comprador while the buyer's choice stands and the internal cost of the stored delivery", async () => {
    await mount(savedState({ delivery: { ...homeDelivery, recordedBy: { kind: "buyer" } } as never }));
    expect(document.body.textContent).toContain("Elegida por el comprador");
    expect(document.body.textContent).toContain("Costo de entrega (interno)");
  });

  test("offers Marcar como entregado al guardar only on a new sale and marks it when payments do not cover", async () => {
    const start = newState();
    const line = { variantId: "00000000-0000-4000-8000-0000000000a1", productName: "Corona", attributes: {}, sku: null, unitPrice: pen(35), quantityText: "1", stock: 5, sellable: true };
    await mount({ ...start, draft: { ...start.draft, items: [line] } });
    const box = document.getElementById("order-delivery-deliverImmediately")!;
    expect(box).not.toBeNull();
    await act(async () => { box.click(); });
    expect(latest.draft.deliverImmediately).toBe(true);
    expect(document.body.textContent).toContain("Para marcarlo entregado, los pagos deben cubrir el total.");
    act(() => root!.unmount());
    document.body.innerHTML = "";
    await mount(savedState());
    expect(document.getElementById("order-delivery-deliverImmediately")).toBeNull();
  });

  test("locks the fields of a shipped order with its note and has no fulfillment buttons any more", async () => {
    await mount(savedState({ deliveryStatus: "shipped" }));
    expect(document.body.textContent).toContain("La entrega ya salió; no se puede cambiar.");
    expect(document.body.textContent).not.toContain("Marcar enviado");
    expect(document.body.textContent).not.toContain("Marcar entregado");
    expect(field("name").matches(":disabled")).toBe(true);
    expect(tab("Domicilio").disabled).toBe(true);
  });

  test("offers the configuration link when no method is enabled", async () => {
    await mount(newState(), { ...settings, home: { enabled: false }, store: { enabled: false, pickupPoint: null } } as DeliverySettingsResponse);
    expect(document.body.textContent).toContain("Configurar modalidades de entrega");
    expect(document.querySelector("a")?.getAttribute("href")).toBe("/pe/settings/delivery");
  });

  test("shows the saved agency and courier of a saved order without asking for a quotation and without repeating the district or the rate", async () => {
    await mount(savedState({ delivery: agencyDelivery as never }), { ...settings, agency: { enabled: true } } as DeliverySettingsResponse);
    const saved = document.querySelector("[data-testid=saved-delivery]")!;
    expect(saved.textContent).toContain("Olva Courier · Agencia Centro · Jr. Callao 456 · Lima, Lima");
    expect(saved.textContent).not.toContain("Miraflores");
    expect(saved.textContent).not.toContain("Tarifa de entrega");
    expect(document.getElementById("order-delivery-rateId")).toBeNull();
    expect(requestDeliveryQuotation).not.toHaveBeenCalled();
  });

  test("opening a saved home order does not quote; changing the district does", async () => {
    await mount(savedState());
    expect(requestDeliveryQuotation).not.toHaveBeenCalled();
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-testid=district]")!.click(); });
    expect(requestDeliveryQuotation).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid=saved-delivery]")).toBeNull();
  });

  test("shows the saved rate of a locked home order as the internal cost", async () => {
    await mount(savedState({ deliveryStatus: "delivered" }));
    expect(document.body.textContent).toContain("Costo de entrega (interno): S/");
    expect(requestDeliveryQuotation).not.toHaveBeenCalled();
  });

  test("disables everything on a cancelled order and keeps showing its delivery", async () => {
    await mount(savedState({ cancelled: true }));
    expect(field("name").matches(":disabled")).toBe(true);
    expect(tab("Domicilio").disabled).toBe(true);
    expect(document.body.textContent).toContain("Costo de entrega (interno)");
  });

  test("explains a locked delivery once, without the note about clearing a saved delivery", async () => {
    await mount(savedState({ deliveryStatus: "shipped" }));
    expect(document.body.textContent).toContain("La entrega ya salió; no se puede cambiar.");
    expect(document.body.textContent).not.toContain("Una entrega guardada se puede cambiar, pero no quitar.");
    act(() => root!.unmount());
    await mount(savedState({ deliveryStatus: "delivered" }));
    expect(document.body.textContent).toContain("El pedido ya se entregó; la entrega no se puede cambiar.");
    expect(document.body.textContent).not.toContain("Una entrega guardada se puede cambiar, pero no quitar.");
  });

  test("a cancelled order shows its delivery read-only without notes about changing it", async () => {
    await mount(savedState({ cancelled: true }));
    expect(document.body.textContent).not.toContain("Una entrega guardada se puede cambiar, pero no quitar.");
  });

  test("lists the methods as full-width tabs with Domicilio before Recojo en tienda", async () => {
    await mount(newState(), { ...settings, agency: { enabled: true } } as DeliverySettingsResponse);
    expect([...document.querySelectorAll("[role=tab]")].map(node => node.textContent)).toEqual(["Por definir", "Domicilio", "Agencia", "Recojo en tienda"]);
    expect(document.querySelector("[role=tablist]")!.className).toContain("w-full");
    expect(document.querySelector("[role=tab]")!.className).toContain("min-h-touch");
  });

  test("does not repeat the district and the rate of a home delivery the fields and the internal cost already show", async () => {
    await mount(savedState());
    expect(document.querySelector("[data-testid=saved-delivery]")).toBeNull();
    expect(document.body.textContent).toContain("Costo de entrega (interno)");
  });

  test("keeps the locked recipient when the customer changes", async () => {
    await mount(savedState({ deliveryStatus: "shipped" }));
    await act(async () => setState(state => setCustomer(state, { name: "Ana", phone: "+51922222222" })));
    expect(field("name").value).toBe("Jorge Gonzalez");
  });

  test("keeps the internal cost while only the reference of a saved delivery is amended", async () => {
    await mount(savedState());
    await type("instructions", "Portón verde");
    expect(latest.draft.delivery.fields.rateId).toBe(rateId);
    expect(document.body.textContent).toContain("Costo de entrega (interno): S/");
  });

  test("marks the district and gives it a focus target when Domicilio has nothing filled", async () => {
    await mount(newState());
    await choose("Domicilio");
    const target = document.getElementById("order-delivery-districtCode")!;
    expect(target).not.toBeNull();
    expect(target.parentElement!.getAttribute("data-invalid")).toBe("true");
    expect(invalidFields(latest)[0]).toMatchObject({ section: "delivery", field: "districtCode" });
  });

  test("marks the rate with a focus target when the district is chosen but no rate is", async () => {
    vi.mocked(requestDeliveryQuotation).mockResolvedValue(ok({ rates: [] } as never));
    await mount(newState());
    await choose("Domicilio");
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-testid=district]")!.click(); });
    const target = document.getElementById("order-delivery-rateId")!;
    expect(target.parentElement!.getAttribute("data-invalid")).toBe("true");
    expect(invalidFields(latest).map(mark => mark.field)).toContain("rateId");
  });

  test("keeps the saved method as a disabled tab when settings no longer offer it", async () => {
    await mount(savedState(), { ...settings, home: { enabled: false } } as DeliverySettingsResponse);
    expect(tab("Domicilio")).toBeDefined();
    expect(tab("Domicilio").getAttribute("aria-selected")).toBe("true");
  });

  test("brings the saved place back when the seller returns to the saved method", async () => {
    await mount(savedState());
    await choose("Recojo en tienda");
    expect(latest.draft.delivery.fields.districtCode).toBeNull();
    await choose("Domicilio");
    expect(latest.draft.delivery.fields.districtCode).toBe("150122");
    expect(latest.draft.delivery.fields.rateId).toBe(rateId);
    expect(latest.draft.delivery.fields.address).toBe("Av. Lima 123");
  });
});
