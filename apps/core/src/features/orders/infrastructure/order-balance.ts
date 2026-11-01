import { Prisma } from "@prisma/client";

/**
 * What an order still owes and what it was overpaid, from its total and its confirmed payments (both SQL expressions, `numeric`).
 * The one rule behind **Pedidos por cobrar** and the sales summary: an order is unpaid when `confirmed < total`.
 */
export function orderBalance(total: Prisma.Sql, confirmed: Prisma.Sql) {
  return {
    unpaid: Prisma.sql`${confirmed} < ${total}`,
    owed: Prisma.sql`greatest(${total} - ${confirmed}, 0)`,
    overpaid: Prisma.sql`greatest(${confirmed} - ${total}, 0)`,
  };
}
