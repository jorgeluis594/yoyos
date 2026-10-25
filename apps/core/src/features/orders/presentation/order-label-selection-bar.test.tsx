// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { OrderLabelSelectionBar, selectionBarText } from "@core/src/features/orders/presentation/order-label-selection-bar";
import { emptySelection, summarizeSelection, togglePage, type SelectedOrder } from "@core/src/features/orders/presentation/order-label-selection";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const order = (number: number, deliveryMethod: SelectedOrder["deliveryMethod"] = "home", status: SelectedOrder["status"] = "active"): SelectedOrder =>
  ({ id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`, number, deliveryMethod, status });
const summary = (orders: SelectedOrder[]) => summarizeSelection(togglePage(emptySelection, orders));
const instance = async (lng: "es" | "pt") => { const i18n = createInstance(); await i18n.use(initReactI18next).init({ lng, resources }); return i18n; };

test("names every skipped reason, joined like a sentence, in each language", async () => {
  const all = summary([order(1), order(2, "none"), order(3, "pickup"), order(4, "home", "cancelled")]);
  const es = await instance("es");
  const pt = await instance("pt");

  expect(selectionBarText(es.t, "es", all)).toBe("4 pedidos seleccionados · 1 sin dirección, 1 de recojo y 1 cancelado no se imprimirán");
  expect(selectionBarText(pt.t, "pt", all)).toBe("4 pedidos selecionados · 1 sem endereço, 1 de retirada e 1 cancelado não serão impressos");
  expect(selectionBarText(es.t, "es", summary([order(1)]))).toBe("1 pedido seleccionado");
  expect(selectionBarText(es.t, "es", summary([order(1), order(2, "home", "cancelled"), order(3, "home", "cancelled")]))).toBe("3 pedidos seleccionados · 2 cancelados no se imprimirán");
});

test("above 100 orders the bar explains the limit and the print button is disabled", async () => {
  const many = summary(Array.from({ length: 101 }, (_, index) => order(index + 1)));
  const onPrint = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(<I18nextProvider i18n={await instance("es")}><OrderLabelSelectionBar summary={many} onClear={() => undefined} onPrint={onPrint} /></I18nextProvider>));

  expect(container.textContent).toContain("101 pedidos seleccionados · Puedes imprimir hasta 100 rótulos a la vez");
  const print = [...container.querySelectorAll("button")].find((item) => item.textContent?.startsWith("Imprimir rótulos"))!;
  expect(print.disabled).toBe(true);
  act(() => print.click());
  expect(onPrint).not.toHaveBeenCalled();
  act(() => root.unmount());
  container.remove();
});
