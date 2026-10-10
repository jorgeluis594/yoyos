import { afterEach, describe, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action, loader } from "@core/app/routes/checkout-appearance-settings";
import { checkoutAppearance, type CheckoutAppearance, type ImageId } from "@core/src/features/checkout-appearance";
import * as images from "@core/src/shared/images";
import * as logger from "@core/src/shared/infrastructure/logger";

const access = { company: { id: "00000000-0000-4000-8000-000000000001", name: "Lima Studio" }, user: { id: "user-1" } };
const context = { get: () => access } as unknown as ActionFunctionArgs["context"];
const logoId = "00000000-0000-4000-8000-0000000000aa" as ImageId;
const appearance: CheckoutAppearance = { logoImageId: logoId, brandColor: "forest", background: "brand_tint" };

const load = () => loader({ context, request: new Request("http://localhost/settings/checkout-appearance") } as LoaderFunctionArgs);
const save = (body: unknown) => action({ context, request: new Request("http://localhost/settings/checkout-appearance", { method: "POST", body: JSON.stringify(body) }) } as ActionFunctionArgs);
const failure = (code: "INVALID_CHECKOUT_APPEARANCE" | "INVALID_IMAGE" | "PERSISTENCE_UNAVAILABLE") =>
  ({ success: false, error: { code, message: "x", invalidFields: [] } }) as never;

afterEach(() => vi.restoreAllMocks());

describe("editor loader", () => {
  test("returns the published appearance and logo URL of the session company", async () => {
    const get = vi.spyOn(checkoutAppearance, "get").mockResolvedValue({ success: true, data: appearance });
    vi.spyOn(images, "resolvePublicImage").mockResolvedValue({ success: true, data: { url: "https://cdn.test/logo.png" } } as never);
    expect(await load()).toEqual({ companyName: "Lima Studio", published: appearance, logoUrl: "https://cdn.test/logo.png" });
    expect(get).toHaveBeenCalledWith(access.company.id);
  });

  test("returns the Yoyos default when the company has no appearance", async () => {
    vi.spyOn(checkoutAppearance, "get").mockResolvedValue({ success: true, data: null });
    expect(await load()).toEqual({ companyName: "Lima Studio", published: { logoImageId: null, brandColor: "yoyos", background: "neutral" }, logoUrl: null });
  });

  test("responds 503 when the appearance cannot be read", async () => {
    vi.spyOn(checkoutAppearance, "get").mockResolvedValue({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "x" } });
    await expect(load()).rejects.toMatchObject({ status: 503 });
  });
});

describe("editor action", () => {
  test("saves the appearance for the session company, ignoring any company in the body", async () => {
    const write = vi.spyOn(checkoutAppearance, "save").mockResolvedValue({ success: true, data: appearance });
    const body = { ...appearance, companyId: "forged" };
    const result = await save(body);
    expect(result.data).toEqual({ success: true, appearance });
    expect(write).toHaveBeenCalledWith(access.company.id, access.user.id, body);
  });

  test("responds 422 for an invalid appearance or a color outside the catalog", async () => {
    vi.spyOn(checkoutAppearance, "save").mockResolvedValue(failure("INVALID_CHECKOUT_APPEARANCE"));
    const result = await save({ logoImageId: null, brandColor: "#FF0000", background: "white" });
    expect(result.init?.status).toBe(422);
    expect(result.data).toEqual({ error: "INVALID_CHECKOUT_APPEARANCE" });
  });

  test("responds 422 for a logo of another company", async () => {
    vi.spyOn(checkoutAppearance, "save").mockResolvedValue(failure("INVALID_IMAGE"));
    const result = await save(appearance);
    expect(result.init?.status).toBe(422);
    expect(result.data).toEqual({ error: "INVALID_IMAGE" });
  });

  test("responds 503 and keeps the published appearance when saving fails", async () => {
    const write = vi.spyOn(checkoutAppearance, "save").mockResolvedValue(failure("PERSISTENCE_UNAVAILABLE"));
    const result = await save(appearance);
    expect(result.init?.status).toBe(503);
    expect(result.data).toEqual({ error: "PERSISTENCE_UNAVAILABLE" });
    expect(write).toHaveBeenCalledOnce();
  });

  test("passes an unreadable body to validation instead of failing", async () => {
    const write = vi.spyOn(checkoutAppearance, "save").mockResolvedValue(failure("INVALID_CHECKOUT_APPEARANCE"));
    const result = await action({ context, request: new Request("http://localhost/x", { method: "POST", body: "{" }) } as ActionFunctionArgs);
    expect(write).toHaveBeenCalledWith(access.company.id, access.user.id, null);
    expect(result.init?.status).toBe(422);
  });

  test("tags the request as save_checkout_appearance with its outcome", async () => {
    const bind = vi.spyOn(logger, "bindRequestOperation");
    vi.spyOn(checkoutAppearance, "save").mockResolvedValueOnce({ success: true, data: appearance })
      .mockResolvedValueOnce(failure("INVALID_IMAGE")).mockResolvedValueOnce(failure("PERSISTENCE_UNAVAILABLE"));
    await save(appearance); await save(appearance); await save(appearance);
    expect(bind.mock.calls.map(([fields]) => fields)).toEqual([
      { operation: "save_checkout_appearance", outcome: "saved" },
      { operation: "save_checkout_appearance", outcome: "invalid_input" },
      { operation: "save_checkout_appearance", outcome: "technical_failure" },
    ]);
  });
});
