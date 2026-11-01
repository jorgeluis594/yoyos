import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

/** A payment of a seeded sale; a reported or rejected one carries no amount, as the stored ones do. */
export type SeedPayment = Readonly<{ status: "confirmed" | "reported" | "rejected" | "voided"; amount?: number; method?: "digital_wallet" | "bank_transfer"; walletProvider?: "yape" | "plin" }>;
/** An order with one item line: `items` is the item subtotal, `charge` the delivery charge the buyer pays, and the total their sum. */
export type SeedSale = Readonly<{
  number: number; createdAt: Date; items: number; charge?: number; currency?: string; cancelled?: boolean;
  unconfirmedCatalog?: boolean; payments?: readonly SeedPayment[];
}>;

export type SalesStore = Readonly<{ companyId: string; sellerId: string; variantId: string; sell: (sale: SeedSale) => Promise<string>; dispose: () => Promise<void> }>;

/** The instant of a Lima wall-clock time (UTC−5, no daylight saving). */
export const lima = (isoLocal: string): Date => new Date(`${isoLocal}:00-05:00`);

const confirmedData = (sellerId: string) => ({ confirmedAt: "2026-11-03T15:00:00.000Z", confirmedBy: { kind: "seller", userId: sellerId }, evidence: { kind: "manual" } });

/** A company with a seller and one variant, plus a way to write sales in it through the tenant connection; every test uses its own isolated company. */
export async function createSalesStore(name: string): Promise<SalesStore> {
  const companyId = randomUUID();
  const sellerId = `seller-${companyId}`;
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name, country: "PE" } }); });
  const variantId = await withTenantIsolation(companyId, async () => {
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, emailVerified: true, companyId } });
    return [...(await seedProduct({ variants: [{ attributes: { Talla: "M" }, stock: 10 }] })).variantIds][0] as string;
  });
  const sell = (sale: SeedSale) => withTenantIsolation(companyId, async () => {
    const id = randomUUID();
    const charge = sale.charge ?? 0;
    await prisma.order.create({ data: {
      id, number: BigInt(sale.number), currency: sale.currency ?? "PEN", total: new Prisma.Decimal(sale.items + charge), itemsTotal: new Prisma.Decimal(sale.items), deliveryCost: new Prisma.Decimal(charge), deliveryCharge: new Prisma.Decimal(charge),
      createdAt: sale.createdAt, cancelled: sale.cancelled ?? false, cancelledAt: sale.cancelled ? sale.createdAt : null,
      fromCatalog: sale.unconfirmedCatalog ?? false, checkoutEnabledAt: sale.unconfirmedCatalog ? sale.createdAt : null, sellerId: sale.unconfirmedCatalog ? null : sellerId,
    } });
    await prisma.orderItem.create({ data: { orderId: id, orderCreatedAt: sale.createdAt, variantId, productName: "Polo", variantAttributes: { Talla: "M" }, quantity: 1n, unitPrice: new Prisma.Decimal(sale.items), subtotal: new Prisma.Decimal(sale.items) } });
    for (const payment of sale.payments ?? []) {
      const reported = payment.status === "reported" || payment.status === "rejected";
      await prisma.payment.create({ data: {
        id: randomUUID(), orderId: id, status: payment.status, amount: reported ? null : new Prisma.Decimal(payment.amount ?? 0), currency: sale.currency ?? "PEN",
        method: reported ? null : payment.method ?? "digital_wallet", walletProvider: reported ? null : payment.walletProvider ?? null,
        data: reported ? { receiptImageId: randomUUID(), reportedAt: "2026-11-03T15:00:00.000Z" } : confirmedData(sellerId),
      } });
    }
    return id;
  });
  const dispose = async () => {
    await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.assistantConnection.deleteMany();
    });
  };
  return { companyId, sellerId, variantId, sell, dispose };
}

const yape = (amount: number, status: SeedPayment["status"] = "confirmed"): SeedPayment => ({ status, amount, method: "digital_wallet", walletProvider: "yape" });
const plin = (amount: number): SeedPayment => ({ status: "confirmed", amount, method: "digital_wallet", walletProvider: "plin" });

/** The October example of the product definition (Tienda Rosa, PEN), asked after the month ended. */
export async function seedOctoberExample(store: SalesStore): Promise<void> {
  await store.sell({ number: 1001, createdAt: lima("2026-10-03T11:00"), items: 105, charge: 15, payments: [yape(120, "voided"), yape(120)] });
  await store.sell({ number: 1002, createdAt: lima("2026-10-10T11:00"), items: 120, payments: [{ status: "rejected" }, plin(50)] });
  await store.sell({ number: 1003, createdAt: lima("2026-10-12T11:00"), items: 100, cancelled: true, payments: [yape(40), { status: "reported" }] });
  await store.sell({ number: 1004, createdAt: lima("2026-10-20T11:00"), items: 225, charge: 15, payments: [{ status: "reported" }] });
  await store.sell({ number: 1005, createdAt: lima("2026-10-31T23:30"), items: 190, charge: 10, payments: [yape(210)] });
  await store.sell({ number: 1006, createdAt: lima("2026-10-15T11:00"), items: 175, unconfirmedCatalog: true });
}
