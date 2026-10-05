import express from "express";
import { afterEach, expect, test, vi } from "vitest";
import { deliverySettingsSchema, saveDeliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { deliverySettingsRoutes } from "@core/src/features/delivery-settings/presentation/api-routes";
import { log } from "@core/src/shared/infrastructure/logger";

const context = { companyId: "00000000-0000-4000-8000-000000000001", userId: "seller" };
const store = { enabled: true as const, pickupPoint: { name: "Tienda", address: "Av. Lima 123", instructions: null } };
const input = { expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store };
const servers: import("node:http").Server[] = [];

async function request(init?: RequestInit) {
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => {
    response.locals.auth = { company: { id: context.companyId }, user: { id: context.userId } };
    next();
  });
  app.use("/api/delivery-settings", deliverySettingsRoutes);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/delivery-settings`, init);
  return { status: response.status, body: await response.json() };
}
const put = (body: unknown): RequestInit => ({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

test("configuration HTTP validates inputs and uses authenticated context", async () => {
  const get = vi.spyOn(deliverySettings, "get").mockResolvedValue({ success: true, data: { version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } } });
  const save = vi.spyOn(deliverySettings, "save").mockResolvedValue({ success: true, data: { version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store } });
  expect(await request()).toMatchObject({ status: 200, body: { version: 0 } });
  expect(get).toHaveBeenCalledWith(context);
  for (const invalid of [{ ...input, companyId: "other" }, { ...input, userId: "other" }, { ...input, expectedVersion: -1 },
    { ...input, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: null } }]) {
    expect(await request(put(invalid))).toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
  }
  expect(save).not.toHaveBeenCalled();
  expect(await request({ method: "PUT", headers: { "content-type": "text/plain" }, body: "input" }))
    .toMatchObject({ status: 415, body: { code: "UNSUPPORTED_MEDIA_TYPE" } });
  expect(await request(put(input))).toMatchObject({ status: 200, body: { version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store } });
  expect(save).toHaveBeenCalledWith(input, context);
});

test.each([
  ["INVALID_DELIVERY_SETTINGS", 422, "INVALID_DELIVERY_SETTINGS"],
  ["DELIVERY_SETTINGS_CONFLICT", 409, "DELIVERY_SETTINGS_CONFLICT"],
  ["PERSISTENCE_UNAVAILABLE", 503, "SERVICE_UNAVAILABLE"],
  ["INVALID_STORED_DATA", 500, "INTERNAL_ERROR"],
] as const)("maps %s without leaking internal details or logging the same failure again", async (code, status, outputCode) => {
  const logged = vi.spyOn(log, "error").mockImplementation(() => {});
  vi.spyOn(deliverySettings, "save").mockResolvedValue({ success: false, error: { code, message: "private internal details" } });
  const response = await request(put(input));
  expect(response).toMatchObject({ status, body: { code: outputCode } });
  expect(JSON.stringify(response.body)).not.toContain("private internal details");
  expect(logged).not.toHaveBeenCalled();
});

test("unexpected exceptions are handled once with safe request context", async () => {
  const cause = new Error("private connection string");
  vi.spyOn(deliverySettings, "get").mockRejectedValue(cause);
  const logged = vi.spyOn(log, "error").mockImplementation(() => {});
  expect(await request()).toMatchObject({ status: 500, body: { code: "INTERNAL_ERROR", error: "Internal error" } });
  expect(logged).toHaveBeenCalledOnce();
  expect(logged).toHaveBeenCalledWith({ event: "delivery_settings_request_failed", operation: "get_delivery_settings",
    entryPoint: "api", userId: context.userId, errorCode: "INTERNAL_ERROR", err: cause }, expect.any(String));
});

test("configuration JSON contracts reject partial points and authoritative client fields", () => {
  expect(saveDeliverySettingsSchema.safeParse(input).success).toBe(true);
  expect(deliverySettingsSchema.safeParse({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store }).success).toBe(true);
  expect(deliverySettingsSchema.safeParse({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: { instructions: "Door" } } }).success).toBe(false);
  expect(saveDeliverySettingsSchema.safeParse({ ...input, recordedBy: { kind: "buyer" } }).success).toBe(false);
});
