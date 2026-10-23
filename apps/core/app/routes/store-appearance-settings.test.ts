import { afterEach, describe, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, ClientActionFunctionArgs, LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router";
import { action, clientAction, loader, shouldRevalidate } from "@core/app/routes/store-appearance-settings";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { catalogSettings } from "@core/src/features/catalog";
import type { StoreAppearance, ImageId } from "@core/src/features/store-appearance/domain/store-appearance";
import * as logger from "@core/src/shared/infrastructure/logger";

const access = { company: { id: "00000000-0000-4000-8000-000000000001", name: "Lima Studio" }, user: { id: "user-1" } };
const context = { get: () => access } as unknown as ActionFunctionArgs["context"];
const logoId = "00000000-0000-4000-8000-0000000000aa" as ImageId;
const appearance: StoreAppearance = { logoImageId: logoId, theme: "antojo" };

const load = () => loader({ context, request: new Request("http://localhost/settings/store-appearance") } as LoaderFunctionArgs);
const send = (body: unknown) => action({ context, request: new Request("http://localhost/settings/store-appearance", { method: "POST", body: JSON.stringify(body) }) } as ActionFunctionArgs);
const save = (appearanceBody: unknown) => send({ intent: "save-appearance", appearance: appearanceBody });
const failure = (code: "INVALID_STORE_APPEARANCE" | "INVALID_IMAGE" | "PERSISTENCE_UNAVAILABLE") =>
  ({ success: false, error: { code, message: "x", invalidFields: [] } }) as never;
const readable = (data: object) => ({ success: true, data: { kind: "readable", ...data } }) as never;
const publicationRead = (published = true) => vi.spyOn(catalogSettings, "get").mockResolvedValue({ success: true, data: { published } } as never);
const publicationFails = () => vi.spyOn(catalogSettings, "get").mockResolvedValue({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "x" } } as never);

afterEach(() => vi.restoreAllMocks());

describe("editor loader", () => {
  test("returns the published appearance, the logo URL and the publication state of the session company", async () => {
    const get = vi.spyOn(storeAppearance, "get").mockResolvedValue(readable({ appearance, logoUrl: "https://cdn.test/logo.png" }));
    const read = publicationRead(true);
    expect(await load()).toEqual({
      appearance: { kind: "readable", published: appearance, logoUrl: "https://cdn.test/logo.png" },
      publication: { kind: "loaded", published: true },
    });
    expect(get).toHaveBeenCalledWith(access.company.id);
    expect(read).toHaveBeenCalledWith({ companyId: access.company.id, userId: access.user.id });
  });

  test("loads Clásico without logo for a company without appearance", async () => {
    vi.spyOn(storeAppearance, "get").mockResolvedValue(readable({ appearance: { logoImageId: null, theme: "classic" }, logoUrl: null }));
    publicationRead(false);
    expect(await load()).toMatchObject({ appearance: { kind: "readable", published: { logoImageId: null, theme: "classic" }, logoUrl: null }, publication: { kind: "loaded", published: false } });
  });

  test("returns the unknown-theme starting point as data, not as a load error", async () => {
    vi.spyOn(storeAppearance, "get").mockResolvedValue({ success: true, data: { kind: "unknown_theme" } });
    publicationRead();
    expect(await load()).toMatchObject({ appearance: { kind: "unknown_theme" } });
  });

  test("editor loader returns the publication state when the appearance read fails", async () => {
    const bind = vi.spyOn(logger, "bindRequestOperation");
    vi.spyOn(storeAppearance, "get").mockResolvedValue({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "x" } });
    publicationRead(false);
    expect(await load()).toEqual({ appearance: { kind: "failed" }, publication: { kind: "loaded", published: false } });
    expect(bind).toHaveBeenCalledWith({ operation: "get_store_appearance", outcome: "technical_failure" });
  });

  test("editor loader returns the appearance when the publication read fails", async () => {
    vi.spyOn(storeAppearance, "get").mockResolvedValue(readable({ appearance, logoUrl: null }));
    publicationFails();
    expect(await load()).toEqual({ appearance: { kind: "readable", published: appearance, logoUrl: null }, publication: { kind: "failed" } });
  });
});

describe("editor action", () => {
  test("saves the appearance for the session company, ignoring any company in the body", async () => {
    const write = vi.spyOn(storeAppearance, "save").mockResolvedValue({ success: true, data: { appearance, logoUrl: null } });
    const body = { ...appearance, companyId: "forged" };
    const result = await save(body);
    expect(result.data).toEqual({ intent: "save-appearance", success: true, appearance });
    expect(write).toHaveBeenCalledWith(access.company.id, access.user.id, body);
  });

  test("rejects a theme outside the five with 422", async () => {
    // Validation runs before any storage access, so the real use case answers without a database.
    const result = await save({ logoImageId: null, theme: "neon" });
    expect(result.init?.status).toBe(422);
    expect(result.data).toEqual({ intent: "save-appearance", error: "INVALID_STORE_APPEARANCE" });
  });

  test("rejects a brand color or background sent with the theme with 422", async () => {
    const result = await save({ logoImageId: null, theme: "classic", brandColor: "forest", background: "soft" });
    expect(result.init?.status).toBe(422);
    expect(result.data).toEqual({ intent: "save-appearance", error: "INVALID_STORE_APPEARANCE" });
  });

  test("responds 422 for a logo of another company", async () => {
    vi.spyOn(storeAppearance, "save").mockResolvedValue(failure("INVALID_IMAGE"));
    const result = await save(appearance);
    expect(result.init?.status).toBe(422);
    expect(result.data).toEqual({ intent: "save-appearance", error: "INVALID_IMAGE" });
  });

  test("responds 503 and keeps the published appearance when saving fails", async () => {
    const write = vi.spyOn(storeAppearance, "save").mockResolvedValue(failure("PERSISTENCE_UNAVAILABLE"));
    const result = await save(appearance);
    expect(result.init?.status).toBe(503);
    expect(result.data).toEqual({ intent: "save-appearance", error: "PERSISTENCE_UNAVAILABLE" });
    expect(write).toHaveBeenCalledOnce();
  });

  test("editor action rejects a body without a known intent with 400", async () => {
    const write = vi.spyOn(storeAppearance, "save");
    const publish = vi.spyOn(catalogSettings, "setPublication");
    for (const body of [appearance, { intent: "delete-everything" }, { intent: "set-publication" }, { intent: "set-publication", published: "yes" }, { intent: "save-appearance", appearance, extra: 1 }, null]) {
      const result = await send(body);
      expect(result.init?.status).toBe(400);
    }
    const unreadable = await action({ context, request: new Request("http://localhost/x", { method: "POST", body: "{" }) } as ActionFunctionArgs);
    expect(unreadable.init?.status).toBe(400);
    expect(write).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test("editor action saves the publication without touching the appearance", async () => {
    const write = vi.spyOn(storeAppearance, "save");
    const publish = vi.spyOn(catalogSettings, "setPublication").mockResolvedValue({ success: true, data: { published: false } } as never);
    const result = await send({ intent: "set-publication", published: false });
    expect(result.data).toEqual({ intent: "set-publication", published: false });
    expect(publish).toHaveBeenCalledWith(false, { companyId: access.company.id, userId: access.user.id });
    expect(write).not.toHaveBeenCalled();
  });

  test("answers 503 of the set-publication intent when the publication cannot be saved", async () => {
    vi.spyOn(catalogSettings, "setPublication").mockResolvedValue({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "x" } } as never);
    const result = await send({ intent: "set-publication", published: true });
    expect(result.init?.status).toBe(503);
    expect(result.data).toEqual({ intent: "set-publication", error: true });
  });

  test("answers the failed-save outcome of the set-publication intent when publishing without a saved link", async () => {
    vi.spyOn(catalogSettings, "setPublication").mockResolvedValue({ success: false, error: { code: "SUBDOMAIN_REQUIRED", message: "x" } } as never);
    const result = await send({ intent: "set-publication", published: true });
    expect(result.init?.status).toBe(409);
    expect(result.data).toEqual({ intent: "set-publication", error: true });
  });

  test("tags the request with its operation and outcome", async () => {
    const bind = vi.spyOn(logger, "bindRequestOperation");
    vi.spyOn(storeAppearance, "save").mockResolvedValueOnce({ success: true, data: { appearance, logoUrl: null } })
      .mockResolvedValueOnce(failure("INVALID_IMAGE")).mockResolvedValueOnce(failure("PERSISTENCE_UNAVAILABLE"));
    vi.spyOn(catalogSettings, "setPublication").mockResolvedValueOnce({ success: true, data: { published: true } } as never)
      .mockResolvedValueOnce({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "x" } } as never);
    await save(appearance); await save(appearance); await save(appearance);
    await send({ intent: "set-publication", published: true }); await send({ intent: "set-publication", published: true });
    expect(bind.mock.calls.map(([fields]) => fields)).toEqual([
      { operation: "save_store_appearance", outcome: "saved" },
      { operation: "save_store_appearance", outcome: "invalid_input" },
      { operation: "save_store_appearance", outcome: "technical_failure" },
      { operation: "set_catalog_publication", outcome: "saved" },
      { operation: "set_catalog_publication", outcome: "technical_failure" },
    ]);
  });
});

describe("editor client action", () => {
  // Like React Router's serverAction, it reads the request body before the fetch fails.
  const lost = (body: unknown) => {
    const request = new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
    return clientAction({
      request,
      serverAction: vi.fn(async () => { await request.json(); throw new TypeError("Failed to fetch"); }),
    } as unknown as ClientActionFunctionArgs);
  };

  test("turns a save that gets no response into the save error with status 503, so the loader is not revalidated and the draft stays", async () => {
    expect(await lost({ intent: "save-appearance", appearance })).toMatchObject({ data: { intent: "save-appearance", error: "PERSISTENCE_UNAVAILABLE" }, init: { status: 503 } });
  });

  test("a lost publication save returns a 503 of the set-publication intent", async () => {
    expect(await lost({ intent: "set-publication", published: false })).toMatchObject({ data: { intent: "set-publication", error: true }, init: { status: 503 } });
  });

  test("passes the server answer through, including a failure status", async () => {
    const answer = { intent: "save-appearance", success: true, appearance };
    expect(await clientAction({ request: new Request("http://localhost/x", { method: "POST", body: "{}" }), serverAction: async () => answer } as unknown as ClientActionFunctionArgs)).toBe(answer);
    const refused = new Response("nope", { status: 500 });
    await expect(clientAction({ request: new Request("http://localhost/x", { method: "POST", body: "{}" }), serverAction: async () => { throw refused; } } as unknown as ClientActionFunctionArgs)).rejects.toBe(refused);
  });
});

describe("editor revalidation", () => {
  const after = (actionResult: unknown) => shouldRevalidate({ actionResult, defaultShouldRevalidate: true } as ShouldRevalidateFunctionArgs);

  test("the editor does not revalidate after a successful publication change", () => {
    expect(after({ intent: "set-publication", published: true })).toBe(false);
  });

  test("revalidates after a saved appearance and not after any failure, so the draft is kept", () => {
    expect(after({ intent: "save-appearance", success: true, appearance })).toBe(true);
    expect(after({ intent: "save-appearance", error: "PERSISTENCE_UNAVAILABLE" })).toBe(false);
    expect(after({ intent: "set-publication", error: true })).toBe(false);
    expect(after({ error: "INVALID_INPUT" })).toBe(false);
  });

  test("keeps the default for a revalidation without an action", () => {
    expect(shouldRevalidate({ defaultShouldRevalidate: true } as ShouldRevalidateFunctionArgs)).toBe(true);
  });
});
