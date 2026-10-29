import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { dispatchLabels } from "@core/src/features/dispatch-labels/composition";
import { createLabelPdf } from "@core/src/features/dispatch-labels/infrastructure/label-pdf";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Dispatch labels server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { companyId: string; userId: string }[] = [];

const district = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
const pricing = () => ({ quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 });
const recordedBy = { kind: "seller", userId: "seller" };
const recipient = { name: "Ana Pérez", phone: "999 888 777", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
const home = () => ({ method: "home", recipient, pricing: pricing(), recordedBy, destination: { address: "Calle 2 #123", ...district, instructions: "Portón azul" } });
const agency = () => ({ method: "agency", recipient, destination: district, pricing: pricing(), recordedBy, courier: { id: randomUUID(), name: "Olva" },
  agency: { id: randomUUID(), name: "Olva Centro", address: "Av. 1", location: district } });
const store = () => ({ method: "store", recipient, pickupPoint: { name: "Tienda", address: "Jr. 1", instructions: null }, settingsVersion: 1, recordedBy });

function post(body: unknown, cookie?: string) {
  return fetch(`${base}/api/dispatch-labels`, { method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body) });
}

async function seller() {
  const companyId = randomUUID();
  const email = `dispatch-labels-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Mi Negocio", country: "PE" } }));
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  fixtures.push({ companyId, userId });
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }) });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Dispatch labels test session missing");
  const productId = randomUUID();
  const variantId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    await seedProduct({ id: productId, name: "Camisa", qrCode: productId, variants: [{ id: variantId, attributes: { Talla: "M" }, sku: `SKU-${variantId}`, salePrice: 10, qrCode: variantId }] });
  });
  let next = 1001n;
  async function order(delivery: unknown, extra: { cancelled?: boolean } = {}) {
    const id = randomUUID();
    await withTenantIsolation(companyId, async () => {
      await prisma.order.create({ data: { id, number: next++, sellerId: userId, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date(),
        delivery: delivery as object ?? undefined, cancelled: extra.cancelled ?? false, ...(extra.cancelled ? { cancelledAt: new Date() } : {}) } });
      await prisma.orderItem.create({ data: { orderId: id, variantId, productName: "Camisa", variantAttributes: { Talla: "M" }, sku: null, quantity: 1n, unitPrice: 10, subtotal: 10 } });
    });
    return { id, number: Number(next - 1n) };
  }
  return { companyId, cookie, order };
}

function pdfPages(base64: string) {
  const pdf = Buffer.from(base64, "base64").toString("latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  return [...pdf.matchAll(/\/Type \/Page\b(?!s)[^>]*?\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/gs)].map((match) => [Number(match[1]), Number(match[2])]);
}

afterAll(async () => {
  for (const { companyId, userId } of fixtures.reverse()) await withTenantIsolation(companyId, async () => {
    await prisma.companyDispatchSender.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await deleteSeededProducts();
    await systemPrisma.user.delete({ where: { id: userId } });
    await prisma.company.delete({ where: { id: companyId } });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("prints home and agency orders, explains every exclusion and keeps companies apart", async () => {
  expect((await post({ orderIds: [randomUUID()] })).status).toBe(401);
  const mine = await seller();
  const other = await seller();
  const homeOrder = await mine.order(home());
  const agencyOrder = await mine.order(agency());
  const pickup = await mine.order(store());
  const unassigned = await mine.order(null);
  const cancelled = await mine.order(home(), { cancelled: true });
  const foreign = await other.order(home());
  const missing = randomUUID();
  const ids = [agencyOrder.id, pickup.id, foreign.id, homeOrder.id, unassigned.id, cancelled.id, missing];

  const response = await post({ orderIds: ids }, mine.cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body).toMatchObject({
    size: "label_62x100",
    printed: [{ orderId: agencyOrder.id, orderNumber: agencyOrder.number }, { orderId: homeOrder.id, orderNumber: homeOrder.number }],
    excluded: [
      { orderId: pickup.id, exclusion: { code: "METHOD_NOT_APPLICABLE" } },
      { orderId: unassigned.id, exclusion: { code: "DELIVERY_NOT_ASSIGNED" } },
      { orderId: cancelled.id, exclusion: { code: "CANCELLED" } },
    ],
    notFound: [foreign.id, missing],
  });
  const pages = pdfPages(body.pdf);
  expect(pages).toHaveLength(2);
  for (const [width, height] of pages) { expect(width).toBeCloseTo(175.75, 1); expect(height).toBeCloseTo(283.46, 1); }

  const a4 = await (await post({ orderIds: [homeOrder.id, agencyOrder.id], size: "a4" }, mine.cookie)).json();
  expect(a4.size).toBe("a4");
  const a4Pages = pdfPages(a4.pdf);
  expect(a4Pages).toHaveLength(1);
  expect(a4Pages[0][0]).toBeCloseTo(595.28, 1);
  expect(a4Pages[0][1]).toBeCloseTo(841.89, 1);

  const none = await (await post({ orderIds: [pickup.id] }, mine.cookie)).json();
  expect(none).toMatchObject({ pdf: null, printed: [], excluded: [{ orderId: pickup.id }] });

  await withTenantIsolation(mine.companyId, async () => {
    const stored = await prisma.order.findMany({ where: { id: { in: [homeOrder.id, cancelled.id] } }, select: { deliveryStatus: true, cancelled: true, shippedAt: true } });
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.deliveryStatus === "pending" && row.shippedAt === null)).toBe(true);
  });
});

test("the configured sender reaches every label and the PDF grows with the label count", async () => {
  const mine = await seller();
  const saved = await fetch(`${base}/api/company/dispatch-sender`, { method: "PUT", headers: { origin, "content-type": "application/json", cookie: mine.cookie },
    body: JSON.stringify({ name: "Fantastidog", phone: "977 000 111" }) });
  expect(saved.status).toBe(200);
  const orders: { id: string; number: number }[] = [];
  for (let index = 0; index < 7; index++) orders.push(await mine.order(index % 2 ? agency() : home()));
  const result = await (await post({ orderIds: orders.map((item) => item.id), size: "a4" }, mine.cookie)).json();
  expect(result.printed).toHaveLength(7);
  expect(pdfPages(result.pdf)).toHaveLength(2);

  // Same composition the endpoint uses, with a spy on what is drawn.
  const drawn: string[][] = [];
  const created = await withTenantIsolation(mine.companyId, () => dispatchLabels.create(mine.companyId, { orderIds: orders.map((item) => item.id), size: "label_62x100" }, (size) => {
    const pdf = createLabelPdf(size);
    return { ...pdf, render: (layouts) => { drawn.push(...layouts.map((layout) => layout.lines.map((line) => line.text))); return pdf.render(layouts); } };
  }));
  expect(created.success).toBe(true);
  expect(drawn).toHaveLength(7);
  // On the 62 mm roll the name and phone do not fit together, so they break at the separator.
  for (const lines of drawn) expect(lines.slice(0, 3)).toEqual(["REMITENTE", "Fantastidog", "Cel. 977 000 111"]);
});

test("rejects invalid requests: more than 100 ids, none, duplicates, bad ids, unknown size and non-JSON", async () => {
  const mine = await seller();
  const ids = Array.from({ length: 101 }, () => randomUUID());
  expect((await post({ orderIds: ids }, mine.cookie)).status).toBe(400);
  expect((await post({ orderIds: ids.slice(0, 100) }, mine.cookie)).status).toBe(200);
  expect((await post({ orderIds: [] }, mine.cookie)).status).toBe(400);
  expect((await post({ orderIds: [ids[0], ids[0]] }, mine.cookie)).status).toBe(400);
  expect((await post({ orderIds: ["nope"] }, mine.cookie)).status).toBe(400);
  expect((await post({ orderIds: [ids[0]], size: "a3" }, mine.cookie)).status).toBe(400);
  const text = await fetch(`${base}/api/dispatch-labels`, { method: "POST", headers: { origin, "content-type": "text/plain", cookie: mine.cookie }, body: "x" });
  expect(text.status).toBe(415);
});
