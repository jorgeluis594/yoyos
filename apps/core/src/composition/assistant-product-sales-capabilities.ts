import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Currency } from "@shared/money";
import { orders } from "@core/src/features/orders";
import { products } from "@core/src/features/products/composition";
import { catalogStorefront, type StorefrontState } from "@core/src/features/catalog";
import type { ProductId } from "@core/src/features/products/domain/product";
import { authIssuer } from "@core/src/shared/infrastructure/auth";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";
import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";
import { periodDays, windowOf } from "@core/src/features/assistants/domain/sales-period";
import { createBestSellersTool, type BestSellersAnswer, type BestSellersDependencies, type BestSellersRequest } from "@core/src/features/assistants/presentation/tools/best-sellers-tool";
import { createUnsoldProductsTool, type UnsoldProductsAnswer, type UnsoldProductsDependencies, type UnsoldProductsRequest } from "@core/src/features/assistants/presentation/tools/unsold-products-tool";
import { salesRead, type SalesOperation, type SalesStep } from "@core/src/composition/assistant-sales-capabilities";

type ReadError = Readonly<{ code: string; message: string }>;
type SalesRead = <T, E extends ReadError>(operation: SalesOperation, access: AssistantAccess, days: number, work: (step: SalesStep) => Promise<Result<T, E>>) => Promise<Result<T, ToolRunError>>;

/** What the product sales tools need of orders, products and catalog; `productSalesTools` binds the composed operations, tests bind fakes. */
export type ProductSalesPorts = Readonly<{
  salesRead: SalesRead;
  describeStore: (companyId: AssistantAccess["companyId"]) => Promise<Result<StorefrontState, ReadError>>;
  soldVariants: typeof orders.summarizeSoldVariants;
  saleDates: typeof orders.findVariantSaleDates;
  describeVariants: typeof products.describeVariantsForAssistant;
  listStocked: typeof products.listStockedForAssistant;
  appLink: (productId: string) => string;
  clock: () => Date;
}>;

/**
 * Joins the orders reads (what sold, and when) with the products reads (names, combinations, stock) in memory, by variant id, inside one sales snapshot.
 * Orders never learns product names and products never reads orders; each read is wrapped in `step` so the guard knows which one was running on a timeout.
 */
export function createProductSalesDependencies(ports: ProductSalesPorts): Readonly<{ bestSellers: BestSellersDependencies; unsold: UnsoldProductsDependencies }> {
  const orderAccess = (access: AssistantAccess) => ({ companyId: access.companyId, userId: access.userId });

  async function readBestSellers(request: BestSellersRequest, access: AssistantAccess) {
    const window = windowOf(request.period);
    return ports.salesRead("best_sellers", access, periodDays(request.period), async (step): Promise<Result<BestSellersAnswer, ReadError>> => {
      const store = await step("storefront", "catalog", () => ports.describeStore(access.companyId));
      if (!store.success) return store;
      const storeCurrency: Currency = store.data.currency;
      if (request.kind === "product") {
        const described = await step("descriptions", "catalog", () => ports.describeVariants({ by: "product", productId: request.productId as ProductId }));
        if (!described.success) return described;
        // An unknown or foreign product has no row: the not-found answer, and no order is read.
        if (described.data.length === 0) return ok({ kind: "product_not_found" });
        const sold = await step("sold_variants", "period", () => ports.soldVariants({ window, variantIds: described.data.map((variant) => variant.variantId) }, orderAccess(access)));
        if (!sold.success) return sold;
        return ok({ kind: "sold", storeCurrency, sold: sold.data, described: described.data });
      }
      const sold = await step("sold_variants", "period", () => ports.soldVariants({ window }, orderAccess(access)));
      if (!sold.success) return sold;
      const described = await step("descriptions", "catalog", () => ports.describeVariants({
        by: "variants", variantIds: sold.data.variants.map((variant) => variant.variantId), ...request.text === undefined ? {} : { text: request.text },
      }));
      if (!described.success) return described;
      return ok({ kind: "sold", storeCurrency, sold: sold.data, described: described.data });
    });
  }

  async function readUnsold(request: UnsoldProductsRequest & Readonly<{ needFirstAfter: boolean }>, access: AssistantAccess) {
    const window = windowOf(request.period);
    return ports.salesRead("unsold", access, periodDays(request.period), async (step): Promise<Result<UnsoldProductsAnswer, ReadError>> => {
      const stocked = await step("stocked", "catalog", () => ports.listStocked({ createdBefore: window.before, ...request.text === undefined ? {} : { text: request.text } }));
      if (!stocked.success) return stocked;
      const { checked, storeHasProducts, matching, withStock } = stocked.data;
      const variantIds = checked.flatMap((product) => product.variantIds);
      // Nothing checked answers its empty text without reading any order.
      const dates = variantIds.length === 0 ? ok([] as const)
        : await step("item_dates", "catalog", () => ports.saleDates({ window, variantIds, needFirstAfter: request.needFirstAfter }, orderAccess(access)));
      if (!dates.success) return dates;
      return ok({ storeHasProducts, matching, withStock, checked, dates: dates.data });
    });
  }

  return {
    bestSellers: { clock: ports.clock, appLink: ports.appLink, read: readBestSellers },
    unsold: { clock: ports.clock, appLink: ports.appLink, read: readUnsold },
  };
}

export function createProductSalesTools(ports: ProductSalesPorts): ToolModule["tools"] {
  const { bestSellers, unsold } = createProductSalesDependencies(ports);
  return [createBestSellersTool(bestSellers), createUnsoldProductsTool(unsold)];
}

/** The best-sellers and unsold-products tools, bound to the real reads. */
export const productSalesTools: ToolModule["tools"] = createProductSalesTools({
  salesRead,
  describeStore: (companyId) => catalogStorefront.describe(companyId),
  soldVariants: (input, access) => orders.summarizeSoldVariants(input, access),
  saleDates: (input, access) => orders.findVariantSaleDates(input, access),
  describeVariants: (input) => products.describeVariantsForAssistant(input),
  listStocked: (input) => products.listStockedForAssistant(input),
  appLink: (productId) => `${authIssuer}/products/${productId}`,
  clock: () => new Date(),
});
