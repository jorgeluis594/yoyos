// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { DispatchLabelPrintDialog } from "@core/src/features/dispatch-labels/presentation/dispatch-label-print-dialog";
import type { CreateDispatchLabelsResponse } from "@shared/contracts/dispatch-labels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const third = "00000000-0000-4000-8000-000000000003";
const pdf = btoa("%PDF-1.4 test");
const ready = (size: "label_62x100" | "a4" = "label_62x100", extra: Partial<CreateDispatchLabelsResponse> = {}): CreateDispatchLabelsResponse =>
  ({ pdf, size, printed: [{ orderId: first, orderNumber: 7 }], excluded: [], notFound: [], ...extra });

let root: Root | undefined;
let container: HTMLDivElement;
let requests: { orderIds: string[]; size: string }[];
let answers: (() => Promise<Response>)[];

beforeEach(() => {
  requests = [];
  answers = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return (answers.shift() ?? (async () => { throw new Error("unexpected request"); }))();
  }));
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  container = document.body.appendChild(document.createElement("div"));
});
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const json = (body: CreateDispatchLabelsResponse, status = 200) => async () => Response.json(body, { status });

async function mount(props: { orderIds: readonly string[]; orderNumber?: number }) {
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={["/es-PE/orders"]}>
    <DispatchLabelPrintDialog open onOpenChange={() => undefined} {...props} /></MemoryRouter></I18nextProvider>));
}
const body = () => document.body;
const button = (name: string) => [...body().querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === name);
const frame = () => body().querySelector<HTMLIFrameElement>("iframe");

test("asks for one order in the default size and shows the preview, the caption, the hint and the sender link", async () => {
  answers.push(json(ready()));

  await mount({ orderIds: [first], orderNumber: 7 });

  expect(requests).toEqual([{ orderIds: [first], size: "label_62x100" }]);
  expect(body().querySelector('[role="dialog"]')?.textContent).toContain("Imprimir rótulo · Pedido #7");
  expect(frame()?.getAttribute("src")).toBe("blob:preview");
  expect(body().textContent).toContain("Vista previa del PDF · 62 × 100 mm, vertical");
  expect(body().textContent).toContain("Etiqueta 62 × 100 mm");
  expect(body().textContent).toContain("Imprime al 100 % (sin ajustar a la página)");
  expect(body().querySelector('a[href="/es-PE/settings/delivery#sender"]')?.textContent).toBe("Cambiar remitente");
  expect(button("Descargar PDF")?.disabled).toBe(false);
  expect(button("Imprimir")?.disabled).toBe(false);
});

test("shows the loading state while the PDF is prepared and the plural title for several orders", async () => {
  answers.push(() => new Promise<Response>(() => undefined));

  await mount({ orderIds: [first, second] });

  expect(body().textContent).toContain("Preparando rótulos…");
  expect(body().querySelector('[role="dialog"]')?.textContent).toContain("Imprimir rótulos");
  expect(body().querySelector('[role="dialog"]')?.textContent).toContain("2 pedidos");
  expect(frame()).toBeNull();
  expect(button("Imprimir")?.disabled).toBe(true);
});

test("a failed request shows the error with retry and retrying asks again", async () => {
  answers.push(async () => { throw new TypeError("offline") }, json(ready()));

  await mount({ orderIds: [first], orderNumber: 7 });
  expect(body().querySelector('[role="alert"]')?.textContent).toContain("No se pudo preparar el PDF");
  expect(frame()).toBeNull();

  await act(async () => button("Reintentar")!.click());

  expect(requests).toHaveLength(2);
  expect(frame()).not.toBeNull();
  expect(body().querySelector('[role="alert"]')).toBeNull();
});

test("an answer that is not a success is also an error", async () => {
  answers.push(async () => Response.json({ error: "x" }, { status: 503 }));

  await mount({ orderIds: [first], orderNumber: 7 });

  expect(body().querySelector('[role="alert"]')?.textContent).toContain("No se pudo preparar el PDF");
});

test("with nothing printable only the reasons are shown and download and print are disabled", async () => {
  answers.push(json({ pdf: null, size: "label_62x100", printed: [], notFound: [third], excluded: [
    { orderId: first, orderNumber: 7, exclusion: { code: "METHOD_NOT_APPLICABLE" } },
    { orderId: second, orderNumber: 8, exclusion: { code: "MISSING_DATA", fields: ["recipientPhone", "district"] } },
  ] }));

  await mount({ orderIds: [first, second, third] });

  expect(frame()).toBeNull();
  expect(body().textContent).not.toContain("Vista previa del PDF ·");
  expect(body().textContent).toContain("Pedido #7");
  expect(body().textContent).toContain("Recojo en tienda: no lleva rótulo");
  expect(body().textContent).toContain("Pedido #8");
  expect(body().textContent).toContain("Faltan datos: teléfono, distrito");
  expect(body().textContent).toContain("Pedido no encontrado");
  expect(button("Descargar PDF")?.disabled).toBe(true);
  expect(button("Imprimir")?.disabled).toBe(true);
});

test("a PDF with excluded orders lists them beside the preview", async () => {
  answers.push(json(ready("label_62x100", { excluded: [{ orderId: second, orderNumber: 8, exclusion: { code: "LABEL_CONTENT_OVERFLOW" } }] })));

  await mount({ orderIds: [first, second] });

  expect(frame()).not.toBeNull();
  expect(body().textContent).toContain("El contenido no cabe en el rótulo");
});

test("choosing A4 asks again with that size and changes the caption", async () => {
  answers.push(json(ready()), json(ready("a4")));
  await mount({ orderIds: [first], orderNumber: 7 });

  await act(async () => body().querySelector<HTMLElement>('[data-slot="select"]')!.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === "A4")!;
  await act(async () => option.click());

  expect(requests).toEqual([{ orderIds: [first], size: "label_62x100" }, { orderIds: [first], size: "a4" }]);
  expect(body().textContent).toContain("Vista previa del PDF · A4, vertical · 6 rótulos por hoja");
});

test("download names the file after the order and print prints the preview", async () => {
  answers.push(json(ready()));
  await mount({ orderIds: [first], orderNumber: 7 });
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(`${this.download}|${this.href}`); });
  const print = vi.fn();
  Object.defineProperty(frame()!, "contentWindow", { value: { focus: () => undefined, print } });

  await act(async () => button("Descargar PDF")!.click());
  await act(async () => button("Imprimir")!.click());

  expect(downloads).toEqual(["rotulo-pedido-7.pdf|blob:preview"]);
  expect(print).toHaveBeenCalledTimes(1);
});

test("several orders download with the date in Lima", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-24T03:00:00Z") });
  try {
    answers.push(json(ready()));
    await mount({ orderIds: [first, second] });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });

    await act(async () => button("Descargar PDF")!.click());

    expect(downloads).toEqual(["rotulos-2026-10-23.pdf"]);
  } finally { vi.useRealTimers(); }
});
