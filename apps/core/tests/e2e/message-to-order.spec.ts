import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll } from "vitest";
import { listOrderAggregatesResponseSchema } from "@shared/contracts/orders";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { startMobileWeb } from "@core/tests/e2e/mobile-web";
import type { Page } from "@playwright/test";

// The images module reads R2_* when it is first imported, so the env is set before the dynamic import in beforeAll.
const e2ePort = Number(process.env.CORE_E2E_PORT ?? "4173");
const storagePort = e2ePort + 1000;
process.env.R2_ENDPOINT ??= `http://127.0.0.1:${storagePort}`;
process.env.R2_BUCKET ??= "test-images";
process.env.R2_ACCESS_KEY_ID ??= "test";
process.env.R2_SECRET_ACCESS_KEY ??= "test";
process.env.R2_PUBLIC_BASE_URL ??= `http://127.0.0.1:${e2ePort}/test-images`;

const fixtures = new URL("../../src/features/products/infrastructure/qr-fixtures/", import.meta.url);
const label = (name: string) => readFileSync(new URL(name, fixtures));
// UUIDs encoded by label.jpg and label-second.jpg (see generate-fixtures.mjs).
const firstQr = "3f2b8c1e-5a47-4d0e-9b6a-1c7d2e8f4a90";
const secondQr = "9d4e7a12-6b3c-4f85-a0d1-52e8c9b7f316";

// Minimal path-style S3: PUT stores the object, GET returns it. The SDK sends aws-chunked bodies, which are decoded here.
function decodeAwsChunked(body: Buffer) {
  const parts: Buffer[] = [];
  for (let offset = 0; ;) {
    const headerEnd = body.indexOf("\r\n", offset);
    const size = parseInt(body.subarray(offset, headerEnd).toString().split(";")[0], 16);
    if (!size) return Buffer.concat(parts);
    parts.push(body.subarray(headerEnd + 2, headerEnd + 2 + size));
    offset = headerEnd + 2 + size + 2;
  }
}
const objects = new Map<string, { bytes: Buffer; contentType: string }>();
let storage: Server;

const accounts: Array<{ email: string; companyId?: string }> = [];
let runtime: ReturnType<typeof import("@core/src/composition/event-bus")["createEventBusRuntime"]>;
const globalEvents = globalThis as typeof globalThis & { __yoyosEvents?: typeof runtime };

beforeAll(async () => {
  storage = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const key = request.url!.split("?")[0];
      if (request.method === "PUT") {
        const body = Buffer.concat(chunks);
        const chunked = String(request.headers["x-amz-content-sha256"]).startsWith("STREAMING-");
        objects.set(key, { bytes: chunked ? decodeAwsChunked(body) : body, contentType: String(request.headers["content-type"]) });
        return response.writeHead(200).end();
      }
      const object = objects.get(key);
      if (!object) return response.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code></Error>");
      response.writeHead(200, { "content-type": object.contentType }).end(object.bytes);
    });
  });
  await new Promise<void>(resolve => storage.listen(storagePort, "127.0.0.1", resolve));
  // Consume message_created in this process with the real bus, handler and QR reader; the server only publishes.
  const { createEventBusRuntime } = await import("@core/src/composition/event-bus");
  runtime = createEventBusRuntime(true);
  globalEvents.__yoyosEvents = runtime;
  await runtime.provider.start();
  const { bootstrapEventHandlers, eventHandlers } = await import("@core/src/composition/event-handlers");
  const subscribed = await bootstrapEventHandlers(runtime.provider, eventHandlers)();
  if (!subscribed.success) throw new Error(subscribed.error.message);
});
afterAll(async () => {
  await runtime?.provider.stop();
  delete globalEvents.__yoyosEvents;
  await new Promise<void>(resolve => storage?.close(() => resolve()));
  await systemPrisma.$disconnect();
});
// Variant QR codes are unique across companies and every test reuses the same labels, so each test cleans up after itself.
afterEach(async () => {
  for (const { email, companyId } of accounts.splice(0)) {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.orderMessage.deleteMany({ where: { companyId } });
      await prisma.orderItem.deleteMany({ where: { companyId } });
      await prisma.order.deleteMany({ where: { companyId } });
      await prisma.chatMessageOutcome.deleteMany({ where: { companyId } });
      await prisma.chatMessage.deleteMany({ where: { companyId } });
      await prisma.chat.deleteMany({ where: { companyId } });
      await prisma.orderBuyer.deleteMany({ where: { companyId } });
      await prisma.contact.deleteMany({ where: { companyId } });
      await prisma.customer.deleteMany({ where: { companyId } });
      await prisma.productStock.deleteMany({ where: { companyId } });
      await prisma.productVariant.deleteMany({ where: { companyId } });
      await prisma.product.deleteMany({ where: { companyId } });
      await prisma.image.deleteMany({ where: { companyId } });
    });
    await systemPrisma.user.deleteMany({ where: { email } });
    if (companyId) await withTenantIsolation(companyId, async () => await prisma.company.delete({ where: { id: companyId } }));
  }
});

async function sellerWithVariants(page: Page) {
  const email = `message-order-${crypto.randomUUID()}@example.test`;
  const account: { email: string; companyId?: string } = { email };
  accounts.push(account);
  const companyId = account.companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Message orders", country: "PE" });
  const { products } = await import("@core/src/features/products/composition");
  await withTenantIsolation(companyId, async () => {
    for (const [name, salePrice, qrCode] of [["Camisa lino", 10, firstQr], ["Pantalon lino", 25, secondQr]] as const) {
      const product = await products.create({ name, currency: "PEN", variants: [{ attributes: {}, salePrice, initialStock: 10 }] });
      if (!product.success) throw new Error("Product setup failed");
      await prisma.productVariant.updateMany({ where: { productId: product.data }, data: { qrCode } });
    }
  });
  return companyId;
}

// The mobile app uploads the photo first, then registers the message with its imageId.
async function receivePhoto(page: Page, photo: string) {
  const upload = await page.request.post("/api/images", { multipart: { file: { name: photo, mimeType: "image/jpeg", buffer: label(photo) } } });
  expect(upload.status()).toBe(201);
  const { id: imageId } = await upload.json();
  const whatsappMessageId = crypto.randomUUID();
  const chatId = "2@lid";
  const nativeId = `wa-message:v1:${Buffer.from(JSON.stringify(["1@lid", chatId, whatsappMessageId])).toString("base64url")}`;
  const stored = await page.request.post("/api/messages", { data: { version: 1, message: { id: nativeId, accountId: "1@lid", chatId, whatsappMessageId,
    direction: "incoming", timestamp: Date.now(), content: { type: "image", imageId } } } });
  expect(stored.status()).toBe(201);
}
async function mobileHistory(page: Page) {
  const response = await page.request.get("/api/orders/mixed?page=1&customer=all");
  expect(response.status()).toBe(200);
  return listOrderAggregatesResponseSchema.parse(await response.json()).items;
}

test("an incoming label photo from mobile creates a WhatsApp order with the variant, visible in the order list and detail", async ({ page }) => {
  await sellerWithVariants(page);
  await receivePhoto(page, "label.jpg");
  await expect.poll(async () => (await mobileHistory(page)).length, { timeout: 30000 }).toBe(1);

  await page.goto("/es-PE/orders");
  const row = page.getByRole("table", { name: "Órdenes" }).locator("tbody tr");
  await browserExpect(row).toHaveCount(1);
  await browserExpect(row.getByRole("img", { name: "WhatsApp" })).toBeVisible();
  await row.getByRole("link").first().click();
  await browserExpect(page.getByRole("img", { name: "WhatsApp" })).toBeVisible();
  await browserExpect(page.getByText("Camisa lino")).toBeVisible();
  await browserExpect(page.getByText(/S\/\s*10\.00/).first()).toBeVisible();
}, 90000);

test("a second label photo in the same chat adds its variant to the same order and updates the total", async ({ page }) => {
  await sellerWithVariants(page);
  await receivePhoto(page, "label.jpg");
  await expect.poll(async () => (await mobileHistory(page)).length, { timeout: 30000 }).toBe(1);
  await receivePhoto(page, "label-second.jpg");
  await expect.poll(async () => (await mobileHistory(page))[0]?.total.amount, { timeout: 30000 }).toBe(35);

  const orders = await mobileHistory(page);
  expect(orders).toHaveLength(1);
  expect(orders[0].total.amount).toBe(35);
  await page.goto(`/es-PE/orders/${orders[0].id}`);
  await browserExpect(page.getByText("Camisa lino")).toBeVisible();
  await browserExpect(page.getByText("Pantalon lino")).toBeVisible();
  await browserExpect(page.getByText(/S\/\s*35\.00/).first()).toBeVisible();
}, 90000);

test("mobile order history shows the WhatsApp order with its icon", async ({ page }) => {
  const mobile = await startMobileWeb();
  try {
    await sellerWithVariants(page);
    await receivePhoto(page, "label.jpg");
    await expect.poll(async () => (await mobileHistory(page)).length, { timeout: 30000 }).toBe(1);
    expect((await mobileHistory(page))[0]).toMatchObject({ source: "whatsapp", total: { amount: 10, currency: "PEN" } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${mobile.origin}/orders`, { timeout: 90000 });
    await browserExpect(page.getByText(/S\/\s*10/).first()).toBeVisible({ timeout: 90000 });
    // Expo Web renders SymbolView as an empty box, so the accessible icon is attached but has no visible size.
    await browserExpect(page.getByRole("img", { name: "WhatsApp" })).toHaveCount(1);
  } finally { await mobile.close(); }
}, 180000);
