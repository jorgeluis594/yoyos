import { browserExpect, expect, prepareVerifiedCompany, subdomainOf, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { addToOrder } from "@core/tests/e2e/order-view-helpers";

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
      await seedProduct({ name: "Corona de Príncipe", variants: [{ attributes: {}, salePrice: 25, stock: 12 }] });
    });
    page.on("dialog", (dialog) => void dialog.accept());

    await page.goto("/es-PE/orders/new");
    await browserExpect(page.getByRole("heading", { name: "Nueva venta" })).toBeVisible();
    await browserExpect(page.getByText("Sin guardar", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Disponible al guardar")).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Descartar", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Guardar venta" })).toBeDisabled();
    await browserExpect(page.getByText("Entrega por definir. Puedes guardar sin entrega y elegirla después.")).toBeVisible();

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
    await page.getByRole("group", { name: "Corona de Príncipe" }).getByRole("option", { name: "Agregar", exact: true }).click();
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
