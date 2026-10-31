import { browserExpect, expect, prepareVerifiedCompany, subdomainOf, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { addToOrder, orderTotal } from "@core/tests/e2e/order-view-helpers";

test("creates a sale with the picker, a Yape advance and a customer, then opens the saved order with its link", async ({ page }) => {
  const email = `order-view-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Vendedor Vista", companyName: "Vista única", country: "PE" });
    const tenantId = companyId;
    await withTenantIsolation(tenantId, async () => {
      await prisma.company.update({ where: { id: tenantId }, data: { catalogSubdomain: subdomainOf(tenantId) } });
      await seedProduct({ name: "Traje de Príncipe Azul", variants: [
        { attributes: { Talla: "S" }, salePrice: 89, stock: 3 }, { attributes: { Talla: "M" }, salePrice: 89, stock: 5 }, { attributes: { Talla: "L" }, salePrice: 99, stock: 0 },
      ] });
      await seedProduct({ name: "Varita de Príncipe", variants: [{ attributes: {}, salePrice: 25, stock: 12 }] });
    });
    page.on("dialog", (dialog) => void dialog.accept());

    await page.goto("/es-PE/orders");
    await page.getByRole("link", { name: "Nueva venta" }).click();
    await browserExpect(page.getByRole("heading", { name: "Nueva venta" })).toBeVisible();
    await browserExpect(page.getByText("Sin guardar", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Disponible al guardar")).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Descartar", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Guardar venta" })).toBeDisabled();
    // No delivery method is enabled for this company: the card says so and guides to its settings.
    await browserExpect(page.getByRole("link", { name: "Configurar modalidades de entrega" })).toBeVisible();

    // «/» opens the picker with the search focused; ← and → edit the text, ↓ and → choose the chip, Enter adds it twice.
    await page.locator("body").press("/");
    const search = page.getByRole("combobox", { name: "Buscar producto" });
    await browserExpect(search).toBeFocused();
    await search.fill("príncipe");
    await browserExpect(page.getByRole("option", { name: "M, 5 en stock" })).toBeVisible();
    await browserExpect(page.getByRole("option", { name: "L, Sin stock" })).toBeVisible();
    await search.press("ArrowLeft");
    await search.press("ArrowDown");
    await search.press("ArrowRight");
    await search.press("ArrowRight");
    await search.press("Enter");
    await search.press("Enter");
    await browserExpect(page.getByRole("option", { name: "M, 5 en stock, 2 en el pedido" })).toBeVisible();
    await browserExpect(page.getByText("Agregado: Traje de Príncipe Azul, M. 2 en el pedido.")).toBeAttached();
    await page.getByRole("group", { name: "Varita de Príncipe" }).getByRole("option", { name: "Agregar", exact: true }).click();
    await page.getByRole("button", { name: "Listo · 2 agregados" }).click();
    await browserExpect(page.getByRole("button", { name: "Agregar producto" })).toBeFocused();
    await browserExpect(page.getByText("2 productos · 3 unidades")).toBeVisible();
    await browserExpect(page.getByLabel("Cantidad: Traje de Príncipe Azul, M")).toHaveValue("2");

    // «/» does nothing while a payment field has focus.
    await page.getByRole("button", { name: "Agregar Yape" }).click();
    const amount = page.getByLabel("Importe recibido");
    await browserExpect(amount).toHaveValue("203.00");
    await amount.fill("150");
    await amount.press("/");
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByLabel("Nombre", { exact: true }).first().fill("Jorge Gonzalez");
    await page.getByRole("textbox", { name: "Celular" }).first().fill("977909427");
    await page.getByRole("button", { name: "Guardar venta" }).click();

    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    const id = page.url().split("/").at(-1)!;
    // The saved view announces the sale and puts focus on its heading.
    await browserExpect(page.getByText("Venta guardada.")).toBeVisible();
    await browserExpect(page.getByRole("heading", { name: /^Pedido #\d+$/ })).toBeFocused();
    await browserExpect(page.getByRole("textbox", { name: "Enlace del pedido", exact: true })).toHaveValue(new RegExp(`/checkout/${id}$`));
    const saved = await (await page.request.get(`/api/orders/${id}/aggregate`)).json();
    expect(saved).toMatchObject({ total: { amount: 203 }, paidAmount: { amount: 150 }, balanceDue: { amount: 53 }, deliveryStatus: "pending", delivery: null,
      buyer: { name: "Jorge Gonzalez", phone: "+51977909427" } });
    expect(saved.items).toHaveLength(2);
    // Back opens Ventas, never an empty «Nueva venta».
    await page.goBack();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders$/);
  } finally {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.orderBuyer.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
    });
    await systemPrisma.user.deleteMany({ where: { email } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
  }
});

test("refuses a half-typed sale with its fields marked, asks before leaving and empties the view on Descartar venta", async ({ page }) => {
  const email = `order-view-guard-${crypto.randomUUID()}@example.test`;
  try {
    const tenantId = await prepareVerifiedCompany(page, { email, name: "Vendedor Guarda", companyName: "Vista guarda", country: "PE" });
    await withTenantIsolation(tenantId, () => seedProduct({ name: "Agenda", variants: [{ attributes: {}, salePrice: 10, stock: 5 }] }));
    await page.goto("/es-PE/orders/new");
    await addToOrder(page, "Agenda");
    await page.getByLabel("Nombre", { exact: true }).first().fill("Ana");
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await browserExpect(page.getByText("No se guardó: revisa 1 campo marcado.")).toBeVisible();
    await browserExpect(page.getByText("Completa nombre y celular, o deja ambos vacíos.")).toBeVisible();
    await browserExpect(page.getByRole("textbox", { name: "Celular" }).first()).toBeFocused();
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(0);

    await page.getByRole("link", { name: "Ver ventas" }).click();
    await browserExpect(page.getByText("¿Descartar los cambios?")).toBeVisible();
    await page.getByRole("button", { name: "Seguir editando" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/new$/);
    await browserExpect(page.getByText("Agenda").first()).toBeVisible();

    await page.getByRole("button", { name: "Descartar", exact: true }).click();
    await browserExpect(page.getByText("¿Descartar esta venta?")).toBeVisible();
    await page.getByRole("button", { name: "Descartar venta" }).click();
    await browserExpect(page.getByText("Aún no hay productos")).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Descartar", exact: true })).toBeDisabled();
  } finally {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
    });
    await systemPrisma.user.deleteMany({ where: { email } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
  }
});

async function cleanup(email: string) {
  const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
  if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
    await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.orderBuyer.deleteMany(); await prisma.order.deleteMany();
    await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
  });
  await systemPrisma.user.deleteMany({ where: { email } });
  if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
}

/** Order #1042 of the product draft: two «Traje» lines and a «Deadpool» line, S/ 298.00, with a S/ 150.00 payment. */
async function seedOrder1042(page: import("@playwright/test").Page, tenantId: string) {
  const [traje, deadpool] = await withTenantIsolation(tenantId, async () => [
    await seedProduct({ name: "Traje de Príncipe Azul", variants: [{ attributes: { Talla: "M" }, salePrice: 89, stock: 5 }, { attributes: { Talla: "L" }, salePrice: 89, stock: 5 }] }),
    await seedProduct({ name: "Disfraz de Deadpool", variants: [{ attributes: { Talla: "M" }, salePrice: 120, stock: 4 }] }),
  ] as const);
  const orderId = crypto.randomUUID();
  const lines = [...traje.variantIds, ...deadpool.variantIds].map((variantId) => ({ variantId, quantity: 1 }));
  expect((await page.request.post("/api/orders/pending", { data: { id: orderId, items: lines } })).status()).toBe(201);
  const paymentId = crypto.randomUUID();
  expect((await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId, amount: { amount: 150, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } })).ok()).toBe(true);
  return { orderId, paymentId };
}

test("raises a quantity on a saved order, saves, and shows the new balance with the payment unchanged", async ({ page }) => {
  const email = `order-view-edit-${crypto.randomUUID()}@example.test`;
  try {
    const tenantId = await prepareVerifiedCompany(page, { email, name: "Vendedor Edita", companyName: "Vista edita", country: "PE" });
    const { orderId, paymentId } = await seedOrder1042(page, tenantId);
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("heading", { name: /^Pedido #\d+$/ })).toBeVisible();
    await browserExpect(page.getByText("Detalles internos")).toHaveCount(0);
    await browserExpect(page.getByText("Pago parcial · falta S/ 148.00")).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Descartar cambios" }).first()).toBeDisabled();

    const quantity = page.getByLabel("Cantidad: Disfraz de Deadpool, M");
    await quantity.fill("2");
    await browserExpect(page.getByText("Tienes cambios sin guardar.")).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Agregar Yape" })).toHaveAttribute("aria-disabled", "true");
    await browserExpect(page.getByText("Guarda o descarta los cambios primero.").first()).toBeVisible();
    // Lowering the quantity back to the saved value leaves nothing to save.
    await quantity.fill("1");
    await browserExpect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    await quantity.fill("2");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await browserExpect(page.getByText("Cambios guardados.")).toBeVisible();
    await browserExpect(page.getByRole("heading", { name: /^Pedido #\d+$/ })).toBeFocused();
    await browserExpect(page.getByText("Pago parcial · falta S/ 268.00")).toBeVisible();
    await browserExpect(orderTotal(page)).toHaveText("S/ 418.00");
    await browserExpect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    const saved = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(saved).toMatchObject({ total: { amount: 418 }, balanceDue: { amount: 268 }, paidAmount: { amount: 150 }, stockDeducted: false });
    expect(saved.payments).toHaveLength(1);
    expect(saved.payments[0]).toMatchObject({ id: paymentId, status: "confirmed" });
  } finally { await cleanup(email); }
});

test("edits a deducted order with short stock, saves it and shows the pending notice", async ({ page }) => {
  const email = `order-view-deducted-${crypto.randomUUID()}@example.test`;
  try {
    const tenantId = await prepareVerifiedCompany(page, { email, name: "Vendedor Descontado", companyName: "Vista descontada", country: "PE" });
    const deadpool = await withTenantIsolation(tenantId, () => seedProduct({ name: "Disfraz de Deadpool", variants: [{ attributes: { Talla: "M" }, salePrice: 120, stock: 4 }] }));
    const orderId = crypto.randomUUID();
    expect((await page.request.post("/api/orders/pending", { data: { id: orderId, items: [{ variantId: deadpool.variantIds[0], quantity: 1 }] } })).status()).toBe(201);
    expect((await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId: crypto.randomUUID(), amount: { amount: 120, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } })).ok()).toBe(true);
    expect(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).toMatchObject({ stockDeducted: true });

    await page.goto(`/es-PE/orders/${orderId}`);
    const quantity = page.getByLabel("Cantidad: Disfraz de Deadpool, M");
    await browserExpect(quantity).toBeEnabled();
    await quantity.fill("6");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await browserExpect(page.getByText("Cambios guardados.")).toBeVisible();
    await browserExpect(page.getByText(/no hay stock suficiente de .*Deadpool.*Se descontará cuando haya\./)).toBeVisible();
    const saved = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(saved).toMatchObject({ stockDeducted: true, total: { amount: 720 }, paidAmount: { amount: 120 }, stockDue: { kind: "partial_waiting" } });
    expect(saved.payments).toHaveLength(1);
  } finally { await cleanup(email); }
});

test("asks before leaving a saved order with unsaved changes", async ({ page }) => {
  const email = `order-view-leave-${crypto.randomUUID()}@example.test`;
  try {
    const tenantId = await prepareVerifiedCompany(page, { email, name: "Vendedor Sale", companyName: "Vista sale", country: "PE" });
    const { orderId } = await seedOrder1042(page, tenantId);
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.getByLabel("Cantidad: Disfraz de Deadpool, M").fill("3");
    await page.getByRole("link", { name: "Ver ventas" }).click();
    await browserExpect(page.getByText("¿Descartar los cambios?")).toBeVisible();
    await page.getByRole("button", { name: "Seguir editando" }).click();
    await browserExpect(page).toHaveURL(new RegExp(`/es-PE/orders/${orderId}$`));
    await browserExpect(page.getByLabel("Cantidad: Disfraz de Deadpool, M")).toHaveValue("3");
    // The guard dialog also has a «Descartar cambios»: wait until it is gone before reaching for the one of the page.
    await browserExpect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Descartar cambios" }).first().click();
    await browserExpect(page.getByText("¿Descartar los cambios?")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Descartar cambios" }).click();
    await browserExpect(page.getByLabel("Cantidad: Disfraz de Deadpool, M")).toHaveValue("1");

    await page.getByLabel("Cantidad: Disfraz de Deadpool, M").fill("3");
    await page.getByRole("link", { name: "Ver ventas" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Descartar cambios" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders$/);
    expect((await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).total).toMatchObject({ amount: 298 });
  } finally { await cleanup(email); }
});
