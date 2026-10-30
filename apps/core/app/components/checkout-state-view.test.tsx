// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub, useLoaderData } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PublicCheckoutResponse } from "@shared/contracts/order-checkout";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import resources from "@core/app/locales";
import { CheckoutStateView } from "@core/app/components/checkout-state-view";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const orderId = "00000000-0000-4000-8000-000000000001";
const imageId = "00000000-0000-4000-8000-000000000002";
const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type ViewPayment = BuyerPaymentView["payments"][number];
const reportedPayment = (n: number, reportedAt: string, receiptImageUrl: string | null = `https://cdn.example/r${n}.png`): ViewPayment =>
  ({ id: id(n), status: "reported", amount: null, method: null, receiptImageUrl, rejectionReason: null, reportedAt });
const rejectedPayment = (n: number, reason: string): ViewPayment =>
  ({ id: id(n), status: "rejected", amount: null, method: null, receiptImageUrl: `https://cdn.example/r${n}.png`, rejectionReason: reason, reportedAt: "2026-10-30T23:42:00.000Z" });
const confirmedPayment = (n: number, amount: number): ViewPayment =>
  ({ id: id(n), status: "confirmed", amount: pen(amount), method: "bank_transfer", receiptImageUrl: null, rejectionReason: null, reportedAt: null });
const voidedPayment = (n: number, amount: number): ViewPayment => ({ ...confirmedPayment(n, amount), status: "voided" });
const wallet = { method: "digital_wallet", provider: "Plin", holder: "Jorge", imageUrl: "https://cdn.example/qr.png" } as const;
const baseView: BuyerPaymentView = { orderId, total: pen(30), deliveryCharge: pen(10), availability: "available", paidAmount: pen(0), balanceDue: pen(30),
  paymentStatus: "pending", settings: [wallet], payments: [], rejectedReport: null };
const view = (overrides: Partial<BuyerPaymentView> = {}): BuyerPaymentView => ({ ...baseView, ...overrides });
const checkoutOf = (state: PublicCheckoutResponse["state"]): PublicCheckoutResponse => ({ companyName: "Lima Studio", number: 1001, buyer: { name: "Ana Pérez", phone: "+51987654321" },
  items: [{ productName: "Polo básico", variantAttributes: {}, sku: null, imageUrl: null, quantity: 1, unitPrice: pen(20), subtotal: pen(20) }],
  itemsTotal: pen(20), deliveryCharge: pen(10), total: pen(30), delivery: null, state });
const confirmedState = { kind: "confirmed", confirmedAt: "2026-10-30T12:00:00.000Z" } as const;

const i18nFor = async (lng: string) => { const instance = createInstance(); await instance.use(initReactI18next).init({ lng, resources }); return instance; };

/** What the server answers; tests change it between loads to play the seller's moves. */
type Server = { checkout: PublicCheckoutResponse; payment: BuyerPaymentView | null };
type Calls = { reports: unknown[]; payments: number; loads: number };

describe("CheckoutStateView", () => {
  let root: Root | undefined;
  beforeEach(() => { vi.stubGlobal("scrollTo", vi.fn()); });
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function mount(server: Server, { lng = "es", slowLoad }: { lng?: string; slowLoad?: () => Promise<void> } = {}) {
    const i18n = await i18nFor(lng);
    const calls: Calls = { reports: [], payments: 0, loads: 0 };
    const Page = () => { const data = useLoaderData() as Server; return <CheckoutStateView appearance={null} checkout={data.checkout} payment={data.payment} />; };
    const Stub = createRoutesStub([{ path: "/", loader: async () => { calls.loads += 1; if (calls.loads > 1) await slowLoad?.(); return { checkout: server.checkout, payment: server.payment }; }, Component: Page }]);
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub /></I18nextProvider>));
    await act(async () => {});
    return { container, calls };
  }

  type Net = { report?: () => Response; probe?: () => Response; onReport?: () => void };
  function network(calls: Calls, { report, probe, onReport }: Net = {}, server?: Server) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/images")) return new Response(JSON.stringify({ id: imageId, url: "https://cdn.example/r.png" }), { status: 201 });
      if (url.endsWith("/reports")) {
        calls.reports.push(JSON.parse(String(init?.body)));
        onReport?.();
        return report ? report() : new Response(JSON.stringify({ paymentId: id(9), status: "reported" }), { status: 201 });
      }
      calls.payments += 1;
      return probe ? probe() : new Response(JSON.stringify(server?.payment ?? baseView), { status: 200 });
    });
  }
  const png = () => new File([new Uint8Array(2048)], "pago.png", { type: "image/png" });
  const pick = (container: HTMLElement) => act(async () => {
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { value: [png()], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const sendReport = async (container: HTMLElement) => {
    await pick(container);
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Ya pagué")!.click());
    await act(async () => {});
  };
  const rowValue = (container: HTMLElement, label: string) => [...container.querySelectorAll("dt")].find((term) => term.textContent === label)?.nextElementSibling?.textContent;
  const labels = (container: HTMLElement) => [...container.querySelectorAll("dt")].map((term) => term.textContent);
  const heading = (container: HTMLElement, text: string) => [...container.querySelectorAll("h2")].find((h) => h.textContent === text);
  const payRegion = (container: HTMLElement) => container.querySelector("section[aria-label='Pago del pedido']");

  test("payment step with no payments shows one «Monto a pagar» row, no confirmed block and a summary ending in «Total del pedido»", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view() });
    expect(container.textContent).not.toContain("Pedido confirmado");
    expect(container.textContent).not.toContain("Incluye entrega");
    expect(rowValue(container, "Monto a pagar")).toContain("30.00");
    expect(labels(container).filter((label) => label === "Monto a pagar")).toHaveLength(1);
    expect(labels(container)).not.toContain("Pagado");
    expect(labels(container)).not.toContain("Saldo pendiente");
    const summary = container.querySelector("section[aria-label='Total del pedido']")!;
    expect(summary.querySelector("[data-store-part=total-label]")?.textContent).toBe("Total del pedido");
    expect(summary.querySelector("[data-store-part=total-amount]")?.textContent).toContain("30.00");
  });

  test("payment step with a partial payment shows total, «Pagado» and «Saldo pendiente» as the only amount due and keeps the upload block", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ paidAmount: pen(20), balanceDue: pen(10), payments: [confirmedPayment(2, 20)] }) });
    const box = container.querySelector("[data-store-part=payment-details]")!;
    const inBox = (label: string) => [...box.querySelectorAll("dt")].find((term) => term.textContent === label)?.nextElementSibling?.textContent;
    expect(inBox("Total del pedido")).toContain("30.00");
    expect(inBox("Pagado")).toContain("20.00");
    expect(inBox("Saldo pendiente")).toContain("10.00");
    expect(labels(container)).not.toContain("Monto a pagar");
    expect(container.querySelector("input[type=file]")).not.toBeNull();
  });

  test("payment step after the only payment of a paid order is voided shows «Monto a pagar S/ 30.00»", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ payments: [voidedPayment(2, 30)] }) });
    expect(rowValue(container, "Monto a pagar")).toContain("30.00");
    expect(labels(container)).not.toContain("Pagado");
  });

  test("pending receipt shows the closing card under the title, buyer details and summary, with no payment methods, upload or amounts due", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z")] }) });
    const header = container.querySelector("header")!;
    expect(header.querySelector("h1")?.textContent).toBe("Pedido #1001");
    expect(header.querySelector("h2#checkout-closing-title")?.textContent).toBe("Recibimos tu comprobante");
    expect(header.textContent).toContain("La tienda revisará tu pago y te confirmará cuando lo reciba. No necesitas hacer nada más por ahora.");
    expect(header.textContent).toContain("Si enviaste una captura equivocada, escríbele a la tienda por donde hiciste tu pedido.");
    expect(heading(container, "Datos del comprador")).toBeDefined();
    expect(container.querySelector("section[aria-label='Total del pedido']")).not.toBeNull();
    for (const absent of ["Cómo pagar", "Adjunta tu comprobante", "Comprobantes enviados"]) expect(heading(container, absent)).toBeUndefined();
    expect(container.querySelector("input[type=file]")).toBeNull();
    expect(container.querySelector("[data-store-part=payment-details]")).toBeNull();
    for (const label of ["Monto a pagar", "Pagado", "Saldo pendiente"]) expect(labels(container)).not.toContain(label);
  });

  test("closing card lists two receipts with their Lima dates newest first and a new-tab accessible name", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({
      payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z"), reportedPayment(3, "2026-10-30T23:50:00.000Z")] }) });
    const links = [...container.querySelectorAll<HTMLAnchorElement>("#checkout-closing-title ~ ul a")];
    expect(links.map((link) => link.textContent)).toEqual(["Ver captura · 30 oct. 2026, 6:50 p. m.(se abre en una pestaña nueva)", "Ver captura · 30 oct. 2026, 6:42 p. m.(se abre en una pestaña nueva)"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://cdn.example/r3.png", "https://cdn.example/r2.png"]);
    for (const link of links) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toContain("noreferrer");
      expect(link.className).toContain("min-h-11");
      expect(link.querySelector(".sr-only")?.textContent).toBe("(se abre en una pestaña nueva)");
    }
  });

  test("closing card without a resolvable receipt image shows no «Ver captura» link", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z", null)] }) });
    expect(container.querySelector("h2#checkout-closing-title")).not.toBeNull();
    expect(container.querySelector("#checkout-closing-title ~ ul")).toBeNull();
    expect(container.textContent).not.toContain("Ver captura");
  });

  test("closing card with two pending receipts, one without an image, links one and lists the other as dated text", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({
      payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z"), reportedPayment(3, "2026-10-30T23:50:00.000Z", null)] }) });
    const items = [...container.querySelectorAll("#checkout-closing-title ~ ul li")];
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector("a")).toBeNull();
    expect(items[0]!.textContent).toBe("Ver captura · 30 oct. 2026, 6:50 p. m.");
    expect(items[1]!.querySelector("a")?.getAttribute("href")).toBe("https://cdn.example/r2.png");
  });

  test("closing card shows a clock icon, no check icon and no approval wording, and the page has no «Pago» region", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z")] }) });
    const card = container.querySelector("#checkout-closing-title")!.parentElement!;
    expect(card.querySelector("svg.lucide-clock")).not.toBeNull();
    expect(card.querySelector("svg.lucide-circle-check")).toBeNull();
    expect(card.getAttribute("role")).toBeNull();
    expect(card.textContent).not.toMatch(/aprobad|confirmad|pagado/i);
    expect(payRegion(container)).toBeNull();
  });

  test("cancelled checkout shows only «Pedido cancelado» under the title, with no payment content and no closing card", async () => {
    const { container } = await mount({ checkout: checkoutOf({ kind: "cancelled" }), payment: null });
    expect(container.querySelector("header h2#checkout-cancelled-title")?.textContent).toBe("Pedido cancelado");
    expect(container.querySelectorAll("#checkout-cancelled-title")).toHaveLength(1);
    expect(payRegion(container)).toBeNull();
    expect(container.querySelector("#checkout-closing-title")).toBeNull();
    expect(container.querySelector("[role=status]")).toBeNull();
    const cancelledView = await mount({ checkout: checkoutOf(confirmedState), payment: view({ availability: "cancelled", payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z")] }) });
    expect(cancelledView.container.querySelectorAll("#checkout-cancelled-title")).toHaveLength(1);
  });

  test("rejected report shows the reason at the start of the upload block", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ rejectedReport: { reason: "La captura no muestra el monto" }, payments: [rejectedPayment(2, "La captura no muestra el monto")] }) });
    const notice = container.querySelector("h2#checkout-rejected-title")!;
    expect(notice.textContent).toBe("Tu comprobante fue rechazado");
    expect(notice.parentElement?.textContent).toContain("Motivo: La captura no muestra el monto");
    expect(notice.parentElement?.getAttribute("role")).toBeNull();
    expect(notice.compareDocumentPosition(heading(container, "Adjunta tu comprobante")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("input[type=file]")).not.toBeNull();
  });

  test("paid order shows «Pedido pagado» with total, «Pagado» and «Saldo pendiente S/ 0.00» and keeps a pending receipt as «Pendiente»", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ paymentStatus: "paid", paidAmount: pen(30), balanceDue: pen(0),
      payments: [confirmedPayment(2, 30), reportedPayment(3, "2026-10-30T23:42:00.000Z")] }) });
    expect(container.querySelector("h2#checkout-paid-title")?.textContent).toBe("Pedido pagado");
    expect(container.querySelector("#checkout-paid-title")?.parentElement?.getAttribute("role")).toBeNull();
    expect(rowValue(container, "Total del pedido")).toContain("30.00");
    expect(rowValue(container, "Pagado")).toContain("30.00");
    expect(rowValue(container, "Saldo pendiente")).toContain("0.00");
    expect(container.querySelector("#checkout-closing-title")).toBeNull();
    expect(container.querySelector("a[href='https://cdn.example/r3.png']")?.textContent).toBe("Ver captura · Pendiente");
  });

  test("overpaid order shows «Pagado S/ 35.00» and «Saldo pendiente S/ 0.00» with no notice", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ paymentStatus: "paid", paidAmount: pen(35), balanceDue: pen(0), payments: [confirmedPayment(2, 35)] }) });
    expect(rowValue(container, "Pagado")).toContain("35.00");
    expect(rowValue(container, "Saldo pendiente")).toContain("0.00");
    expect(container.textContent).not.toMatch(/exceso|de más|sobrepag/i);
  });

  test("manual payment covering the total while a receipt is pending shows the paid state", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ paymentStatus: "paid", paidAmount: pen(30), balanceDue: pen(0),
      payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z"), confirmedPayment(3, 30)] }) });
    expect(container.querySelector("#checkout-paid-title")).not.toBeNull();
    expect(container.querySelector("#checkout-closing-title")).toBeNull();
  });

  test("not-available view with a pending receipt shows the not-available card, not the closing screen", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ availability: "delivery_quote_pending", payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z")] }) });
    expect(heading(container, "Entrega pendiente de cotización")).toBeDefined();
    expect(container.querySelector("#checkout-closing-title")).toBeNull();
    expect(rowValue(container, "Total del pedido")).toContain("30.00");
    expect(heading(container, "Comprobantes enviados")).toBeDefined();
  });

  test("summary card is rendered without the phone-hiding class in confirmed states and is not sticky below desktop", async () => {
    for (const payment of [view(), view({ payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z")] }), view({ paymentStatus: "paid", paidAmount: pen(30), balanceDue: pen(0) })]) {
      const { container } = await mount({ checkout: checkoutOf(confirmedState), payment });
      const summary = container.querySelector("section[aria-label='Total del pedido']")!;
      expect(summary.className).not.toContain("max-lg:hidden");
      expect(summary.className).toContain("lg:sticky");
      expect(summary.className.split(" ")).not.toContain("sticky");
      act(() => root?.unmount());
    }
  });

  test("summary card region is named «Total del pedido» once confirmed and «Total a pagar» while pending", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view() });
    expect(container.querySelector("section[aria-label='Total del pedido']")).not.toBeNull();
    expect(container.querySelector("section[aria-label='Total a pagar']")).toBeNull();
  });

  describe("after «Ya pagué»", () => {
    const reportedAfter = (server: Server, extra: ViewPayment[] = []) => () => { server.payment = view({ payments: [...(server.payment?.payments ?? []), ...extra, reportedPayment(9, "2026-10-30T23:42:00.000Z")] }); };

    test("focus moves to «Recibimos tu comprobante» and the card is not a live region", async () => {
      const server: Server = { checkout: checkoutOf(confirmedState), payment: view() };
      const { container, calls } = await mount(server);
      network(calls, { onReport: reportedAfter(server) }, server);
      await sendReport(container);
      expect(calls.reports).toEqual([{ paymentId: expect.any(String), receiptImageId: imageId }]);
      const title = container.querySelector("h2#checkout-closing-title")!;
      expect(title.textContent).toBe("Recibimos tu comprobante");
      expect(document.activeElement).toBe(title);
      expect(title.closest("[role]")).toBeNull();
      expect(container.querySelector("input[type=file]")).toBeNull();
    });

    test("on an already rejected report focus moves to «Tu comprobante fue rechazado»", async () => {
      const rejected = view({ rejectedReport: { reason: "Borroso" }, payments: [rejectedPayment(2, "Borroso")] });
      const server: Server = { checkout: checkoutOf(confirmedState), payment: rejected };
      const { container, calls } = await mount(server);
      // The seller already rejected this payment: the answer is «reported», but the refreshed view still holds the rejection.
      network(calls, {}, server);
      await sendReport(container);
      expect(document.activeElement).toBe(container.querySelector("h2#checkout-rejected-title"));
    });

    test("focus moves to «Pedido pagado» or to the cancelled heading under the title", async () => {
      const paid: Server = { checkout: checkoutOf(confirmedState), payment: view() };
      const first = await mount(paid);
      network(first.calls, { onReport: () => { paid.payment = view({ paymentStatus: "paid", paidAmount: pen(30), balanceDue: pen(0), payments: [confirmedPayment(2, 30)] }); } }, paid);
      await sendReport(first.container);
      expect(document.activeElement).toBe(first.container.querySelector("h2#checkout-paid-title"));
      act(() => root?.unmount());
      vi.restoreAllMocks();
      const cancelled: Server = { checkout: checkoutOf(confirmedState), payment: view() };
      const second = await mount(cancelled);
      network(second.calls, { report: () => new Response(JSON.stringify({ code: "ORDER_CANCELLED" }), { status: 409 }),
        onReport: () => { cancelled.checkout = checkoutOf({ kind: "cancelled" }); cancelled.payment = null; } }, cancelled);
      await sendReport(second.container);
      expect(document.activeElement).toBe(second.container.querySelector("header h2#checkout-cancelled-title"));
    });

    test("a failed send keeps the screenshot, reuses the same payment id on retry and shows the closing screen once it succeeds", async () => {
      const server: Server = { checkout: checkoutOf(confirmedState), payment: view() };
      const { container, calls } = await mount(server);
      let attempt = 0;
      network(calls, { report: () => ++attempt === 1 ? new Response("down", { status: 502 }) : new Response(JSON.stringify({ paymentId: id(9), status: "reported" }), { status: 201 }),
        onReport: () => { if (attempt === 1) server.payment = view({ payments: [reportedPayment(9, "2026-10-30T23:42:00.000Z")] }); } }, server);
      await sendReport(container);
      expect(container.querySelector("[role=alert]")?.textContent).toContain("No se pudo enviar el aviso");
      expect(container.querySelector("[data-testid=receipt-file]")?.textContent).toContain("pago.png");
      await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Ya pagué")!.click());
      await act(async () => {});
      expect(calls.reports).toHaveLength(2);
      expect((calls.reports[1] as { paymentId: string }).paymentId).toBe((calls.reports[0] as { paymentId: string }).paymentId);
      expect(container.querySelector("#checkout-closing-title")).not.toBeNull();
    });

    test("a recorded report whose refresh read fails shows the reload message with focus and no «Ya pagué»", async () => {
      const server: Server = { checkout: checkoutOf(confirmedState), payment: view() };
      const { container, calls } = await mount(server);
      network(calls, { probe: () => new Response("boom", { status: 500 }) }, server);
      await sendReport(container);
      const message = [...container.querySelectorAll("p")].find((p) => p.textContent === "Enviamos tu comprobante, pero no pudimos actualizar la página. Recárgala para ver el estado de tu pago.")!;
      expect(document.activeElement).toBe(message);
      expect(message.closest("[role=status],[role=alert]")).toBeNull();
      expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toContain("Recargar página");
      expect([...container.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("Ya pagué");
      expect(container.querySelector("input[type=file]")).toBeNull();
      expect(calls.loads).toBe(1);
    });

    test("a recorded report whose refresh read answers ORDER_CANCELLED shows «Pedido cancelado» with focus, not the reload message", async () => {
      const server: Server = { checkout: checkoutOf(confirmedState), payment: view() };
      const { container, calls } = await mount(server);
      network(calls, { probe: () => new Response(JSON.stringify({ code: "ORDER_CANCELLED" }), { status: 409 }),
        onReport: () => { server.checkout = checkoutOf({ kind: "cancelled" }); server.payment = null; } }, server);
      await sendReport(container);
      expect(document.activeElement).toBe(container.querySelector("h2#checkout-cancelled-title"));
      expect(container.textContent).not.toContain("Recargar página");
    });

    test("focus is not lost when the settle callback runs before the refreshed data renders", async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const server: Server = { checkout: checkoutOf(confirmedState), payment: view() };
      const { container, calls } = await mount(server, { slowLoad: () => gate });
      network(calls, { onReport: reportedAfter(server) }, server);
      await sendReport(container);
      // The refreshed data is still loading: the old screen stays and focus is not forced anywhere.
      expect(container.querySelector("#checkout-closing-title")).toBeNull();
      await act(async () => { release(); await gate; });
      await act(async () => {});
      expect(document.activeElement).toBe(container.querySelector("h2#checkout-closing-title"));
    });
  });

  test("rendering or reloading a closing screen moves no focus", async () => {
    const { container } = await mount({ checkout: checkoutOf(confirmedState), payment: view({ payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z")] }) });
    expect(container.querySelector("#checkout-closing-title")).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  test("renders the closing screen, «Valor a pagar» and «Valor pago» in Portuguese", async () => {
    const closing = await mount({ checkout: checkoutOf(confirmedState), payment: view({ payments: [reportedPayment(2, "2026-10-30T23:42:00.000Z"), reportedPayment(3, "2026-10-30T23:50:00.000Z")] }) }, { lng: "pt" });
    expect(closing.container.querySelector("#checkout-closing-title")?.textContent).toBe("Recebemos seu comprovante");
    expect(closing.container.textContent).toContain("Ver captura · 30 de out. de 2026, 18:50");
    expect(closing.container.querySelector("a .sr-only")?.textContent).toBe("(abre em uma nova aba)");
    act(() => root?.unmount());
    const none = await mount({ checkout: checkoutOf(confirmedState), payment: view() }, { lng: "pt" });
    expect(rowValue(none.container, "Valor a pagar")).toContain("30");
    act(() => root?.unmount());
    const partial = await mount({ checkout: checkoutOf(confirmedState), payment: view({ paidAmount: pen(20), balanceDue: pen(10), payments: [confirmedPayment(2, 20)] }) }, { lng: "pt" });
    expect(rowValue(partial.container, "Valor pago")).toContain("20");
    expect(partial.container.querySelector("section[aria-label='Total do pedido']")).not.toBeNull();
  });
});
