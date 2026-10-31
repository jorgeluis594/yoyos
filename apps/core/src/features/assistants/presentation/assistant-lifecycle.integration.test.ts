import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { limaCalendarDay, nextCalendarDay } from "@shared/orders-date";
import type { CompanyId, UserId } from "@shared/identity";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { deleteSeededProducts, seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { assistantConnections, authorizationFor } from "@core/src/features/assistants/composition";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { SignedAuthorizationRequest } from "@core/src/features/assistants/application/authorize-assistant";
import { toolModules } from "@core/src/composition/assistant-tools";

// The six order and product tools plus whatever the sales module registers; the nine names are pinned by the sales acceptance test.
const expectedToolNames = [...["buscar_pedidos", "buscar_productos", "pedidos_por_cobrar", "pedidos_por_despachar_hoy", "ver_pedido", "ver_producto"],
  ...toolModules.filter((module) => module.scopes.length === 2).flatMap((module) => module.tools.map((tool) => tool.name))].sort();

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const resource = `${baseUrl}/mcp`;
const redirectUri = "https://claude.ai/api/mcp/auth_callback";
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Integration server did not bind");
const api = `http://127.0.0.1:${address.port}`;
const clientIds: string[] = [];
const userIds: string[] = [];
const companyIds: CompanyId[] = [];
const password = "lifecycle-password-123";
const secrets = ["987654789", "Av. Larco 123", "45678912"];

type Owner = Readonly<{ email: string; userId: UserId; companyId: CompanyId; cookie: string }>;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${api}${path}`, { method: "POST", headers: { origin: baseUrl, "content-type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "manual" });
}

async function createOwner(name: string, companyId: CompanyId = randomUUID() as CompanyId): Promise<Owner> {
  const email = `lifecycle-${randomUUID()}@example.test`;
  expect((await post("/api/auth/sign-up/email", { name, email, password })).status).toBe(200);
  const user = await systemPrisma.user.findUniqueOrThrow({ where: { email } });
  userIds.push(user.id);
  if (!companyIds.includes(companyId)) {
    await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: `Tienda ${name}`, country: "PE" } }));
    companyIds.push(companyId);
  }
  await systemPrisma.user.update({ where: { id: user.id }, data: { emailVerified: true, companyId } });
  const response = await post("/api/auth/sign-in/email", { email, password }, { accept: "application/json" });
  expect(response.status).toBe(200);
  return { email, userId: user.id as UserId, companyId, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

async function registerClient() {
  const response = await post("/api/auth/oauth2/register", { client_name: "Claude", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" },
    { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250) + 1}` });
  const body = await response.json();
  clientIds.push(body.client_id);
  return body.client_id as string;
}

/** The real flow: authorize → screen → Permitir acceso → code → token for the MCP resource. */
async function connectAgent(owner: Owner, clientId: string) {
  return (await connectAgentTokens(owner, clientId)).access_token as string;
}

async function authorizeLocation(clientId: string, cookie: string | null) {
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "orders:read products:read offline_access",
    code_challenge: createHash("sha256").update("verifier").digest("base64url"), code_challenge_method: "S256", state: "state-1", resource });
  const authorize = await fetch(`${api}/api/auth/oauth2/authorize?${query}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const location = authorize.headers.get("location") ?? (await authorize.json().catch(() => null))?.url ?? "";
  return new URL(location, baseUrl);
}

async function connectAgentTokens(owner: Owner, clientId: string) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "orders:read products:read offline_access", code_challenge: challenge,
    code_challenge_method: "S256", state: "state-1", resource });
  const authorize = await fetch(`${api}/api/auth/oauth2/authorize?${query}`, { headers: { cookie: owner.cookie }, redirect: "manual" });
  // A navigation answers 302 with a Location; any other fetch gets the same redirect as `{ url }`.
  const location = authorize.headers.get("location") ?? (await authorize.json().catch(() => null))?.url ?? "";
  const screen = new URL(location, baseUrl);
  expect(screen.pathname, location).toBe("/assistants/authorize");
  const allowed = await authorizationFor(new Request(`${baseUrl}/assistants/authorize`, { method: "POST", headers: { cookie: owner.cookie } }))
    .allow(screen.search.slice(1) as SignedAuthorizationRequest, { companyId: owner.companyId, userId: owner.userId });
  if (!allowed.success) throw new Error(`Allow failed: ${allowed.error.code}`);
  const exchanged = await fetch(`${api}/api/auth/oauth2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: new URL(allowed.data).searchParams.get("code") ?? "", redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource }),
  });
  expect(exchanged.status).toBe(200);
  return await exchanged.json();
}

/** An agent registered before products: its client holds only the order scopes and its connection only orders:read. */
async function makeOrdersOnly(owner: Owner, clientId: string) {
  await systemPrisma.oauthClient.update({ where: { clientId }, data: { scopes: ["orders:read", "offline_access"] } });
  await withTenantIsolation(owner.companyId, async () => await prisma.assistantConnection.updateMany({ data: { scopes: ["orders:read"] } }));
}

const refresh = (clientId: string, refreshToken: string) => fetch(`${api}/api/auth/oauth2/token`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource }),
});

const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
const mcp = (token: string, body: unknown) => fetch(`${api}/mcp`, {
  method: "POST", redirect: "manual",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});
async function readRpc(response: Response) {
  const text = await response.text();
  return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? "" : text);
}
// The tests read the structured output by path; its shape is checked by the tools' own output schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolResult = { isError?: boolean; structuredContent?: Record<string, any>; content: { text: string }[] };
async function callTool(token: string, name: string, args: unknown = {}) {
  const response = await mcp(token, rpc("tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  const result = (await readRpc(response)).result as ToolResult;
  const text = result.content[0]!.text;
  for (const secret of secrets) expect(text, `${name} leaked ${secret}`).not.toContain(secret);
  return result;
}

const recipient = { name: "Carla Pérez", phone: "+51987654789", identity: { kind: "document", documentType: "national_id", document: "45678912" } };
const pricing = { quotationId: randomUUID(), rateId: randomUUID(), optionId: randomUUID(), settingsVersion: 1 };
const home = { method: "home", recipient, pricing, recordedBy: { kind: "buyer" },
  destination: { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima", address: "Av. Larco 123", instructions: "Portón verde" } };
const storePickup = { method: "store", recipient: { name: "Luis Soto", phone: "+51999111222", identity: { kind: "absent" } }, settingsVersion: 1, recordedBy: { kind: "buyer" },
  pickupPoint: { name: "Tienda principal", address: "Av. Lima 1", instructions: null } };

type SeedOrder = Readonly<{ number: number; total: number; quantity?: number; paid?: number; reported?: boolean; date?: string | null; delivery?: object | null;
  buyer?: Readonly<{ name: string | null; phone: string | null }> | null; fromCatalog?: boolean; confirmed?: boolean; cancelled?: boolean; shipped?: boolean }>;
/** Writes orders of one store; the rows stay behind like the other order integration tests (the company id is random and isolated). */
async function seedStore(owner: Owner, orders: readonly SeedOrder[], stock = 10) {
  await withTenantIsolation(owner.companyId, async () => {
    const seeded = await seedProduct({ variants: [{ attributes: { Talla: "M" }, stock }] });
    const variant = [...seeded.variantIds][0]!;
    for (const order of orders) {
      const id = randomUUID();
      const quantity = order.quantity ?? 1;
      const catalog = order.fromCatalog ?? false;
      const confirmed = order.confirmed ?? true;
      await prisma.order.create({ data: { id, number: BigInt(order.number), currency: "PEN", total: new Prisma.Decimal(order.total), itemsTotal: new Prisma.Decimal(order.total),
        createdAt: new Date("2026-10-20T15:00:00Z"), cancelled: order.cancelled ?? false, cancelledAt: order.cancelled ? new Date("2026-10-21T15:00:00Z") : null,
        deliveryStatus: order.shipped ? "shipped" : "pending", stockDeducted: order.shipped ?? false, stockDeductedAt: order.shipped ? new Date("2026-10-21T15:00:00Z") : null,
        shippedAt: order.shipped ? new Date("2026-10-21T15:00:00Z") : null, fromCatalog: catalog, checkoutEnabledAt: catalog ? new Date("2026-10-20T15:00:00Z") : null,
        checkoutConfirmedAt: catalog && confirmed ? new Date("2026-10-20T15:00:00Z") : null,
        scheduledDispatchDate: order.date ? new Date(`${order.date}T00:00:00Z`) : null, delivery: (order.delivery ?? Prisma.JsonNull) as never, sellerId: catalog ? null : owner.userId } });
      const buyer = order.buyer === undefined ? { name: "Cliente", phone: "+51911222333" } : order.buyer;
      if (buyer) await prisma.orderBuyer.create({ data: { orderId: id, name: buyer.name, phone: buyer.phone } });
      await prisma.orderItem.create({ data: { orderId: id, orderCreatedAt: new Date("2026-10-20T15:00:00Z"), variantId: variant, productName: "Camisa", variantAttributes: { Talla: "M" }, quantity: BigInt(quantity),
        unitPrice: new Prisma.Decimal(order.total / quantity), subtotal: new Prisma.Decimal(order.total) } });
      if (order.paid) await prisma.payment.create({ data: { id: randomUUID(), orderId: id, status: "confirmed", amount: new Prisma.Decimal(order.paid), currency: "PEN", method: "bank_transfer",
        data: { confirmedAt: "2026-10-21T15:00:00.000Z", confirmedBy: { kind: "seller", userId: owner.userId }, evidence: { kind: "manual" } } } });
      if (order.reported) await prisma.payment.create({ data: { id: randomUUID(), orderId: id, status: "reported", amount: null, currency: "PEN", method: null,
        data: { receiptImageId: randomUUID(), reportedAt: "2026-10-21T15:00:00.000Z" } } });
    }
  });
}

afterAll(async () => {
  for (const id of companyIds) await withTenantIsolation(id, async () => {
    await prisma.assistantConnection.deleteMany({});
    await prisma.companyCourier.deleteMany();
    await prisma.companyDeliverySettings.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await deleteSeededProducts();
  });
  await systemPrisma.oauthClient.deleteMany({ where: { clientId: { in: clientIds } } });
  await systemPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  for (const id of companyIds) await withTenantIsolation(id, async () => await prisma.company.deleteMany({ where: { id } }));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

test("lists the four order tools and the two product tools for a connected store", async () => {
  const rosa = await createOwner("Rosa");
  const token = await connectAgent(rosa, await registerClient());
  const response = await readRpc(await mcp(token, rpc("tools/list")));
  const tools = response.result.tools as { name: string; annotations: Record<string, boolean> }[];
  expect(tools.map((tool) => tool.name).sort()).toEqual(expectedToolNames);
  for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
});

test("hides an orders-only connection from the list, ends it on its next call and shows the screen again", async () => {
  const rosa = await createOwner("Rosa");
  const clientId = await registerClient();
  const token = await connectAgent(rosa, clientId);
  await makeOrdersOnly(rosa, clientId);
  const access = { companyId: rosa.companyId, userId: rosa.userId };
  const listed = await withTenantIsolation(rosa.companyId, async () => await assistantConnections.list(access));
  expect(listed.success && listed.data).toEqual([]);

  const response = await mcp(token, rpc("tools/call", { name: "buscar_pedidos", arguments: {} }));
  expect(response.status).toBe(401);
  expect(await withTenantIsolation(rosa.companyId, async () => await prisma.assistantConnection.count())).toBe(0);
  // Access tokens are JWTs with no stored row; the refresh tokens are the stored part of the grant.
  const tokens = await systemPrisma.oauthRefreshToken.findMany({ where: { clientId, userId: rosa.userId } });
  expect(tokens.length).toBeGreaterThan(0);
  expect(tokens.every((row) => row.revoked !== null)).toBe(true);

  expect((await authorizeLocation(clientId, null)).pathname).toBe("/login");
  expect((await authorizeLocation(clientId, rosa.cookie)).pathname).toBe("/assistants/authorize");
});

test("re-authorizes an agent registered before products with its own client and lists six tools", async () => {
  const rosa = await createOwner("Rosa");
  const clientId = await registerClient();
  await connectAgent(rosa, clientId);
  await makeOrdersOnly(rosa, clientId);
  const token = await connectAgent(rosa, clientId);
  const rows = await withTenantIsolation(rosa.companyId, async () => await prisma.assistantConnection.findMany());
  expect(rows).toHaveLength(1);
  expect(rows[0]!.scopes.toSorted()).toEqual(["orders:read", "products:read"]);
  expect((await systemPrisma.oauthClient.findUniqueOrThrow({ where: { clientId } })).scopes.toSorted()).toEqual(["offline_access", "orders:read", "products:read"]);
  const tools = (await readRpc(await mcp(token, rpc("tools/list")))).result.tools as { name: string }[];
  expect(tools.map((tool) => tool.name).sort()).toEqual(expectedToolNames);
});

test("revokes the old grant's refresh tokens when an orders-only connection is re-authorized before its next call", async () => {
  const rosa = await createOwner("Rosa");
  const clientId = await registerClient();
  const first = await connectAgentTokens(rosa, clientId);
  expect(typeof first.refresh_token).toBe("string");
  await makeOrdersOnly(rosa, clientId);
  const second = await connectAgentTokens(rosa, clientId);
  // The new grant first: presenting a revoked token makes the plugin invalidate the whole refresh family.
  expect((await refresh(clientId, second.refresh_token)).status).toBe(200);
  expect((await refresh(clientId, first.refresh_token)).status).toBeGreaterThanOrEqual(400);
});

test("never returns another store's order for the same number", async () => {
  const rosa = await createOwner("Rosa");
  const luis = await createOwner("Luis");
  await seedStore(rosa, [{ number: 1001, total: 50, buyer: { name: "Carla de Rosa", phone: null } }]);
  await seedStore(luis, [{ number: 1001, total: 70, buyer: { name: "Mario de Luis", phone: null } }, { number: 1042, total: 70, buyer: { name: "Mario de Luis", phone: null } }]);
  const clientId = await registerClient();
  const rosaToken = await connectAgent(rosa, clientId);
  const luisToken = await connectAgent(luis, clientId);
  expect((await callTool(rosaToken, "ver_pedido", { numero: "#1001" })).structuredContent).toMatchObject({ cliente: "Carla de Rosa", total: "S/ 50.00" });
  expect((await callTool(luisToken, "ver_pedido", { numero: "1001" })).structuredContent).toMatchObject({ cliente: "Mario de Luis", total: "S/ 70.00" });
  const foreign = await callTool(rosaToken, "ver_pedido", { numero: "1042" });
  const missing = await callTool(rosaToken, "ver_pedido", { numero: "9042" });
  expect(foreign.isError).toBe(true);
  expect(foreign.content[0]!.text).toBe("No hay un pedido #1042 en tu tienda.");
  expect(missing.content[0]!.text).toBe("No hay un pedido #9042 en tu tienda.");
  const search = await callTool(rosaToken, "buscar_pedidos", {});
  expect(search.structuredContent!.pedidos.map((order: { cliente: string }) => order.cliente)).toEqual(["Carla de Rosa"]);
  expect(search.structuredContent!.total).toBe(1);
});

test("answers the product's examples through tools/call without any phone, street or document", async () => {
  const today = limaCalendarDay(new Date());
  const daysAgo = (days: number) => { let day: string = today; for (let i = 0; i < days; i += 1) day = new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10); return day; };
  const rosa = await createOwner("Rosa");
  const empty = await createOwner("Vacía");
  await seedStore(rosa, [
    { number: 1001, total: 80, paid: 80, delivery: home, buyer: { name: "Carla Pérez", phone: "+51987654789" }, date: today },
    { number: 1002, total: 40, buyer: { name: null, phone: "+51987654427" } },
    { number: 1003, total: 40, buyer: null },
    { number: 1048, total: 80, paid: 80, delivery: home, date: daysAgo(2) },
    { number: 1049, total: 80, paid: 80, delivery: home, date: nextCalendarDay(today) },
    { number: 1051, total: 80, delivery: home, date: today, reported: true },
    { number: 1052, total: 80, paid: 80, delivery: home, date: today, quantity: 20 },
    { number: 1053, total: 80, paid: 40, delivery: storePickup, date: today },
    { number: 1047, total: 80, paid: 80, delivery: home, date: null },
    { number: 1060, total: 100 },
    { number: 1061, total: 80, paid: 30, reported: true },
    { number: 1070, total: 90, fromCatalog: true, confirmed: false },
  ]);
  const rosaToken = await connectAgent(rosa, await registerClient());

  const detail = (await callTool(rosaToken, "ver_pedido", { numero: "#1001" })).structuredContent!;
  expect(detail).toMatchObject({ cliente: "Carla Pérez", entrega: { telefono: "termina en 789", destino: "Miraflores, Lima, Lima" } });
  expect((await callTool(rosaToken, "ver_pedido", { numero: "1002" })).structuredContent!.cliente).toBe("Cliente que termina en 427");
  expect((await callTool(rosaToken, "ver_pedido", { numero: "1003" })).structuredContent!.cliente).toBe("Público general");
  expect((await callTool(rosaToken, "buscar_pedidos", { texto: "987654789" })).structuredContent).toMatchObject({ total: 0, mensaje: "No hay pedidos con esos filtros." });

  const unpaid = (await callTool(rosaToken, "pedidos_por_cobrar")).structuredContent!;
  expect(unpaid.resumen).toBe("6 pedidos, S/ 350.00 por cobrar. 2 tienen un pago por revisar");
  expect(unpaid.pedidos.map((order: { numero: string }) => order.numero)).not.toContain("#1070");
  expect(unpaid.pedidos.find((order: { numero: string }) => order.numero === "#1061")).toMatchObject({ pago_por_revisar: true, por_cobrar: "S/ 50.00" });
  const catalog = await callTool(rosaToken, "ver_pedido", { numero: "#1070" });
  expect(catalog.content[0]!.text).toBe("No hay un pedido #1070 en tu tienda.");

  const queue = (await callTool(rosaToken, "pedidos_por_despachar_hoy")).structuredContent!;
  expect(queue.resumen).toMatch(/^Atrasados: 1, 1 listo\. Para hoy: 4, 1 listo\.$/);
  const rows = queue.pedidos as { numero: string; grupo: string; preparacion: { listo: boolean; texto: string }; por_cobrar?: string }[];
  expect(rows.map((row) => `${row.grupo}:${row.numero}`)).toEqual(["Atrasados:#1048", "Para hoy:#1001", "Para hoy:#1051", "Para hoy:#1052", "Para hoy:#1053"]);
  const byNumber = Object.fromEntries(rows.map((row) => [row.numero, row]));
  expect(byNumber["#1048"]!.preparacion.texto).toBe("Listo para despachar");
  expect(byNumber["#1051"]!.preparacion.texto).toBe("Se requiere al menos un pago para despachar. Tiene un pago por revisar.");
  expect(byNumber["#1052"]!.preparacion.texto).toBe("Para despachar falta stock de Camisa (M).");
  expect(byNumber["#1053"]!.preparacion.texto).toBe("Se requiere el pago completo antes de entregar. Por cobrar: S/ 40.00.");
  expect(queue.sin_fecha_de_despacho).toBe("Además hay 5 pedidos pendientes sin fecha de despacho.");

  const reversed = await callTool(rosaToken, "buscar_pedidos", { creado_desde: "2026-10-07", creado_hasta: "2026-10-01" });
  expect(reversed).toMatchObject({ isError: true });
  expect(reversed.content[0]!.text).toBe("La fecha final (2026-10-01) es anterior a la inicial (2026-10-07).");
  expect((await callTool(rosaToken, "buscar_pedidos", { entrega: "entregada", creado_desde: "2026-10-01", creado_hasta: "2026-10-07" })).structuredContent!.mensaje).toBe("No hay pedidos con esos filtros.");
  const emptyToken = await connectAgent(empty, await registerClient());
  expect((await callTool(emptyToken, "buscar_pedidos", { entrega: "entregada" })).structuredContent!.mensaje).toBe("Tu tienda todavía no tiene pedidos.");
  expect((await callTool(emptyToken, "pedidos_por_cobrar")).structuredContent!.mensaje).toBe("No tienes pedidos por cobrar.");
});

test("never returns a complete phone in a customer name and never finds a customer by digits", async () => {
  const rosa = await createOwner("Rosa");
  const nbsp = "\u00a0", zwsp = "\u200b";
  await seedStore(rosa, [
    { number: 2001, total: 40, buyer: { name: "987654789", phone: null } },
    { number: 2002, total: 40, buyer: { name: "+51 987-654-321", phone: "+51987654321" } },
    { number: 2003, total: 40, buyer: { name: "Carla 987654444", phone: "+51987654444" } },
    { number: 2004, total: 40, buyer: { name: `987${nbsp}654${nbsp}111`, phone: null } },
    { number: 2005, total: 40, buyer: { name: `987${zwsp}654222`, phone: null } },
    { number: 2006, total: 40, buyer: { name: "987/654/777", phone: null } },
    { number: 2007, total: 40, buyer: { name: "９８７６５４３３３", phone: null } },
    { number: 2008, total: 40, buyer: { name: "Tienda 24", phone: null } },
    { number: 2009, total: 40, buyer: { name: "987\u2013654\u2013123", phone: null } },
    { number: 2010, total: 40, buyer: { name: "Luis 987_654_456", phone: null } },
    { number: 2011, total: 40, buyer: { name: "Ana 9\ufe0f\u20e38\ufe0f\u20e37\ufe0f\u20e36\ufe0f\u20e35\ufe0f\u20e34\ufe0f\u20e3", phone: null } },
    { number: 2012, total: 40, buyer: { name: "Eva ❾❽❼❻❺❹❸❷❶", phone: null } },
    { number: 2014, total: 40, buyer: { name: "Marta 987\u3164654\u3164321", phone: null } },
    { number: 2013, total: 40, buyer: { name: "Rita ⁹⁸⁷⁶⁵⁴³²¹", phone: null } },
  ]);
  const token = await connectAgent(rosa, await registerClient());
  const found = async (texto: string) => ((await callTool(token, "buscar_pedidos", { texto })).structuredContent!.pedidos as { numero: string }[]).map((order) => order.numero);
  for (const texto of ["987", "654", "987654", "987654789", "987654444", "444", "111", "222", "777", "333", "321", "51 987", "+51 987-654-321", "24", "９８７", "❾❽❼", "⁹⁸⁷", "❶"]) expect(await found(texto), texto).toEqual([]);
  expect(await found("carla")).toEqual(["#2003"]);
  expect(await found("tienda")).toEqual(["#2008"]);
  expect(await found("#2001")).toEqual(["#2001"]);
  expect(await found("2008")).toEqual(["#2008"]);
  const everything = JSON.stringify([(await callTool(token, "buscar_pedidos")).structuredContent, (await callTool(token, "pedidos_por_cobrar")).structuredContent]);
  expect(everything.replace(/https?:\/\/\S+?"/g, "")).not.toMatch(/\d{6}/);
  const customers = Object.fromEntries(await Promise.all([2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014].map(async (number) =>
    [number, (await callTool(token, "ver_pedido", { numero: String(number) })).structuredContent!.cliente])));
  expect(customers).toEqual({ 2001: "Cliente que termina en 789", 2002: "Cliente que termina en 321", 2003: "Carla •••444", 2004: "Cliente que termina en 111",
    2005: "Cliente que termina en 222", 2006: "Cliente que termina en 777", 2007: "Cliente que termina en 333", 2008: "Tienda 24", 2009: "Cliente que termina en 123", 2010: "Luis •••456", 2011: "Ana •••654", 2012: "Eva •••❸❷❶", 2013: "Rita •••321", 2014: "Marta •••321" });
});

test("answers agency orders, unassigned delivery, short stock, cancelled orders and a disabled courier through tools/call", async () => {
  const today = limaCalendarDay(new Date());
  const rosa = await createOwner("Rosa");
  const [shalom, olva] = await Promise.all(["shalom", "olva"].map((code) => systemPrisma.courier.findUniqueOrThrow({ where: { code } })));
  const [shalomId, olvaId] = [randomUUID(), randomUUID()];
  await withTenantIsolation(rosa.companyId, async () => {
    await prisma.companyDeliverySettings.create({ data: { storeEnabled: false, version: 1 } });
    await prisma.companyCourier.create({ data: { id: shalomId, courierId: shalom!.id, enabled: false } });
    await prisma.companyCourier.create({ data: { id: olvaId, courierId: olva!.id, enabled: true } });
  });
  const place = { country: "PE", districtCode: "150101", district: "Cercado", province: "Lima", department: "Lima" };
  const agency = (courierId: string, courierName: string) => ({ method: "agency", pricing, recordedBy: { kind: "buyer" }, destination: place, courier: { id: courierId, name: courierName },
    agency: { id: randomUUID(), name: "Agencia Centro", address: "Jr. Unión 450", location: place },
    recipient: { name: "Luis Soto", phone: "+51999111222", identity: { kind: "document", documentType: "national_id", document: "45678912" } } });
  await seedStore(rosa, [
    { number: 1054, total: 80, delivery: agency(olvaId, olva!.name), date: today, reported: true },
    { number: 1030, total: 80, paid: 80, delivery: agency(shalomId, shalom!.name), shipped: true },
    { number: 3001, total: 80, date: today, delivery: null },
    { number: 3002, total: 80, paid: 30, quantity: 4, delivery: home, date: today },
    { number: 3003, total: 80, paid: 80, delivery: home, date: today, cancelled: true },
  ], 3);
  const token = await connectAgent(rosa, await registerClient());

  const queue = (await callTool(token, "pedidos_por_despachar_hoy")).structuredContent!;
  const rows = Object.fromEntries((queue.pedidos as { numero: string; modalidad: string; courier?: string; preparacion: { texto: string } }[]).map((row) => [row.numero, row]));
  expect(Object.keys(rows).sort()).toEqual(["#1054", "#3001", "#3002"]);
  expect(rows["#1054"]).toMatchObject({ modalidad: "Agencia", courier: olva!.name, preparacion: { texto: "Se requiere al menos un pago para despachar. Tiene un pago por revisar." } });
  expect(rows["#3001"]!.preparacion.texto).toBe("Entrega por definir: falta asignar la entrega.");
  expect(rows["#3002"]!.preparacion.texto).toBe("Para despachar falta stock de Camisa (M).");
  const cancelled = (await callTool(token, "ver_pedido", { numero: "3003" })).structuredContent!;
  expect(cancelled).toMatchObject({ estado: "Cancelado" });
  expect(cancelled).not.toHaveProperty("preparacion");

  const byCourier = (await callTool(token, "buscar_pedidos", { courier: "Shalom", entrega: "despachada" })).structuredContent!;
  expect(byCourier.pedidos.map((order: { numero: string }) => order.numero)).toEqual(["#1030"]);
  const unknown = await callTool(token, "buscar_pedidos", { courier: "Olba" });
  expect(unknown.isError).toBe(true);
  expect(unknown.content[0]!.text).toBe(`Tu tienda no tiene el courier "Olba". Couriers: ${[olva!.name, shalom!.name].sort((a, b) => a.localeCompare(b, "es")).join(", ")}.`);
});

test("a disconnected connection gets 401 on its next call", async () => {
  const rosa = await createOwner("Rosa");
  const token = await connectAgent(rosa, await registerClient());
  expect((await callTool(token, "buscar_pedidos")).isError).toBeFalsy();
  const [connection] = await withTenantIsolation(rosa.companyId, async () => await prisma.assistantConnection.findMany());
  const disconnected = await assistantConnections.disconnect({ connectionId: connection!.id as AssistantConnectionId }, { companyId: rosa.companyId, userId: rosa.userId });
  expect(disconnected.success).toBe(true);
  const response = await mcp(token, rpc("tools/call", { name: "buscar_pedidos", arguments: {} }));
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
});

test("a password reset ends the connections that account authorized and not the others", async () => {
  const rosa = await createOwner("Rosa");
  const luis = await createOwner("Luis", rosa.companyId);
  const clientId = await registerClient();
  const rosaToken = await connectAgent(rosa, clientId);
  const luisToken = await connectAgent(luis, clientId);
  expect((await callTool(rosaToken, "buscar_pedidos")).isError).toBeFalsy();
  const reset = randomUUID();
  await systemPrisma.verification.create({ data: { id: randomUUID(), identifier: `reset-password:${reset}`, value: rosa.userId, expiresAt: new Date(Date.now() + 60_000) } });
  expect((await post("/api/auth/reset-password", { newPassword: "a-new-password-456", token: reset })).status).toBe(200);
  expect((await mcp(rosaToken, rpc("tools/call", { name: "buscar_pedidos", arguments: {} }))).status).toBe(401);
  expect((await callTool(luisToken, "buscar_pedidos")).isError).toBeFalsy();
});
