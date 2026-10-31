import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { limaCalendarDay } from "@shared/orders-date";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { RegisteredTool, ToolRun, ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";
import { maxProductName, type Display } from "@core/src/features/assistants/domain/order-projection";
import { moreProductsLine, stockSummaryLine } from "@core/src/features/assistants/domain/product-projection";
import { periodDays, resolveSalesPeriod, type SalesPeriod } from "@core/src/features/assistants/domain/sales-period";
import { clipText, listUnsoldProducts, type ProjectableSaleDates, type ProjectableStockedProduct } from "@core/src/features/assistants/domain/product-sales-projection";
import { day, page, unknownField } from "@core/src/features/assistants/presentation/tools/input-fields";
import { display as defaultDisplay } from "@core/src/features/assistants/presentation/display";
import { todayLine } from "@core/src/features/assistants/presentation/tools/orders-texts";
import { pageOutOfRangeMessage } from "@core/src/features/assistants/presentation/tools/products-texts";
import { periodRefusalMessage } from "@core/src/features/assistants/presentation/tools/sales-texts";
import {
  allSoldMessage, createdAfterMessage, createdLine, lastSaleLine, noProductMatchesMessage, noProductsAtAllMessage, noStockTodayMessage, periodPhrase, shortPeriodNote,
  soldAgainLine, stockIsTodayNote, unsoldHeader, unsoldProductsDescription, unsoldTextHeader,
} from "@core/src/features/assistants/presentation/tools/product-sales-texts";

type Failure = ToolRunError;
type Read<T> = Promise<Result<T, Failure>>;

/** The period as whole Lima days, narrowed by an optional phrase. */
export type UnsoldProductsRequest = Readonly<{ period: SalesPeriod; text?: string }>;
/**
 * The checked products (existing by the end of the period, with stock today) and, for each of their variants, whether it sold in the period and its
 * latest sale before it and earliest after it; `dates` is empty when nothing was checked, and no order was read then.
 */
export type UnsoldProductsAnswer = Readonly<{
  storeHasProducts: boolean; matching: number; withStock: number;
  checked: readonly ProjectableStockedProduct[]; dates: readonly ProjectableSaleDates[];
}>;

/** What the tool needs of products and orders; `src/composition/assistant-product-sales-capabilities.ts` wires the composed operations. */
export type UnsoldProductsDependencies = Readonly<{
  clock: () => Date;
  appLink: (productId: string) => string;
  read: (request: UnsoldProductsRequest & Readonly<{ needFirstAfter: boolean }>, access: AssistantAccess) => Read<UnsoldProductsAnswer>;
}>;

const inputSchema = z.strictObject({
  desde: day.optional(), hasta: day.optional(),
  texto: z.string({ error: "texto debe ser un texto." }).trim().max(120, "texto admite como máximo 120 caracteres.").optional(),
  pagina: page,
}, unknownField);

const text = z.string();
const outputSchema = z.strictObject({
  hoy: text, resumen: text.optional(), mensaje: text.optional(), aviso: text.optional(), stock_nota: text.optional(), pagina: z.number(), total: z.number(), hay_mas: text.optional(),
  productos: z.array(z.strictObject({ id: text, nombre: text, stock: text, fechas: text, enlace: text })).readonly(),
});
export type UnsoldProductsOutput = z.output<typeof outputSchema>;

const invalid = (message: string): Failure => ({ code: "INVALID_INPUT", message });
/** A period shorter than this many days gets the note that asks for at least a month. */
const shortPeriodDays = 14;

export type UnsoldProductsOptions = Readonly<{ display?: Display }>;

export function createUnsoldProductsTool(deps: UnsoldProductsDependencies, options: UnsoldProductsOptions = {}): RegisteredTool<z.output<typeof inputSchema>, UnsoldProductsOutput> {
  const display = options.display ?? defaultDisplay;

  return {
    name: "productos_sin_ventas", title: "Productos sin ventas", description: unsoldProductsDescription, inputSchema, outputSchema,
    sampleOutputs: [sampleUnsold()],
    async run(input, access): Promise<ToolRun<UnsoldProductsOutput>> {
      const today = limaCalendarDay(deps.clock());
      const resolved = resolveSalesPeriod({ ...input.desde === undefined ? {} : { desde: input.desde }, ...input.hasta === undefined ? {} : { hasta: input.hasta } }, today);
      if (!resolved.success) return err(invalid(periodRefusalMessage(resolved.error)));
      const period = resolved.data;
      const searched = input.texto === undefined || input.texto === "" ? undefined : input.texto;
      const phrase = periodPhrase(period, display);
      const frame = { hoy: todayLine(display.day(today)) };
      const empty = (mensaje: string, aviso?: string): ToolRun<UnsoldProductsOutput> =>
        ok({ output: { ...frame, mensaje, ...aviso === undefined ? {} : { aviso }, pagina: 1, total: 0, productos: [] }, empty: true });

      const periodEndedBeforeToday = period.through < today;
      const read = await deps.read({ period, needFirstAfter: periodEndedBeforeToday, ...searched === undefined ? {} : { text: searched } }, access);
      if (!read.success) return read;
      const { storeHasProducts, matching, withStock, checked, dates } = read.data;
      // The empty answers, in this order, so «all sold» is said only when something was checked.
      if (!storeHasProducts) return empty(noProductsAtAllMessage);
      if (matching === 0) return empty(noProductMatchesMessage(searched ?? ""));
      if (withStock === 0) return empty(noStockTodayMessage(searched));
      const short = periodDays(period) < shortPeriodDays ? shortPeriodNote(periodDays(period)) : undefined;
      if (checked.length === 0) return empty(createdAfterMessage(searched, period.through, display), short);

      const list = listUnsoldProducts(checked, dates, { page: input.pagina, periodEndedBeforeToday });
      if (list.total === 0) return empty(allSoldMessage(list.checked, searched, phrase), short);
      if (list.items.length === 0) return ok({ output: { ...frame, mensaje: pageOutOfRangeMessage(list.total), pagina: input.pagina, total: list.total, productos: [] }, empty: true });

      const resumen = searched === undefined ? unsoldHeader(list.total, list.checked, phrase) : unsoldTextHeader(list.total, list.checked, searched, phrase);
      const more = moreProductsLine(input.pagina, list.total);
      return ok({
        output: {
          ...frame, resumen, ...short === undefined ? {} : { aviso: short }, stock_nota: stockIsTodayNote, pagina: input.pagina, total: list.total, ...more === undefined ? {} : { hay_mas: more },
          productos: list.items.map(({ product, lastBefore, firstAfter }) => ({
            id: product.id, nombre: clipText(product.name, maxProductName), stock: stockSummaryLine({ totalStock: product.stock.total, soldOut: product.stock.soldOut, low: product.stock.low, onlyLevel: product.stock.onlyLevel }),
            fechas: [
              lastSaleLine(lastBefore === null ? null : display.date(lastBefore)),
              ...firstAfter === null ? [] : [soldAgainLine(display.date(firstAfter))],
              ...limaCalendarDay(product.createdAt) >= period.from ? [createdLine(display.date(product.createdAt))] : [],
            ].join(" · "),
            enlace: deps.appLink(product.id),
          })),
        },
        empty: false,
      });
    },
  };
}

// Sample output for the static validator: a page of 20 products at maximum lengths.
const long = (length: number, seed = "x") => seed.repeat(length).slice(0, length);
const uuidSample = "0123abcd-0000-4000-8000-000000000000";
function sampleUnsold(): UnsoldProductsOutput {
  return {
    hoy: "Hoy es 31/10/2026", resumen: unsoldTextHeader(99_999, 99_999, long(120, "polo "), "del 01/10/2026 al 31/10/2026 (hasta hoy)"), aviso: shortPeriodNote(3), stock_nota: stockIsTodayNote,
    pagina: 1, total: 21, hay_mas: "hay más: pide la página 2",
    productos: Array.from({ length: 20 }, () => ({
      id: uuidSample, nombre: long(maxProductName, "Casaca "), stock: stockSummaryLine({ totalStock: 99_999, soldOut: 99, low: 99, onlyLevel: null }),
      fechas: [lastSaleLine("14/08/2026"), soldAgainLine("15/10/2026"), createdLine("25/10/2026")].join(" · "), enlace: `https://app.yoyos.lat/products/${uuidSample}`,
    })),
  };
}
