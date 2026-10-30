import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findProductIdsOfVariants } from "@core/src/features/products";
import { findChatOrderTarget } from "@core/src/features/orders/infrastructure/order-repository";
import { findChatPendings } from "@core/src/features/orders/infrastructure/chat-pending-repository";
import { pendingLife } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import { evalCatalogSchema, productIdOf, variantIdOf } from "@core/evals/fixtures/catalog";
import { privateCompanyId, seedEvalCatalog } from "@core/evals/lib/eval-catalog";
import { seedChatStart, type ChatStart } from "@core/evals/lib/production";

/** Seeds each start of a case with no model call and reads back what the reader would see: the chat's order target and its pendings. */

const catalog = evalCatalogSchema.parse({ products: [
  { key: "camisa", name: "Camisa", variants: [
    { attributes: { Talla: "M", Color: "Negro" }, price: 30 }, { attributes: { Talla: "L", Color: "Negro" }, price: 30 }, { attributes: { Talla: "M", Color: "Blanco" }, price: 30 }] },
  { key: "gorra", name: "Gorra", variants: [{ attributes: { Color: "Rojo" }, price: 20 }, { attributes: { Color: "Azul" }, price: 20 }] },
  { key: "bufanda", name: "Bufanda", variants: [{ attributes: {}, price: 15 }] },
  { key: "campera", name: "Campera", variants: [{ attributes: { Talla: "M" }, price: 80, active: false }, { attributes: { Talla: "L" }, price: 80 }] },
  { key: "polera", name: "Polera", active: false, variants: [{ attributes: { Talla: "M" }, price: 60 }] },
] });

const ten = 10 * 60_000;
const line = (product: string, variant: Record<string, string>, quantity = 1) => ({ product, variant, quantity });
const itemsOf = (target: Awaited<ReturnType<typeof seen>>["target"]) => target.kind === "open"
  ? target.order.items.map((item) => `${item.variantId}:${Number(item.quantity)}`).sort() : [];
const item = (product: string, variant: Record<string, string>, quantity: number) => `${variantIdOf(product, variant, "private")}:${quantity}`;
const start = (value: Partial<ChatStart>): ChatStart => ({ order: [], pendings: [], ...value });

async function seen(chatId: string) {
  return await withTenantIsolation(privateCompanyId, async () => {
    const target = await findChatOrderTarget(chatId as ChatId, findProductIdsOfVariants);
    const pendings = await findChatPendings(chatId as ChatId);
    if (!target.success || !pendings.success) throw new Error("The chat state cannot be read");
    const life = pendingLife(pendings.data, { target: target.data, openedSince: [] }, new Date(Date.now() + 1000), ten * 1000);
    return { target: target.data, stored: pendings.data, life };
  });
}

const variantStatus = (product: string, variant: Record<string, string>) => withTenantIsolation(privateCompanyId, async () =>
  (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantIdOf(product, variant, "private") } })).status);

beforeAll(async () => { await seedEvalCatalog(catalog, privateCompanyId, null); });
afterAll(async () => {
  await withTenantIsolation(privateCompanyId, async () => {
    for (const table of ["chatPendings", "chatMessageOutcome", "orderMessage", "payment", "orderItem", "order", "chatMessage", "chat", "contact", "customer", "productStock", "productVariant", "productOption", "product", "image"] as const) {
      await (prisma[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
    }
    await systemPrisma.user.deleteMany({ where: { companyId: privateCompanyId } });
    await prisma.company.deleteMany({ where: { id: privateCompanyId } });
  });
});

describe("seeding the start of a case", () => {
  test("an empty start leaves a chat with no order and no pendings", async () => {
    const { chatId } = await seedChatStart(start({}), "private");
    const state = await seen(chatId);

    expect(state.target).toEqual({ kind: "none" });
    expect(state.stored).toEqual({ pendings: [], readyRemembered: false });
  });

  test("an order is open with its lines and quantities", async () => {
    const { chatId } = await seedChatStart(start({ order: [line("camisa", { Color: "Negro", Talla: "M" }, 2), line("gorra", { Color: "Rojo" })] }), "private");
    const { target } = await seen(chatId);

    expect(target.kind).toBe("open");
    expect(itemsOf(target)).toEqual([item("camisa", { Talla: "M", Color: "Negro" }, 2), item("gorra", { Color: "Rojo" }, 1)].sort());
  });

  test("pendings are saved through the repository: a named product with its known values and a doubtful one with its candidates", async () => {
    const { chatId } = await seedChatStart(start({
      order: [line("gorra", { Color: "Azul" })],
      pendings: [{ product: "camisa", known: { Talla: "M" }, quantity: 3 }, { candidates: ["camisa", "gorra"], known: {}, quantity: 1 }],
    }), "private");
    const { target, stored, life } = await seen(chatId);

    expect(stored.pendings).toHaveLength(2);
    expect(stored.pendings[0]).toMatchObject({ subject: { kind: "variant", productId: productIdOf("camisa", "private") }, known: { Talla: "M" }, quantity: 3 });
    expect(stored.pendings[1]).toMatchObject({ subject: { kind: "product", candidates: [productIdOf("camisa", "private"), productIdOf("gorra", "private")] }, quantity: 1 });
    expect(target.kind === "open" && stored.pendings.every((pending) => pending.order?.orderId === target.order.id)).toBe(true);
    expect(life.alive).toHaveLength(2);
    expect(life.ended).toEqual([]);
  });

  test("pendings without an order stay orderless and alive", async () => {
    const { chatId } = await seedChatStart(start({ pendings: [{ product: "camisa", known: {}, quantity: 1 }] }), "private");
    const { target, stored, life } = await seen(chatId);

    expect(target).toEqual({ kind: "none" });
    expect(stored.pendings[0]!.order).toBeNull();
    expect(life.alive).toHaveLength(1);
  });

  test("a closed order is a closed target the chat cannot change, and its pendings end with it", async () => {
    const { chatId } = await seedChatStart(start({ order: [line("camisa", { Talla: "L", Color: "Negro" })], pendings: [{ product: "gorra", known: {}, quantity: 1 }], orderState: "closed" }), "private");
    const { target, life } = await seen(chatId);

    expect(target.kind).toBe("closed");
    expect(life.alive).toEqual([]);
    expect(life.ended.map(({ reason }) => reason)).toEqual(["order_closed"]);
    const order = await withTenantIsolation(privateCompanyId, async () => await prisma.order.findFirstOrThrow({ where: { chatId }, include: { payments: true } }));
    expect(order.payments.map(({ status }) => status)).toEqual(["confirmed"]);
  });

  test("an order line of an inactive variant or product is kept, and the variant is inactive again afterwards", async () => {
    const { chatId } = await seedChatStart(start({ order: [line("campera", { Talla: "M" }), line("polera", { Talla: "M" }, 2), line("campera", { Talla: "L" })] }), "private");
    const { target } = await seen(chatId);

    expect(itemsOf(target)).toEqual([item("campera", { Talla: "M" }, 1), item("polera", { Talla: "M" }, 2), item("campera", { Talla: "L" }, 1)].sort());
    expect(await variantStatus("campera", { Talla: "M" })).toBe("inactive");
    expect(await variantStatus("polera", { Talla: "M" })).toBe("inactive");
    expect(await variantStatus("campera", { Talla: "L" })).toBe("active");
  });
});
