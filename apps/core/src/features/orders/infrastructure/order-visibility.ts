import { Prisma } from "@prisma/client";

/** Unconfirmed catalog orders do not exist for the seller; the order table is aliased `o`. */
export const visibleOrder = Prisma.sql`NOT (o."fromCatalog" AND o."checkoutConfirmedAt" IS NULL)`;
