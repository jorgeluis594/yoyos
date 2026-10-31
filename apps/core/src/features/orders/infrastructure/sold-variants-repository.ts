import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { isCurrency, type Currency } from "@shared/money";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, inActiveTransaction, prisma } from "@core/src/shared/infrastructure/persistance";
import { transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { SalesReadFailure } from "@core/src/features/orders/application/sales-types";
import type { CurrencySoldTotals, SoldVariant, SoldVariantsSummary, SummarizeSoldVariantsInput } from "@core/src/features/orders/application/summarize-sold-variants";
import type { FindVariantSaleDatesInput, VariantSaleDates } from "@core/src/features/orders/application/find-variant-sale-dates";
import { visibleOrder } from "@core/src/features/orders/infrastructure/order-visibility";
import { centsText, moneyOfCents } from "@core/src/features/orders/infrastructure/sales-cents";

const count = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().refine(Number.isSafeInteger));
const currencyText = z.string().refine(isCurrency, "Stored currency is invalid").transform((value) => value as Currency);

/** One Zod union for the rows of the sold variants statement; `variantId` is null in the per-currency rows. */
const soldRow = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("variant"), currency: currencyText, variantId: z.guid(), units: count, cents: centsText }),
  z.strictObject({ kind: z.literal("currency"), currency: currencyText, variantId: z.null(), units: count, cents: centsText }),
  z.strictObject({ kind: z.literal("orders"), currency: currencyText, variantId: z.null(), units: count, cents: z.null() }),
]);

const dateRow = z.strictObject({ variantId: z.guid(), soldInWindow: z.boolean(), lastBefore: z.date().nullable(), firstAfter: z.date().nullable() });

const unavailable = (message: string): Result<never, SalesReadFailure> => err({ code: "PERSISTENCE_UNAVAILABLE", message });
const invalid = (event: string): Result<never, SalesReadFailure> => {
  log.error({ event, errorCode: "INVALID_STORED_ORDER" }, event);
  return err({ code: "INVALID_STORED_ORDER", message: "Invalid stored order" });
};

/** Inside a snapshot a transaction failure (statement limit, timer, lock) is rethrown for the snapshot to classify; outside it every database failure is a result. */
function readFailure(cause: unknown, event: string): Result<never, SalesReadFailure> {
  const database = cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError
    || (cause instanceof Error && cause.name === "DriverAdapterError");
  if (!database || (inActiveTransaction() && transactionFailureStage(cause))) throw cause;
  log.error({ event, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, event);
  return unavailable("Unable to read sales");
}

/**
 * Units and item subtotals per variant and currency sold in the window, plus the totals and the order count of each currency, in one statement.
 * The orders of the window are read through `Order_companyId_createdAt_id_key` and their items through `OrderItem (companyId, orderId, variantId)`;
 * the `GROUPING SETS` carry no `DISTINCT` aggregate, so PostgreSQL can hash them, and the order count is `count(*)` over the window (every order has an item).
 * Bounds are untyped parameters: a `timestamptz` comparison is not leakproof and would lose the index under the forced row-level policy.
 */
export function soldVariantsSql(companyId: string, input: SummarizeSoldVariantsInput): Prisma.Sql {
  // The per-currency rows stay whole; only the per-variant rows are narrowed.
  const narrowed = input.variantIds === undefined ? Prisma.empty : Prisma.sql`HAVING GROUPING(i."variantId") = 1 OR i."variantId" = ANY(${[...input.variantIds]}::uuid[])`;
  return Prisma.sql`WITH w AS (
      SELECT o.id, o.currency FROM "Order" o
      WHERE o."companyId" = ${companyId}::uuid AND o."createdAt" >= ${input.window.from} AND o."createdAt" < ${input.window.before} AND NOT o.cancelled AND ${visibleOrder}
    ), sold AS (
      SELECT w.currency, i."variantId", GROUPING(i."variantId") AS whole, sum(i.quantity) AS units, sum(i.subtotal) AS amount
      FROM w JOIN "OrderItem" i ON i."companyId" = ${companyId}::uuid AND i."orderId" = w.id
      GROUP BY GROUPING SETS ((w.currency, i."variantId"), (w.currency))
      ${narrowed}
    )
    SELECT CASE WHEN s.whole = 1 THEN 'currency' ELSE 'variant' END AS kind, s.currency, s."variantId"::text AS "variantId", s.units::text AS units,
      round(s.amount * 100)::bigint::text AS cents FROM sold s
    UNION ALL SELECT 'orders', w.currency, NULL, count(*)::text, NULL FROM w GROUP BY w.currency`;
}

export async function readSoldVariants(input: SummarizeSoldVariantsInput, companyId: CompanyId): Promise<Result<SoldVariantsSummary, SalesReadFailure>> {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  let rows: unknown[];
  try {
    rows = await prisma.$queryRaw<unknown[]>(soldVariantsSql(companyId, input));
  } catch (cause) {
    return readFailure(cause, "unable_to_read_sold_variants");
  }
  const parsed = z.array(soldRow).safeParse(rows);
  if (!parsed.success) return invalid("sold_variants_invalid_row");
  const variants: SoldVariant[] = [];
  const totals = new Map<Currency, { units: number; cents: number; orders: number }>();
  for (const row of parsed.data) {
    const total = totals.get(row.currency) ?? { units: 0, cents: 0, orders: 0 };
    if (row.kind === "variant") variants.push({ variantId: row.variantId, currency: row.currency, units: row.units, amount: moneyOfCents(row.cents, row.currency) });
    else if (row.kind === "currency") { total.units = row.units; total.cents = row.cents; } else total.orders = row.units;
    totals.set(row.currency, total);
  }
  const currencies: CurrencySoldTotals[] = [...totals].map(([currency, total]) => ({ currency, orders: total.orders, units: total.units, amount: moneyOfCents(total.cents, currency) }))
    .sort((a, b) => (a.currency < b.currency ? -1 : 1));
  return ok({ variants, currencies });
}

/**
 * Per variant: whether it sold in the window, its latest valid sale before it and, when asked, its earliest at or after its end, from the item date index.
 * Each probe stops at the first valid sale (skipping only cancelled or unconfirmed-catalog items), so the cost depends on the catalog and not on the history;
 * the dates before and after are looked up only for a variant not sold in the window. The `OFFSET 0` fence keeps the planner from flattening the probe into a join.
 */
export function saleDatesSql(companyId: string, input: FindVariantSaleDatesInput): Prisma.Sql {
  const probe = (condition: Prisma.Sql, direction: Prisma.Sql) => Prisma.sql`SELECT oi."orderCreatedAt" FROM "OrderItem" oi
      JOIN "Order" o ON o."companyId" = oi."companyId" AND o.id = oi."orderId"
      WHERE oi."companyId" = ${companyId}::uuid AND oi."variantId" = ids.variant_id AND ${condition} AND NOT o.cancelled AND ${visibleOrder}
      ORDER BY oi."orderCreatedAt" ${direction} LIMIT 1`;
  const inWindow = Prisma.sql`oi."orderCreatedAt" >= ${input.window.from} AND oi."orderCreatedAt" < ${input.window.before}`;
  const before = Prisma.sql`oi."orderCreatedAt" < ${input.window.from}`;
  const after = Prisma.sql`oi."orderCreatedAt" >= ${input.window.before}`;
  return Prisma.sql`SELECT ids.variant_id::text AS "variantId", s.sold AS "soldInWindow",
      CASE WHEN NOT s.sold THEN (${probe(before, Prisma.sql`DESC`)}) END AS "lastBefore",
      ${input.needFirstAfter ? Prisma.sql`CASE WHEN NOT s.sold THEN (${probe(after, Prisma.sql`ASC`)}) END` : Prisma.sql`NULL::timestamp`} AS "firstAfter"
    FROM unnest(${[...input.variantIds]}::uuid[]) AS ids(variant_id)
    CROSS JOIN LATERAL (SELECT (${probe(inWindow, Prisma.sql`ASC`)}) IS NOT NULL AS sold OFFSET 0) s`;
}

export async function readSaleDates(input: FindVariantSaleDatesInput, companyId: CompanyId): Promise<Result<readonly VariantSaleDates[], SalesReadFailure>> {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  let rows: unknown[];
  try {
    rows = await prisma.$queryRaw<unknown[]>(saleDatesSql(companyId, input));
  } catch (cause) {
    return readFailure(cause, "unable_to_read_variant_sale_dates");
  }
  const parsed = z.array(dateRow).safeParse(rows);
  return parsed.success ? ok(parsed.data) : invalid("variant_sale_dates_invalid_row");
}
