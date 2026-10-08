import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { vi } from "vitest";
import { expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createEventBusRuntime } from "@core/src/composition/event-bus";
import { bootstrapEventHandlers, eventHandlers } from "@core/src/composition/event-handlers";

const exec = promisify(execFile);
const adb = async (...args: string[]) => (await exec("adb", args, { maxBuffer: 4_000_000 })).stdout;
type NativeNode = Record<string, string>;
async function nodes(): Promise<NativeNode[]> {
  await adb("shell", "uiautomator", "dump", "/sdcard/yoyos-cancellation.xml");
  const xml = await adb("shell", "cat", "/sdcard/yoyos-cancellation.xml");
  const parsed = [...xml.matchAll(/<node\b[^>]*>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">")] )));
  if (parsed.some(node => node.text.includes("sign-in info to Samsung Pass"))) {
    const cancel = parsed.find(node => node.text === "Cancelar" || node.text === "Cancel");
    if (cancel) await tap(cancel);
  }
  if (parsed.some(node => node.package === "com.sec.android.app.launcher")) {
    // A locale change can return to the launcher after the first app start.
    await adb("reverse", "tcp:8084", "tcp:8084");
    await adb("reverse", "tcp:4182", "tcp:4182");
    await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "exp://127.0.0.1:8084", "-p", "host.exp.exponent");
  }
  return parsed;
}
const named = (node: NativeNode, label: string) => [node.text, node["content-desc"]].some(value =>
  value.toLocaleLowerCase() === label.toLocaleLowerCase() || value.toLocaleLowerCase().startsWith(`${label.toLocaleLowerCase()},`));
async function visible(label: string | RegExp) {
  let found: NativeNode | undefined;
  await vi.waitFor(async () => { const snapshot = await nodes(); found = snapshot.find(node => typeof label === "string" ? named(node, label) : label.test(node.text) || label.test(node["content-desc"])); expect(found, `${String(label)}; visible: ${snapshot.map(node => node.text || node["content-desc"]).filter(Boolean).join(" | ")}`).toBeDefined(); }, { timeout: 30000, interval: 200 });
  return found!;
}
async function tap(node: NativeNode) {
  const values = node.bounds.match(/\d+/g)?.map(Number);
  if (!values || values.length !== 4) throw new Error("Missing Android bounds");
  await adb("shell", "input", "tap", String(Math.round((values[0] + values[2]) / 2)), String(Math.round((values[1] + values[3]) / 2)));
}
const press = async (label: string) => tap(await visible(label));
async function openOrder(id: string) {
  await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", `exp://127.0.0.1:8084/--/orders/${id}`, "-p", "host.exp.exponent");
}
async function screenshot(name: string) {
  const { stdout } = await exec("adb", ["exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 8_000_000 });
  await writeFile(`test-results/${name}.png`, stdout);
}

// Requires an unlocked Android device and Expo Go SDK 57, with Metro on 8084
// bundled with EXPO_PUBLIC_CORE_URL=http://127.0.0.1:4182. Expo Web is not used.
test.runIf(process.env.NATIVE_ANDROID_TEST === "1")("Android cancels real orders, preserves payments and recovers uncertain results", async ({ page }) => {
  const base = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;
  const email = `native-cancel-${crypto.randomUUID()}@example.test`;
  const companyId = await prepareVerifiedCompany(page, { email, name: "Native seller", companyName: "Native cancellation", country: "PE" });
  const variantId = await withTenantIsolation(companyId, async () => {
    const created = await products.create({ name: "Native cancellation product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 20 }] });
    if (!created.success) throw new Error("Product setup failed");
    return (await prisma.productVariant.findFirstOrThrow({ where: { productId: created.data } })).id;
  });
  let lostId = "";
  let blockRead = false;
  let delayedId = "";
  let releaseDelay: (() => void) | undefined;
  let delayedResponse = Promise.resolve();
  const previousLocale = (await adb("shell", "cmd", "locale", "get-device-locale")).trim();
  const previousStayAwake = (await adb("shell", "settings", "get", "global", "stay_on_while_plugged_in")).trim();
  const writes = new Map<string, number>();
  const proxy = createServer(async (request, response) => {
    try {
      const path = request.url ?? "/";
      const id = path.match(/^\/api\/orders\/([^/]+)\/cancel$/)?.[1];
      if (id) writes.set(id, (writes.get(id) ?? 0) + 1);
      if (blockRead && (writes.get(lostId) ?? 0) > 0 && path === `/api/orders/${lostId}/aggregate`) { response.destroy(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) if (value && !["host", "connection", "content-length"].includes(key)) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const upstream = await fetch(`${base}${path}`, { method: request.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const body = Buffer.from(await upstream.arrayBuffer());
      if (id === delayedId) await delayedResponse;
      if (id === lostId) { expect(upstream.status).toBe(200); expect(JSON.parse(body.toString()).cancelled).toBe(true); response.writeHead(200, { "content-type": "application/json", "content-length": String(body.length) }); response.write(body.subarray(0, 1)); response.end(); return; }
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers)); response.end(body);
    } catch { response.destroy(); }
  });
  await new Promise<void>(resolve => proxy.listen(4182, "127.0.0.1", resolve));
  const { provider } = createEventBusRuntime(true);
  const stock = () => withTenantIsolation(companyId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity);
  const detail = async (id: string) => (await page.request.get(`/api/orders/${id}/aggregate`)).json();
  const create = async (paid: number) => {
    const id = crypto.randomUUID();
    expect((await page.request.post("/api/orders/pending", { data: { id, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    if (paid) expect((await page.request.post(`/api/orders/${id}/payments`, { data: { paymentId: crypto.randomUUID(), amount: { amount: paid, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: true } })).ok()).toBe(true);
    return id;
  };
  try {
    await adb("shell", "svc", "power", "stayon", "usb");
    await adb("shell", "input", "keyevent", "224");
    await adb("shell", "wm", "dismiss-keyguard");
    await provider.start(); expect(await bootstrapEventHandlers(provider, eventHandlers)()).toMatchObject({ success: true });
    await adb("reverse", "tcp:8084", "tcp:8084"); await adb("reverse", "tcp:4182", "tcp:4182");
    await adb("shell", "am", "force-stop", "host.exp.exponent");
    const firstId = await create(0);
    await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "exp://127.0.0.1:8084", "-p", "host.exp.exponent");
    await visible("Iniciar sesión");
    const fields = (await nodes()).filter(node => node.class === "android.widget.EditText");
    expect(fields).toHaveLength(2);
    await tap(fields[0]); await adb("shell", "input", "text", email);
    await tap(fields[1]); await adb("shell", "input", "text", "test-password-123"); await adb("shell", "input", "keyevent", "4");
    await press("Iniciar sesión");
    await visible("Pedidos");
    const portuguese = await create(0);
    await adb("shell", "cmd", "locale", "set-device-locale", "pt-BR");
    // Android restarts activities asynchronously after changing its locale.
    await new Promise(resolve => setTimeout(resolve, 3000));
    await adb("reverse", "tcp:8084", "tcp:8084");
    await adb("reverse", "tcp:4182", "tcp:4182");
    await adb("shell", "am", "force-stop", "host.exp.exponent");
    await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "exp://127.0.0.1:8084", "-p", "host.exp.exponent");
    await visible("Pedidos");
    await openOrder(portuguese); await press("Cancelar pedido");
    expect((await nodes()).some(node => node.text.includes("não realiza um reembolso") && node.text.includes("não poderá reabrir"))).toBe(true);
    await screenshot("native-cancellation-confirm-pt");
    await press("Manter pedido"); expect((await detail(portuguese)).cancelled).toBe(false);
    await press("Cancelar pedido"); await press("Cancelar pedido"); await visible("Pedido cancelado");
    expect((await detail(portuguese)).cancelled).toBe(true);
    await adb("shell", "cmd", "locale", "set-device-locale", previousLocale);
    await new Promise(resolve => setTimeout(resolve, 3000));
    await adb("reverse", "tcp:8084", "tcp:8084");
    await adb("reverse", "tcp:4182", "tcp:4182");
    await adb("shell", "am", "force-stop", "host.exp.exponent");
    await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "exp://127.0.0.1:8084", "-p", "host.exp.exponent");
    await visible("Pedidos");
    for (const paid of [0, 4, 10]) {
      const id = paid === 0 ? firstId : await create(paid);
      const before = await detail(id); const beforeStock = await stock();
      await openOrder(id); await press("Cancelar pedido");
      const confirmation = await nodes();
      expect(confirmation.some(node => node.text.includes("no realiza un reembolso") && node.text.includes("No podrás reabrir"))).toBe(true);
      await screenshot(`native-cancellation-confirm-${paid}`);
      await press("Conservar pedido"); expect((await detail(id)).cancelled).toBe(false); expect(writes.get(id) ?? 0).toBe(0);
      await press("Cancelar pedido"); await adb("shell", "input", "keyevent", "4");
      expect((await detail(id)).cancelled).toBe(false); expect(writes.get(id) ?? 0).toBe(0);
      await press("Cancelar pedido"); await press("Cancelar pedido");
      await visible("Orden cancelada");
      expect((await nodes()).some(node => node.text.includes("no se realizó un reembolso"))).toBe(true);
      expect((await nodes()).some(node => named(node, "Entrega pendiente") || named(node, "Cancelar pedido"))).toBe(false);
      expect((await detail(id)).payments).toEqual(before.payments);
      await vi.waitFor(async () => expect(await stock()).toBe(beforeStock + (paid ? 1n : 0n)), { timeout: 15000 });
      expect(writes.get(id)).toBe(1);
      if (paid) {
        await adb("shell", "input", "swipe", "540", "1700", "540", "600", "350");
        await press("Ver pagos"); await visible("Pago confirmado");
        await screenshot(`native-cancellation-payment-${paid}`);
        await press("Ver pagos");
        await adb("shell", "input", "swipe", "540", "600", "540", "1800", "350");
      }
      await openOrder(id); await visible("Orden cancelada");
    }
    await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "exp://127.0.0.1:8084/--/orders", "-p", "host.exp.exponent");
    await visible("Cancelado");
    for (const filter of ["Por cobrar", "Por entregar"]) {
      await press(filter); await visible("Sin resultados");
      expect((await nodes()).some(node => named(node, "Cancelado"))).toBe(false);
    }
    await press("Todos"); await visible("Cancelado");
    await tap(await visible(/#1001 ·/)); await visible("Orden cancelada");

    const delayed = await create(4); delayedId = delayed;
    delayedResponse = new Promise<void>(resolve => { releaseDelay = resolve; });
    await openOrder(delayed); await press("Cancelar pedido"); await press("Cancelar pedido");
    await visible("Cancelando pedido…");
    await screenshot("native-cancellation-busy");
    const busyCancel = await visible("Cancelar pedido"); expect(busyCancel.enabled).toBe("false");
    await tap(busyCancel); await tap(busyCancel);
    expect(writes.get(delayed)).toBe(1); expect((await detail(delayed)).cancelled).toBe(true);
    await adb("shell", "input", "swipe", "540", "1700", "540", "700", "350");
    const payment = await visible("Registrar pago"); expect(payment.enabled).toBe("false"); await tap(payment);
    releaseDelay?.(); delayedId = "";
    await adb("shell", "input", "swipe", "540", "700", "540", "1700", "350");
    await visible("Orden cancelada"); expect(writes.get(delayed)).toBe(1);

    for (const uncertain of [false, true]) {
      const id = await create(4); lostId = id; blockRead = uncertain;
      await openOrder(id); await press("Cancelar pedido"); await press("Cancelar pedido");
      if (uncertain) {
        await visible("No pudimos confirmar si se canceló. Consulta el estado antes de continuar.");
        const uncertainCancel = await visible("Cancelar pedido"); expect(uncertainCancel.enabled).toBe("false");
        await tap(uncertainCancel); expect(writes.get(id)).toBe(1);
        expect((await detail(id)).cancelled).toBe(true);
        blockRead = false; await press("Consultar estado");
      }
      await visible("Orden cancelada"); expect(writes.get(id)).toBe(1);
      lostId = "";
    }
    const conflict = await create(10);
    await openOrder(conflict); await visible("Cancelar pedido");
    expect((await page.request.post(`/api/orders/${conflict}/ship`)).ok()).toBe(true);
    await press("Cancelar pedido"); await press("Cancelar pedido");
    await visible("El pedido ya fue enviado o entregado y no se puede cancelar.");
    await visible("Despachado"); expect((await detail(conflict)).cancelled).toBe(false);
    await screenshot("native-cancellation-conflict");
    const conflictPayments = (await detail(conflict)).payments;
    await adb("shell", "input", "swipe", "540", "1700", "540", "500", "350");
    await press("Marcar entregado");
    await adb("shell", "input", "swipe", "540", "500", "540", "1800", "350");
    await visible("Venta completada");
    expect((await detail(conflict)).payments).toEqual(conflictPayments);
    expect((await nodes()).some(node => named(node, "Cancelar pedido"))).toBe(false);


  } finally {
    await adb("shell", "cmd", "locale", "set-device-locale", previousLocale);
    await adb("shell", "settings", "put", "global", "stay_on_while_plugged_in", previousStayAwake);
    releaseDelay?.(); await provider.stop(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve()));
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try { await pool.query("DELETE FROM pgboss.job WHERE data->'payload'->>'companyId' = $1", [companyId]); } finally { await pool.end(); }
    await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
}, 600000);
