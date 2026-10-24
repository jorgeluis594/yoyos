import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";

const imageBytes = vi.hoisted(() => new Map<string, string | "down">());
vi.mock("@core/src/shared/images", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@core/src/shared/images")>();
  return { ...actual, readImageBytes: vi.fn(async (imageId: string) => {
    const file = imageBytes.get(imageId);
    if (!file) return err({ code: "IMAGE_NOT_FOUND" as const, message: "missing" });
    if (file === "down") return err({ code: "IMAGE_STORAGE_UNAVAILABLE" as const, storageCode: "IMAGE_STORAGE_UNAVAILABLE" as const, message: "down" });
    const bytes = new Uint8Array(await readFile(join(import.meta.dirname, "../../../shared/images/infrastructure/qr-fixtures", file)));
    return ok({ bytes, contentType: "image/jpeg" });
  }) };
});
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Payment settings server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { companyId: string; userId: string }[] = [];

async function call(cookie?: string, settings?: unknown) {
  return fetch(`${base}/api/company/payment-settings`, { method: settings === undefined ? "GET" : "PUT",
    headers: { origin, ...(cookie ? { cookie } : {}), ...(settings === undefined ? {} : { "content-type": "application/json" }) },
    ...(settings === undefined ? {} : { body: JSON.stringify({ settings }) }) });
}

async function checkQr(cookie: string, imageId: string) {
  return fetch(`${base}/api/company/payment-settings/qr-checks`, { method: "POST",
    headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify({ imageId }) });
}

/** Registers an image of the company whose bytes are one of the QR fixtures (or an unavailable storage). */
async function image(companyId: string, file: string | "down") {
  const id = randomUUID();
  await withTenantIsolation(companyId, async () => await prisma.image.create({ data: { id, storageKey: `test/${id}` } }));
  imageBytes.set(id, file);
  return id;
}

async function seller() {
  const companyId = randomUUID();
  const email = `payment-settings-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Payments", country: "PE" } }));
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  fixtures.push({ companyId, userId });
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Payment settings test session missing");
  return { companyId, cookie };
}

afterAll(async () => {
  for (const { companyId, userId } of fixtures.reverse()) await withTenantIsolation(companyId, async () => {
    await prisma.companyPaymentSettings.deleteMany();
    await prisma.image.deleteMany();
    await systemPrisma.user.delete({ where: { id: userId } });
    await prisma.company.delete({ where: { id: companyId } });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => imageBytes.clear());

const bank = { method: "bank_transfer", bank: "BCP", holder: "Ana", accountNumber: "00123", cci: null, imageId: null };
const wallet = (imageId: string | null) => ({ method: "digital_wallet", provider: "Plin", holder: "Ana", imageId });
const stored = (companyId: string) => withTenantIsolation(companyId, async () =>
  (await prisma.companyPaymentSettings.findUnique({ where: { companyId } }))?.settings ?? null);

test("seller saves current payment methods while another company and anonymous users cannot read them", async () => {
  expect((await call()).status).toBe(401);
  const first = await seller();
  const second = await seller();
  expect(await (await call(first.cookie)).json()).toEqual({ settings: [] });
  const qr = await image(first.companyId, "non-uuid-qr.jpg");
  const saved = await call(first.cookie, [wallet(qr), bank]);
  expect(saved.status).toBe(200);
  const expected = { settings: [{ method: "digital_wallet", provider: "Plin", holder: "Ana", qr: { status: "verified", imageId: qr } }, bank] };
  expect(await saved.json()).toEqual(expected);
  expect(await (await call(second.cookie)).json()).toEqual({ settings: [] });
  expect((await call(first.cookie, [{ ...bank, accountNumber: null }])).status).toBe(400);
  expect(await (await call(first.cookie)).json()).toEqual(expected);
});

test("PUT answers 400 INVALID_INPUT for an offered wallet without imageId", async () => {
  const { cookie } = await seller();
  for (const body of [wallet(null), { method: "digital_wallet", provider: "Plin", holder: "Ana" }]) {
    const response = await call(cookie, [body]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
  }
});

test("PUT answers 400 INVALID_INPUT for a wallet image of another company", async () => {
  const mine = await seller();
  const other = await seller();
  const foreign = await image(other.companyId, "non-uuid-qr.jpg");
  const response = await call(mine.cookie, [wallet(foreign)]);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
  expect((await checkQr(mine.cookie, foreign)).status).toBe(400);
});

test("PUT answers 400 INVALID_PAYMENT_QR for an image without qr and keeps the previous settings", async () => {
  const { cookie, companyId } = await seller();
  expect((await call(cookie, [bank])).status).toBe(200);
  const before = await stored(companyId);
  const response = await call(cookie, [wallet(await image(companyId, "no-qr.jpg")), bank]);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_PAYMENT_QR" });
  expect(await stored(companyId)).toEqual(before);
});

test("PUT answers 503 QR_CHECK_UNAVAILABLE when the reader is unavailable and saves nothing", async () => {
  const { cookie, companyId } = await seller();
  const response = await call(cookie, [wallet(await image(companyId, "down"))]);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "QR_CHECK_UNAVAILABLE" });
  expect(await stored(companyId)).toBeNull();
});

test("PUT saves a wallet with a real Plin qr fixture as verified", async () => {
  const { cookie, companyId } = await seller();
  const qr = await image(companyId, "non-uuid-qr.jpg");
  expect((await call(cookie, [wallet(qr)])).status).toBe(200);
  expect(await stored(companyId)).toEqual([{ method: "digital_wallet", provider: "Plin", holder: "Ana", qr: { status: "verified", imageId: qr } }]);
  // Changing only the bank while the storage is down keeps the wallet verified.
  imageBytes.set(qr, "down");
  expect((await call(cookie, [wallet(qr), bank])).status).toBe(200);
  expect(await stored(companyId)).toMatchObject([{ qr: { status: "verified", imageId: qr } }, { method: "bank_transfer" }]);
});

test("POST qr-checks answers not_a_qr for a landscape photo and verified for a qr", async () => {
  const { cookie, companyId } = await seller();
  const photo = await (await checkQr(cookie, await image(companyId, "no-qr.jpg"))).json();
  const qr = await (await checkQr(cookie, await image(companyId, "one-qr.jpg"))).json();
  expect(photo).toEqual({ status: "not_a_qr" });
  expect(qr).toEqual({ status: "verified" });
  expect(await stored(companyId)).toBeNull();
});

test("POST qr-checks answers 400 INVALID_INPUT for an image of another company", async () => {
  const mine = await seller();
  const other = await seller();
  const response = await checkQr(mine.cookie, await image(other.companyId, "one-qr.jpg"));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
  expect((await checkQr(mine.cookie, "not-a-uuid")).status).toBe(400);
});

test("GET returns a pre-version wallet as unchecked and PUT with its image stores it verified", async () => {
  const { cookie, companyId } = await seller();
  const qr = await image(companyId, "non-uuid-qr.jpg");
  await withTenantIsolation(companyId, async () => await prisma.companyPaymentSettings.create({ data: { companyId,
    settings: [{ method: "digital_wallet", provider: "Plin", holder: "Ana", imageId: qr }, bank] } }));
  expect(await (await call(cookie)).json()).toEqual({ settings: [
    { method: "digital_wallet", provider: "Plin", holder: "Ana", qr: { status: "unchecked", imageId: qr } }, bank] });
  expect((await call(cookie, [wallet(qr), bank])).status).toBe(200);
  expect(await (await call(cookie)).json()).toMatchObject({ settings: [{ qr: { status: "verified", imageId: qr } }, bank] });
});
