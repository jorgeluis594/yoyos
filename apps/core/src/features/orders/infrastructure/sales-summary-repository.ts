import { z } from "zod";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { isCurrency, type Currency } from "@shared/money";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, inActiveTransaction, prisma } from "@core/src/shared/infrastructure/persistance";
import { transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import { visibleOrder } from "@core/src/features/orders/infrastructure/order-visibility";
import { orderBalance } from "@core/src/features/orders/infrastructure/order-balance";
import { centsText, moneyOfCents } from "@core/src/features/orders/infrastructure/sales-cents";
import type { SalesFigures, SalesSummary, SummarizeSalesInput } from "@core/src/features/orders/application/summarize-sales";
import type { SalesReadFailure } from "@core/src/features/orders/application/sales-types";
import type { CompanyId } from "@core/src/features/orders/domain/order";

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

const currency = z.string().refine(isCurrency);
const count = z.number().int().nonnegative();
const figuresRow = z.object({
  kind: z.literal("figures"), current: z.boolean(), currency, orders: count, items: centsText, charges: centsText, total: centsText, received: centsText, owed: centsText, overpaid: centsText,
  cancelledOrders: count, cancelledTotal: centsText, cancelledConfirmed: centsText,
});
const methodRow = z.object({ kind: z.literal("method"), current: z.boolean(), currency, method: z.enum(["digital_wallet", "bank_transfer"]), provider: z.string().nullable(), received: centsText });
const reportsRow = z.object({ kind: z.literal("reports"), reports: count, reportOrders: count });
const existsRow = z.object({ kind: z.literal("exists"), found: z.boolean() });
const salesRow = z.discriminatedUnion("kind", [figuresRow, methodRow, reportsRow, existsRow]);

/** `round(sum(x) * 100)::bigint::text`: exact on `numeric(15,2)`, parsed by `centsText`; the filter keeps cancelled orders out of the sales figures. */
const cents = (expression: Prisma.Sql, filter: Prisma.Sql = Prisma.sql`true`) => Prisma.sql`round(coalesce(sum(${expression}) FILTER (WHERE ${filter}), 0) * 100)::bigint::text`;

/**
 * The figures of two windows in one statement: the orders visible and created in either window (two index ranges on `Order_companyId_createdAt_id_key`, never the gap
 * between them), the payments of those orders only, and typed rows (`kind`) for the figures per window and currency, the confirmed payments per method and provider,
 * the pending reports of the current window and whether the store has any visible order. A not cancelled order feeds sales, received, owed and overpaid; a cancelled one
 * feeds only the cancelled counters. Bounds are untyped parameters, never `::timestamptz`: under the forced RLS policy that comparison is not leakproof and loses the index.
 */
export function salesFiguresStatement(input: SummarizeSalesInput, companyId: CompanyId): Prisma.Sql {
  const { current, previous } = input;
  const balance = orderBalance(Prisma.sql`w.total`, Prisma.sql`w.confirmed`);
  const notCancelled = Prisma.sql`NOT w.cancelled`, cancelledOnly = Prisma.sql`w.cancelled`;
  return Prisma.sql`
      WITH win AS (
        SELECT o.id, o.currency, o.total, o."itemsTotal", o."deliveryCharge", o.cancelled, (o."createdAt" >= ${current.from} AND o."createdAt" < ${current.before}) AS "isCurrent"
        FROM "Order" o
        WHERE o."companyId" = ${companyId}::uuid AND ${visibleOrder}
          AND ((o."createdAt" >= ${current.from} AND o."createdAt" < ${current.before}) OR (o."createdAt" >= ${previous.from} AND o."createdAt" < ${previous.before}))
      ), pay AS (
        SELECT p."orderId", p.status, p.amount, p.method, p."walletProvider"
        FROM "Payment" p JOIN win ON win.id = p."orderId"
        WHERE p."companyId" = ${companyId}::uuid AND p.status IN ('confirmed', 'reported')
      ), paid AS (
        SELECT "orderId", coalesce(sum(amount) FILTER (WHERE status = 'confirmed'), 0) AS confirmed, (count(*) FILTER (WHERE status = 'reported'))::int AS reports
        FROM pay GROUP BY "orderId"
      ), w AS (
        SELECT win.*, coalesce(paid.confirmed, 0) AS confirmed, coalesce(paid.reports, 0) AS reports FROM win LEFT JOIN paid ON paid."orderId" = win.id
      )
      SELECT 'figures'::text AS kind, w."isCurrent" AS current, w.currency, NULL::text AS method, NULL::text AS provider,
        (count(*) FILTER (WHERE NOT w.cancelled))::int AS orders,
        ${cents(Prisma.sql`w."itemsTotal"`, notCancelled)} AS items, ${cents(Prisma.sql`w."deliveryCharge"`, notCancelled)} AS charges, ${cents(Prisma.sql`w.total`, notCancelled)} AS total,
        ${cents(Prisma.sql`w.confirmed`, notCancelled)} AS received, ${cents(balance.owed, notCancelled)} AS owed, ${cents(balance.overpaid, notCancelled)} AS overpaid,
        (count(*) FILTER (WHERE w.cancelled))::int AS "cancelledOrders", ${cents(Prisma.sql`w.total`, cancelledOnly)} AS "cancelledTotal", ${cents(Prisma.sql`w.confirmed`, cancelledOnly)} AS "cancelledConfirmed",
        NULL::int AS reports, NULL::int AS "reportOrders", NULL::boolean AS found
      FROM w GROUP BY w."isCurrent", w.currency
      UNION ALL
      SELECT 'method', win."isCurrent", win.currency, pay.method, pay."walletProvider", NULL, NULL, NULL, NULL, ${cents(Prisma.sql`pay.amount`)}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM pay JOIN win ON win.id = pay."orderId" WHERE pay.status = 'confirmed' AND NOT win.cancelled GROUP BY win."isCurrent", win.currency, pay.method, pay."walletProvider"
      UNION ALL
      SELECT 'reports', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, coalesce(sum(w.reports), 0)::int, count(*)::int, NULL
      FROM w WHERE w."isCurrent" AND NOT w.cancelled AND w.reports > 0
      UNION ALL
      SELECT 'exists', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        EXISTS (SELECT 1 FROM "Order" o WHERE o."companyId" = ${companyId}::uuid AND ${visibleOrder})`;
}

export async function readSalesFigures(input: SummarizeSalesInput, companyId: CompanyId): Promise<Result<SalesSummary, SalesReadFailure>> {
  if (getCompanyId() !== companyId) throw new Error("Order company differs from tenant context");
  try {
    const rows = await prisma.$queryRaw<unknown[]>(salesFiguresStatement(input, companyId));
    const parsed = z.array(salesRow).safeParse(rows);
    if (!parsed.success) {
      log.error({ event: "sales_summary_invalid_row", errorCode: "INVALID_STORED_ORDER" }, "Invalid sales summary row");
      return err({ code: "INVALID_STORED_ORDER" as const, message: "Invalid stored order" });
    }
    return ok(summaryOf(parsed.data));
  } catch (cause) {
    // Inside a budgeted snapshot a timeout is rethrown so the snapshot classifies it; any other database failure is a result.
    if (!knownFailure(cause) || (inActiveTransaction() && transactionFailureStage(cause))) throw cause;
    log.error({ event: "unable_to_summarize_sales", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_summarize_sales");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to summarize sales" });
  }
}

type SalesRow = z.output<typeof salesRow>;

function summaryOf(rows: readonly SalesRow[]): SalesSummary {
  const figuresOf = (isCurrent: boolean): SalesFigures[] => rows
    .filter((row): row is z.output<typeof figuresRow> => row.kind === "figures" && row.current === isCurrent)
    .map((row) => {
      const code = row.currency as Currency;
      const receivedBy = rows.filter((method): method is z.output<typeof methodRow> => method.kind === "method" && method.current === isCurrent && method.currency === row.currency)
        .map((method) => ({ method: method.method, walletProvider: method.provider as SalesFigures["receivedBy"][number]["walletProvider"], amount: moneyOfCents(method.received, code) }));
      return {
        currency: code, orders: row.orders, items: moneyOfCents(row.items, code), deliveryCharges: moneyOfCents(row.charges, code), total: moneyOfCents(row.total, code),
        received: moneyOfCents(row.received, code), owed: moneyOfCents(row.owed, code), overpaid: moneyOfCents(row.overpaid, code), receivedBy,
        cancelled: { orders: row.cancelledOrders, total: moneyOfCents(row.cancelledTotal, code), confirmed: moneyOfCents(row.cancelledConfirmed, code) },
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const reports = rows.find((row): row is z.output<typeof reportsRow> => row.kind === "reports");
  const exists = rows.find((row): row is z.output<typeof existsRow> => row.kind === "exists");
  return { current: figuresOf(true), previous: figuresOf(false), pendingReports: { reports: reports?.reports ?? 0, orders: reports?.reportOrders ?? 0 }, storeHasOrders: exists?.found === true };
}
