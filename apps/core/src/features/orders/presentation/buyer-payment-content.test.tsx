// @vitest-environment jsdom
import type { BuyerPaymentView } from "@shared/contracts/orders";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { BuyerPaymentContent } from "@core/src/features/orders/presentation/buyer-payment-content";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const orderId = "00000000-0000-4000-8000-000000000001";
const imageId = "00000000-0000-4000-8000-000000000002";
const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const wallet = { method: "digital_wallet", provider: "Plin", holder: "Jorge", imageUrl: "https://cdn.example/qr.png" } as const;
const bank = { method: "bank_transfer", bank: "BCP", holder: "Tienda", accountNumber: "194-123", cci: "00200000000000000001", imageUrl: null } as const;
const base: BuyerPaymentView = { orderId, total: pen(70), deliveryCharge: pen(10), availability: "available", paidAmount: pen(0),
  balanceDue: pen(70), paymentStatus: "pending", settings: [wallet, bank], payments: [] };
const i18n = createInstance();
void i18n.use(initReactI18next).init({ lng: "es", resources });

describe("BuyerPaymentContent", () => {
  let root: Root | undefined;
  beforeEach(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true }); });
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

  async function mount(view: BuyerPaymentView) {
    const Stub = createRoutesStub([{ path: "/", Component: () => <BuyerPaymentContent view={view} /> }]);
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub /></I18nextProvider>));
    return container;
  }
  const button = (container: HTMLElement, name: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name);
  const pick = (container: HTMLElement, file: File) => act(async () => {
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const png = (size = 248 * 1024) => new File([new Uint8Array(size)], "pago.png", { type: "image/png" });
  const mockUpload = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: imageId, url: "https://cdn.example/r.png" }), { status: 201 }));

  test("lays the payment methods in one wrapping row instead of a two-column grid", async () => {
    const container = await mount(base);
    const group = container.querySelector("fieldset")!;
    expect(group.className).toContain("flex-wrap");
    expect(group.className).not.toContain("grid");
    expect([...group.querySelectorAll("input[type=radio]")]).toHaveLength(2);
  });

  test("shows the contained QR beside the wallet data and the amounts, without a separate summary card", async () => {
    const container = await mount(base);
    expect(container.querySelector("section[aria-label='Resumen del pedido']")).toBeNull();
    const details = container.querySelector("[data-store-part=payment-details]")!;
    const qr = details.querySelector("[data-store-part=payment-image] img")!;
    expect(qr.getAttribute("src")).toBe("https://cdn.example/qr.png");
    expect(qr.className).toMatch(/size-\d+|h-\d+/);
    expect(qr.className).not.toContain("w-full");
    const row = (label: string) => [...details.querySelectorAll("dt")].find((term) => term.textContent === label)?.nextElementSibling?.textContent;
    expect(row("Proveedor")).toBe("Plin");
    expect(row("Titular")).toBe("Jorge");
    expect(row("Total del pedido")).toContain("70");
    expect(row("Incluye entrega")).toContain("10");
    expect(row("Saldo pendiente")).toContain("70");
  });

  test("switches the method and copies the account and CCI", async () => {
    const container = await mount(base);
    await act(async () => container.querySelector<HTMLInputElement>("input[value=bank_transfer]")!.click());
    expect(container.textContent).toContain("BCP");
    await act(async () => button(container, "Copiar cuenta")!.click());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("194-123");
    expect(container.querySelector("[role=status]")?.textContent).toBe("Cuenta copiada.");
    await act(async () => button(container, "Copiar CCI")!.click());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("00200000000000000001");
  });

  test("uploads the receipt, lists its name and size in the row and submits it", async () => {
    const fetchSpy = mockUpload();
    const container = await mount(base);
    const submit = button(container, "Ya pagué") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await pick(container, png());
    expect(fetchSpy).toHaveBeenCalledWith(`/api/buyer/orders/${orderId}/images`, expect.objectContaining({ method: "POST" }));
    const chosen = container.querySelector("[data-testid=receipt-file]")!;
    expect(chosen.textContent).toContain("pago.png");
    expect(chosen.textContent).toContain("248 KB");
    expect(container.textContent).toContain("Captura lista para enviar.");
    expect(submit.disabled).toBe(false);
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ paymentId: orderId, status: "reported" }), { status: 201 }));
    await act(async () => submit.click());
    expect(fetchSpy).toHaveBeenLastCalledWith(`/api/buyer/orders/${orderId}/reports`, expect.objectContaining({ method: "POST" }));
    expect(container.textContent).toContain("Pago pendiente de revisión");
  });

  test("removes the chosen file and disables the submit button again", async () => {
    mockUpload();
    const container = await mount(base);
    await pick(container, png());
    await act(async () => button(container, "Quitar archivo")!.click());
    expect(container.querySelector("[data-testid=receipt-file]")).toBeNull();
    expect(container.textContent).not.toContain("Captura lista para enviar.");
    expect((button(container, "Ya pagué") as HTMLButtonElement).disabled).toBe(true);
  });

  test("rejects an unsupported file and offers a retry when the upload fails", async () => {
    const container = await mount(base);
    await pick(container, new File(["x"], "nota.pdf", { type: "application/pdf" }));
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Usa una imagen JPG, PNG o WEBP de hasta 10 MB.");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 502 }));
    await pick(container, png());
    expect(container.querySelector("[role=alert]")?.textContent).toContain("No se pudo subir la captura");
    mockUpload();
    await act(async () => button(container, "Reintentar subida")!.click());
    expect(container.textContent).toContain("Captura lista para enviar.");
  });

  test("keeps the amounts and the sent receipts when there is nothing to pay or no way to pay", async () => {
    const withReceipt = { ...base, settings: [], payments: [{ id: imageId, status: "confirmed" as const, amount: pen(70), method: null, receiptImageUrl: "https://cdn.example/r.png" }] };
    const container = await mount(withReceipt);
    expect(container.textContent).toContain("El negocio aún no ha configurado sus datos de cobro");
    expect(container.textContent).toContain("Saldo pendiente");
    expect(container.querySelector("a[href='https://cdn.example/r.png']")?.textContent).toBe("Ver captura · Confirmado");
  });
});
