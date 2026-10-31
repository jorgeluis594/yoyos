import { afterEach, describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { Product, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { SearchedProduct } from "@core/src/features/products/application/search-for-assistant";
import type { StorefrontState } from "@core/src/features/catalog";
import { log } from "@core/src/shared/infrastructure/logger";
import { createProductToolsDependencies, type ProductCapabilityPorts } from "@core/src/composition/assistant-product-capabilities";

const access: AssistantAccess = {
  companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId,
  connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, scopes: ["orders:read", "products:read"], lastUsedAt: null,
};
const productId = "0123abcd-0000-4000-8000-000000000001" as ProductId;
const published: StorefrontState = { currency: "PEN", catalog: { kind: "published", subdomain: "rosa" as never } };
const readFailure = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;

const summary = (overrides: Partial<SearchedProduct> = {}): SearchedProduct => ({
  id: productId, name: "Polo básico", currency: "PEN", variantCount: 2, inactiveCount: 0, matching: null,
  active: { kind: "some", count: 2, minSalePrice: { amount: 39.9, currency: "PEN" }, hasDifferentPrices: true, totalStock: 12, soldOut: 0, low: 1, onlyLevel: null, sku: { kind: "several" } },
  ...overrides,
});
const variant = (id: string, quantity: number, status: "active" | "inactive", sku?: string) => ({
  id: id as VariantId, productId, combination: {}, ...sku ? { sku } : {}, salePrice: { amount: 39.9, currency: "PEN" as const }, qrCode: "q", status, stock: { variantId: id as VariantId, quantity },
});
const product = (overrides: Partial<Product> = {}): Product => ({
  id: productId, name: "Polo básico", photoIds: [] as never, currency: "PEN", qrCode: "q", status: "active", createdAt: new Date(), updatedAt: new Date(), structureVersion: 1,
  options: [], variants: [variant("v1", 2, "active", "POL-M")], ...overrides,
});

function ports(overrides: Partial<ProductCapabilityPorts> = {}): ProductCapabilityPorts {
  return {
    snapshot: async (work) => work(),
    describe: async () => ok(published),
    search: async () => ok({ items: [summary()], page: 1, total: 1, storeHasProducts: true }),
    find: async () => ok({ product: product(), searchedVariantId: null }),
    storeUrl: (subdomain, path = "/") => `https://${subdomain}.yoyos.lat${path}`,
    appLink: (id) => `https://app.yoyos.lat/products/${id}`,
    slotWaitMs: 300, slots: 3,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("assistant product capabilities", () => {
  test("gives the customer link only when the catalog is published, the product is in it and its currency is the store's", async () => {
    const linkOf = async (state: StorefrontState, item: SearchedProduct) => {
      const deps = createProductToolsDependencies(ports({ describe: async () => ok(state), search: async () => ok({ items: [item], page: 1, total: 1, storeHasProducts: true }) }));
      const answer = await deps.search({ sort: "recent", page: 1 }, access);
      if (!answer.success || answer.data.kind !== "page") throw new Error("expected a page");
      return answer.data.items[0]?.customerLink;
    };
    expect(await linkOf(published, summary())).toBe(`https://rosa.yoyos.lat/productos/${productId}`);
    expect(await linkOf({ currency: "PEN", catalog: { kind: "hidden", subdomain: "rosa" as never } }, summary())).toBeNull();
    expect(await linkOf(published, summary({ active: { kind: "none", sku: { kind: "several" } } }))).toBeNull();
    expect(await linkOf(published, summary({ currency: "BRL" }))).toBeNull();
  });

  test("maps the refusals of the search to answer kinds", async () => {
    const answerFor = async (error: object) => {
      const deps = createProductToolsDependencies(ports({ search: async () => err(error as never) }));
      const answer = await deps.search({ sort: "recent", page: 1 }, access);
      return answer.success ? answer.data.kind : answer.error;
    };
    expect(await answerFor({ code: "PRICE_RANGE_REVERSED", message: "" })).toBe("price_range_reversed");
    expect(await answerFor({ code: "VARIANT_FILTER_OUTSIDE_CATALOG", message: "" })).toBe("variant_filter_outside_catalog");
    expect(await answerFor({ code: "VALUE_REJECTED", message: "", rejection: { kind: "no_options" } })).toBe("value_rejected");
  });

  test("marks the variant found by SKU and keeps the saved order", async () => {
    const found = product({ variants: [variant("v1", 2, "active", "POL-M"), variant("v2", 0, "inactive")] });
    const deps = createProductToolsDependencies(ports({ find: async () => ok({ product: found, searchedVariantId: "v2" as VariantId }) }));
    const answer = await deps.find({ by: "sku", sku: "x" }, access);
    expect(answer.success && answer.data.product?.variants.map(({ searched, isActive, level }) => [searched, isActive, level])).toEqual([[false, true, "low"], [true, false, "sold_out"]]);
  });

  test("waits up to 300 ms for a slot and then answers the reading-failure text when three product reads are in flight", async () => {
    const warn = vi.spyOn(log, "warn").mockReturnValue(undefined as never);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = createProductToolsDependencies(ports({ describe: async () => { await gate; return ok(published); }, slotWaitMs: 20 }));
    const inFlight = [1, 2, 3].map(() => deps.search({ sort: "recent", page: 1 }, access));
    const busy = await deps.search({ sort: "recent", page: 1 }, access);
    expect(!busy.success && busy.error).toEqual({ code: "FAILURE", message: expect.stringContaining("No pudimos leer tus productos") });
    release();
    expect((await Promise.all(inFlight)).every((answer) => answer.success)).toBe(true);
    expect((await deps.search({ sort: "recent", page: 1 }, access)).success).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("lets a fourth call run when a slot frees up within the wait", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = createProductToolsDependencies(ports({ describe: async () => { await gate; return ok(published); }, slotWaitMs: 1000 }));
    const calls = [1, 2, 3, 4].map(() => deps.search({ sort: "recent", page: 1 }, access));
    setTimeout(release, 10);
    expect((await Promise.all(calls)).every((answer) => answer.success)).toBe(true);
  });

  test("logs a busy read at warn and never as assistant_tool_failed", async () => {
    const warn = vi.spyOn(log, "warn").mockReturnValue(undefined as never);
    const error = vi.spyOn(log, "error").mockReturnValue(undefined as never);
    const deps = createProductToolsDependencies(ports({ slots: 0, slotWaitMs: 1 }));
    await deps.find({ by: "sku", sku: "x" }, access);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "assistant_product_reads_busy", tool: "ver_producto", companyId: access.companyId }), "assistant_product_reads_busy");
    expect(error).not.toHaveBeenCalled();
  });

  test("logs one assistant_tool_failed with the error code of a failed read", async () => {
    const error = vi.spyOn(log, "error").mockReturnValue(undefined as never);
    const deps = createProductToolsDependencies(ports({ search: async () => err({ code: "STATEMENT_TIMEOUT", message: "slow" }) }));
    const answer = await deps.search({ sort: "recent", page: 1, text: "polo" }, access);
    expect(!answer.success && answer.error.code).toBe("FAILURE");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith({ event: "assistant_tool_failed", companyId: access.companyId, connectionId: access.connectionId, tool: "buscar_productos", errorCode: "STATEMENT_TIMEOUT" }, "assistant_tool_failed");
    const described = createProductToolsDependencies(ports({ describe: async () => err(readFailure) }));
    expect((await described.find({ by: "sku", sku: "x" }, access)).success).toBe(false);
  });

  test("releases the slot when the read fails", async () => {
    vi.spyOn(log, "error").mockReturnValue(undefined as never);
    const deps = createProductToolsDependencies(ports({ search: async () => err(readFailure), slots: 1, slotWaitMs: 1 }));
    for (let call = 0; call < 3; call++) await deps.search({ sort: "recent", page: 1 }, access);
    expect((vi.mocked(log.error).mock.calls).length).toBe(3);
  });
});
