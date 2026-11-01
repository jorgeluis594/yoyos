import { randomUUID } from "node:crypto";
import { browserExpect, expect, prepareVerifiedCompany, publishCatalog, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);

test("a seller copies the link of a WhatsApp order through the review, corrects a doubtful item and undoes a message", async ({ page }) => {
  const email = `order-review-${randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Vendedor Demo", companyName: "Pedidos por mensaje", country: "PE" });
    const tenantId = companyId;
    await publishCatalog(tenantId);
    const [polera, gorra] = await withTenantIsolation(tenantId, async () => {
      const shirts = await seedProduct({ name: "Polera gris", variants: [{ attributes: { Talla: "M" }, salePrice: 59, stock: 20 }] });
      const caps = await seedProduct({ name: "Gorra trucker", variants: [{ attributes: { Color: "Negro" }, salePrice: 40, stock: 20 }] });
      return [shirts.variantIds[0]!, caps.variantIds[0]!];
    });
    const orderId = randomUUID();
    const created = await page.request.post("/api/orders", { data: { id: orderId, items: [{ variantId: polera, quantity: 2 }, { variantId: gorra, quantity: 1 }] } });
    expect(created.status()).toBe(201);
    const number = (await created.json()).number as number;

    // The reader is not under test here: the order is the one a chat made, with the rows the reader would have written.
    const [first, second] = [randomUUID(), randomUUID()];
    const sellerId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
    await withTenantIsolation(tenantId, async () => {
      const contactId = randomUUID();
      const chatId = randomUUID();
      await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "111@lid", whatsappLid: "222@lid" } });
      await prisma.chat.create({ data: { id: chatId, contactId } });
      for (const [id, text, minutes] of [[first, "mejor dos poleras", 30], [second, "y una gorra", 20]] as const) {
        await prisma.chatMessage.create({ data: { id, chatId, externalId: `ext-${id}`, whatsappMessageId: `wa-${id}`, direction: "incoming", source: "contact", type: "text", text,
          uploadedByUserId: sellerId, sentAt: at(minutes), receivedAt: at(minutes) } });
      }
      await prisma.order.update({ where: { id: orderId }, data: { chatId } });
      const items = await prisma.orderItem.findMany({ where: { orderId } });
      const line = (variantId: string, quantity: number) => {
        const item = items.find((candidate) => candidate.variantId === variantId)!;
        return { itemId: item.id, variantId, productName: item.productName, variantAttributes: item.variantAttributes, sku: item.sku, quantity,
          unitPrice: { amount: Number(item.unitPrice), currency: "PEN" }, mentionedPrice: null, position: 0 };
      };
      await prisma.orderMessage.createMany({ data: [{ orderId, messageId: first, createdAt: at(30) }, { orderId, messageId: second, createdAt: at(20) }] });
      await prisma.orderItemChange.create({ data: { orderId, messageId: first, position: 0, seq: 1, kind: "quantity_changed", itemId: items.find((item) => item.variantId === polera)!.id,
        before: line(polera, 1), after: line(polera, 2), decision: "doubtful", doubt: { kind: "quantity_set", quantity: 2 }, createdAt: at(30) } });
      await prisma.orderItemChange.create({ data: { orderId, messageId: second, position: 0, seq: 2, kind: "added", itemId: items.find((item) => item.variantId === gorra)!.id,
        after: line(gorra, 1), decision: "applied", createdAt: at(20) } });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/es-PE/orders/${orderId}`);
    const linkCard = page.getByRole("region", { name: "Enlace del pedido" });
    await browserExpect(linkCard).toContainText("Revisa el pedido antes de enviar el enlace.");
    await browserExpect(linkCard).toContainText("1 cambio con duda");
    await browserExpect(page.getByRole("textbox", { name: "Enlace del pedido" })).toHaveCount(0);
    await browserExpect(page.getByRole("region", { name: "Cambios por mensajes" })).toContainText("Agregó Gorra trucker");

    await linkCard.getByRole("button", { name: "Copiar enlace" }).click();
    const dialog = page.getByRole("dialog", { name: `Revisa el pedido #${number}` });
    await browserExpect(dialog).toBeVisible();
    await browserExpect(dialog.getByRole("heading", { name: `Revisa el pedido #${number}` })).toBeFocused();
    await browserExpect(dialog.getByRole("heading", { name: "Cambios con duda" })).toBeVisible();
    await browserExpect(dialog).toContainText("Un mensaje cambió la cantidad a 2");
    await page.screenshot({ path: "test-results/order-review-dialog-desktop.png", animations: "disabled" });

    // A seller corrects the doubtful item and confirms: the corrections are saved together with the review.
    await dialog.getByRole("textbox", { name: "Cantidad de Polera gris M" }).fill("1");
    await dialog.getByRole("button", { name: "Confirmar revisión" }).click();
    await browserExpect(dialog).toHaveCount(0);
    await browserExpect(page.getByRole("textbox", { name: "Enlace del pedido" })).toHaveValue(new RegExp(`/checkout/${orderId}$`));
    await browserExpect(page.getByRole("button", { name: "Copiar enlace" })).toBeFocused();
    await browserExpect(page.getByRole("textbox", { name: /^Cantidad: Polera gris/ })).toHaveValue("1");

    // The message that added the cap is undone from its row, after its confirmation.
    await page.getByRole("button", { name: /^Deshacer mensaje de las .*Agregó Gorra trucker/ }).click();
    const confirmation = page.getByRole("dialog", { name: "¿Deshacer lo que hizo este mensaje?" });
    await browserExpect(confirmation).toContainText("Quitar Gorra trucker");
    await confirmation.getByRole("button", { name: "Deshacer cambios" }).click();
    await browserExpect(page.getByText("Cambios deshechos.")).toBeVisible();
    await browserExpect(page.getByRole("textbox", { name: /^Cantidad: Gorra trucker/ })).toHaveCount(0);
    await browserExpect(page.getByRole("region", { name: "Cambios por mensajes" })).toContainText("Deshecho");
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      for (const table of ["orderItemChange", "orderReview", "orderLinkAction", "orderMessage", "payment", "orderItem", "order", "chatMessage", "chat", "contact", "productStock", "productVariant", "productOption", "product"])
        await (prisma[table as "product"] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
