import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Money } from "@shared/money";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import { products, type AssistantReadOperation } from "@core/src/features/products/composition";
import { catalogStorefront, storeUrl, type StorefrontState } from "@core/src/features/catalog";
import type { Product, ProductId, VariantId } from "@core/src/features/products/domain/product";
import { stockLevelOf } from "@core/src/features/products/domain/stock-level";
import type { ProductSearchPage, SearchedProduct, SearchForAssistantError } from "@core/src/features/products/application/search-for-assistant";
import type { FoundProduct } from "@core/src/features/products/application/find-for-assistant";
import type { AssistantReadError } from "@core/src/features/products/application/assistant-read";
import { authIssuer } from "@core/src/shared/infrastructure/auth";
import { log } from "@core/src/shared/infrastructure/logger";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";
import type {
  ProductReferenceRequest, ProductSearchAnswer, ProductSearchRequest, ProductToolsDependencies,
} from "@core/src/features/assistants/presentation/tools/products-tools";
import { productReadFailureMessage } from "@core/src/features/assistants/presentation/tools/products-texts";
import type {
  ProjectableActive, ProjectableProduct, ProjectableProductSummary, ProjectableSku, ProjectableStorefront, ProjectableValueRejection,
} from "@core/src/features/assistants/domain/product-projection";

type ReadError = Readonly<{ code: string; message: string }>;
type Snapshot = <T, E extends ReadError>(work: () => Promise<Result<T, E>>, operation: AssistantReadOperation) => Promise<Result<T, E | AssistantReadError>>;

/** What the capabilities need of products and catalog; `productToolsDependencies` binds the composed operations, tests bind fakes. */
export type ProductCapabilityPorts = Readonly<{
  snapshot: Snapshot;
  describe: (companyId: AssistantAccess["companyId"]) => Promise<Result<StorefrontState, ReadError>>;
  search: (request: ProductSearchRequest) => Promise<Result<ProductSearchPage, SearchForAssistantError>>;
  find: (reference: ProductReferenceRequest) => Promise<Result<FoundProduct | null, AssistantReadError>>;
  storeUrl: (subdomain: string, path?: string) => string;
  appLink: (productId: string) => string;
  slots: number;                                // product reads in flight at once, per process
  slotWaitMs: number;                           // how long a call waits for a slot before answering the reading-failure text
}>;

/** A counting semaphore whose `acquire` gives up after `waitMs`; it runs before the transaction opens, so the wait is outside the transaction budget. */
function createSlots(count: number) {
  let free = count;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next(); else free += 1;
  };
  return {
    async acquire(waitMs: number): Promise<{ release: () => void; waitedMs: number } | null> {
      const started = Date.now();
      if (free > 0) { free -= 1; return { release, waitedMs: 0 }; }
      return new Promise((resolve) => {
        const grant = () => { clearTimeout(timer); resolve({ release, waitedMs: Date.now() - started }); };
        const timer = setTimeout(() => {
          const at = waiting.indexOf(grant);
          if (at >= 0) waiting.splice(at, 1);
          resolve(null);
        }, waitMs);
        waiting.push(grant);
      });
    },
  };
}

const failure = (): ToolRunError => ({ code: "FAILURE", message: productReadFailureMessage });

function projectRejection(rejection: Extract<SearchForAssistantError, { code: "VALUE_REJECTED" }>["rejection"]): ProjectableValueRejection {
  if (rejection.kind === "no_options") return rejection;
  const vocabulary = rejection.vocabulary.map(({ name, values }) => ({ name, values: values.map((value) => value.name) }));
  return { ...rejection, vocabulary };
}

const skuOf = (count: number, sku: string | null): ProjectableSku => (count === 1 ? { kind: "single", sku } : { kind: "several" });

function activeOf(product: Product): ProjectableActive {
  const active = product.variants.filter((variant) => variant.status === "active");
  const [first] = active;
  if (!first) return { kind: "none", sku: skuOf(product.variants.length, product.variants.map((variant) => variant.sku ?? null).filter((sku) => sku !== null).sort().at(-1) ?? null) };
  const prices = active.map((variant) => variant.salePrice.amount);
  const quantities = active.map((variant) => variant.stock.quantity);
  const totalStock = quantities.reduce((sum, quantity) => sum + quantity, 0);
  const minSalePrice: Money = { amount: Math.min(...prices), currency: first.salePrice.currency };
  return {
    kind: "some", minSalePrice, hasDifferentPrices: new Set(prices).size > 1, totalStock,
    soldOut: quantities.filter((quantity) => stockLevelOf(quantity) === "sold_out").length, low: quantities.filter((quantity) => stockLevelOf(quantity) === "low").length,
    onlyLevel: active.length === 1 ? stockLevelOf(totalStock) : null,
    sku: skuOf(active.length, active.map((variant) => variant.sku ?? null).filter((sku) => sku !== null).sort().at(-1) ?? null),
  };
}

function projectStorefront(state: StorefrontState, makeUrl: ProductCapabilityPorts["storeUrl"]): ProjectableStorefront {
  if (state.catalog.kind === "published") return { currency: state.currency, catalog: { kind: "published", storeLink: makeUrl(state.catalog.subdomain) } };
  return { currency: state.currency, catalog: { kind: state.catalog.kind } };
}

export function createProductToolsDependencies(ports: ProductCapabilityPorts): ProductToolsDependencies {
  const slots = createSlots(ports.slots);

  const customerLink = (state: StorefrontState, productId: string, currency: string, offered: boolean): string | null =>
    state.catalog.kind === "published" && offered && currency === state.currency ? ports.storeUrl(state.catalog.subdomain, `/productos/${productId}`) : null;

  function summaryOf(item: SearchedProduct, state: StorefrontState): ProjectableProductSummary {
    return {
      id: item.id, name: item.name, hidden: item.hidden, variantCount: item.variantCount, inactiveCount: item.inactiveCount, active: item.active,
      customerLink: customerLink(state, item.id, item.currency, !item.hidden && item.active.kind === "some"),
      matching: item.matching && { total: item.matching.total, variants: item.matching.variants.map(({ values, sku, salePrice, stock, level }) => ({ values, sku, salePrice, stock, level })) },
    };
  }

  function productOf(found: Product, searchedVariantId: VariantId | null, state: StorefrontState): ProjectableProduct {
    const active = activeOf(found);
    const valueName = (variant: Product["variants"][number]) => found.options.map((option) => option.values.find((value) => value.id === variant.combination[option.id])?.name ?? "");
    return {
      id: found.id, name: found.name, hidden: found.hidden, description: found.description ?? null,
      options: found.options.map((option) => ({ name: option.name, values: option.values.map((value) => value.name) })),
      active, customerLink: customerLink(state, found.id, found.currency, !found.hidden && active.kind === "some"),
      variants: found.variants.map((variant) => ({
        values: valueName(variant), sku: variant.sku ?? null, salePrice: variant.salePrice, stock: variant.stock.quantity, level: stockLevelOf(variant.stock.quantity),
        purchasePrice: variant.purchasePrice ?? null, isActive: variant.status === "active", searched: variant.id === searchedVariantId,
      })),
    };
  }

  /** Takes a slot, runs one budgeted snapshot, and turns any read failure into the logged reading-failure answer. */
  async function guarded<T>(tool: string, operation: AssistantReadOperation, access: AssistantAccess, work: () => Promise<Result<T, ReadError | SearchForAssistantError>>): Promise<Result<T, ToolRunError>> {
    const slot = await slots.acquire(ports.slotWaitMs);
    if (!slot) {
      log.warn({ event: "assistant_product_reads_busy", companyId: access.companyId, connectionId: access.connectionId, tool, waitedMs: ports.slotWaitMs }, "assistant_product_reads_busy");
      return err(failure());
    }
    try {
      // `work` answers the business refusals (VALUE_REJECTED and the like) as `ok` kinds before returning, so only read failures reach the snapshot as errors;
      // any other error code that got here is logged below with its own code and answered with the reading-failure text (the schema already stops INVALID_PRICE and INVALID_PAGE).
      const read = await ports.snapshot(work as () => Promise<Result<T, ReadError>>, operation);
      if (read.success) return read;
      log.error({ event: "assistant_tool_failed", companyId: access.companyId, connectionId: access.connectionId, tool, errorCode: read.error.code }, "assistant_tool_failed");
      return err(failure());
    } finally {
      slot.release();
    }
  }

  return {
    appLink: ports.appLink,
    async search(request, access) {
      return guarded<ProductSearchAnswer>("buscar_productos", "search", access, async () => {
        const described = await ports.describe(access.companyId);
        if (!described.success) return described;
        const state = described.data;
        const storefront = projectStorefront(state, ports.storeUrl);
        const found = await ports.search(request);
        if (found.success) {
          const { items, page, total, storeHasProducts } = found.data;
          return ok({ storefront, kind: "page", items: items.map((item) => summaryOf(item, state)), page, total, storeHasProducts });
        }
        switch (found.error.code) {
          case "PRICE_RANGE_REVERSED": return ok({ storefront, kind: "price_range_reversed" });
          case "VALUE_REJECTED": return ok({ storefront, kind: "value_rejected", rejection: projectRejection(found.error.rejection) });
          default: return found;
        }
      });
    },
    async find(reference, access) {
      return guarded("ver_producto", "detail", access, async () => {
        const described = await ports.describe(access.companyId);
        if (!described.success) return described;
        const state = described.data;
        const found = await ports.find(reference);
        if (!found.success) return found;
        const storefront = projectStorefront(state, ports.storeUrl);
        return ok({ storefront, product: found.data === null ? null : productOf(found.data.product, found.data.searchedVariantId, state) });
      });
    },
  };
}

export const productToolsDependencies: ProductToolsDependencies = createProductToolsDependencies({
  snapshot: (work, operation) => products.readForAssistant(work, operation),
  describe: (companyId) => catalogStorefront.describe(companyId),
  search: (request) => products.searchForAssistant(request),
  find: (reference) => products.findForAssistant(reference.by === "id" ? { by: "id", id: reference.id as ProductId } : reference),
  storeUrl: (subdomain, path) => storeUrl(subdomain as CatalogSubdomain, path).toString(),
  appLink: (productId) => `${authIssuer}/products/${productId}`,
  slots: 3, slotWaitMs: 300,
});
