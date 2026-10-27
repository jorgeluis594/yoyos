import { useState } from "react";
import { useTranslation } from "react-i18next";
import { companyPath, languageForLocale, localizedPath } from "@core/app/locale";
import { log } from "@core/src/shared/infrastructure/logger";
import { data, isRouteErrorResponse, Link, redirect, useFetcher, useLoaderData, useLocation, useRevalidator, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageContainer } from "@/components/ui/page-container";
import { privateUserContext } from "@/private-user-context";
import { productEditing } from "@core/src/composition/product-editing";
import { productVariantActions } from "@core/src/composition/product-variant-actions";
import { toProductDetailResponse } from "@core/src/features/products/presentation/product-presenter";
import { saveErrors } from "@core/src/features/products/presentation/messages";
import { inDoubtOutcome, offlineOutcome, outcomeFor, parseVariantAction, type VariantIntent, type VariantOutcome } from "@core/src/features/products/presentation/variant-detail-model";
import { VariantDetail, type VariantBody } from "@core/src/features/products/presentation/variant-detail";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const productPath = (request: Request, country: string, productId: string) => companyPath(new URL(request.url).pathname, country, `/products/${productId}`);

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  if (!params.productId || !uuid.test(params.productId)) throw new Response("Not found", { status: 404 });
  const company = context.get(privateUserContext).company;
  const productHref = productPath(request, company.country, params.productId);
  try {
    const result = await productEditing.get(params.productId as ProductId);
    if (!result.success) throw new Response("La imagen no está disponible.", { status: 503 });
    // A product of another company looks the same as a missing one: nothing links back to it.
    if (!result.data) return data({ state: "missing" as const, productHref: null }, { status: 404 });
    const { product } = toProductDetailResponse(result.data);
    if (product.options.length === 0) return redirect(productHref);
    const variant = product.variants.find((candidate) => candidate.id === params.variantId);
    if (!variant) return data({ state: "missing" as const, productHref }, { status: 404 });
    return { state: "ready" as const, product, variant, productHref };
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    log.error({ event: "unable_to_load_product_variant", err: cause }, "unable_to_load_product_variant");
    throw new Response("No se pudo cargar la variante. Inténtalo de nuevo.", { status: 503 });
  }
}

/** The product as it is now, for the rejections whose text names a combination or a stock; `null` when it cannot be read. */
async function currentProduct(productId: ProductId) {
  try {
    const result = await productEditing.get(productId);
    return result.success && result.data ? toProductDetailResponse(result.data).product : null;
  } catch { return null; }
}

export async function action({ request, context, params }: ActionFunctionArgs): Promise<Response | VariantOutcome> {
  const language = languageForLocale(new URL(request.url).pathname.split("/")[1]);
  if (!params.productId || !uuid.test(params.productId) || !params.variantId || !uuid.test(params.variantId)) throw new Response("Not found", { status: 404 });
  const company = context.get(privateUserContext).company;
  const parsed = parseVariantAction(await request.text());
  if (!parsed.success) return { intent: "update", failed: true, errors: saveErrors(parsed.error, language) };
  const ids = { productId: params.productId as ProductId, variantId: params.variantId as VariantId };
  const { intent } = parsed.data;
  try {
    const result = parsed.data.intent === "update" ? await productVariantActions.update({ ...ids, ...parsed.data.request })
      : parsed.data.intent === "combination" ? await productVariantActions.changeCombination({ ...ids, values: parsed.data.request.values })
      : parsed.data.intent === "status" ? await productVariantActions.changeStatus({ ...ids, status: parsed.data.request.status })
      : await productVariantActions.delete(ids);
    if (result.success && intent === "delete") return redirect(`${productPath(request, company.country, ids.productId)}?variantDeleted=1`);
    const needsProduct = !result.success && (result.error.code === "DUPLICATE_COMBINATION" || result.error.code === "VARIANT_HAS_STOCK");
    return outcomeFor(intent, result, {
      product: needsProduct ? await currentProduct(ids.productId) : null, variantId: ids.variantId,
      ...(parsed.data.intent === "combination" ? { entries: parsed.data.request.values } : {}),
      ...(parsed.data.intent === "status" ? { status: parsed.data.request.status } : {}),
    }, language);
  } catch (cause) {
    log.error({ event: "unable_to_change_product_variant", intent, err: cause }, "unable_to_change_product_variant");
    return inDoubtOutcome(intent, language);
  }
}

// A request that never reached the server is a connection problem, not a rejection. Redirects and client errors keep their usual handling.
export async function clientAction({ request, serverAction }: ClientActionFunctionArgs): Promise<Response | VariantOutcome> {
  const sent = await request.clone().json().catch(() => ({})) as { intent?: VariantIntent; status?: "active" | "inactive" };
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    if (cause instanceof Response || isRouteErrorResponse(cause)) throw cause;
    return offlineOutcome(sent.intent ?? "update", sent.status, languageForLocale(new URL(request.url).pathname.split("/")[1]));
  }
}

// A rejected action leaves the form as it is: reloading is the seller's decision.
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: { actionResult?: unknown; defaultShouldRevalidate: boolean }) {
  return actionResult && typeof actionResult === "object" && "failed" in actionResult ? false : defaultShouldRevalidate;
}

export function HydrateFallback() {
  const { t } = useTranslation();
  return <PageContainer><p role="status" className="text-sm text-muted-foreground">{t("variantDetail.loading")}</p></PageContainer>;
}

export default function ProductVariant() {
  const { t } = useTranslation();
  const location = useLocation();
  const loaded = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof clientAction>();
  const revalidator = useRevalidator();
  const [sent, setSent] = useState<VariantBody>();
  const [reloads, setReloads] = useState(0);
  if (loaded.state === "missing") return <ErrorState title={t("variantDetail.missing")}
    action={<Button asChild variant="outline"><Link to={loaded.productHref ?? localizedPath(location.pathname, "/products")}>{loaded.productHref ? t("variantDetail.backToProduct") : t("variantDetail.backToProducts")}</Link></Button>} />;
  const { product, variant, productHref } = loaded;
  const outcome = fetcher.data && "intent" in fetcher.data ? fetcher.data : undefined;
  const busy = fetcher.state !== "idle";

  function submit(body: VariantBody) {
    setSent(body);
    void fetcher.submit(body as never, { method: "post", encType: "application/json" });
  }
  async function reload() {
    await revalidator.revalidate();
    setReloads((current) => current + 1);
  }

  return <VariantDetail key={`${reloads}:${variant.id}:${variant.salePrice.amount}:${variant.purchasePrice?.amount}:${variant.sku}:${variant.status}`} product={product} variant={variant} productHref={productHref}
    outcome={outcome} pending={busy && sent ? sent.intent : null} pendingStatus={sent?.intent === "status" ? sent.status as "active" | "inactive" : undefined} onSubmit={submit} onReload={reload} />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const location = useLocation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <ErrorState
    title={missing ? t("variantDetail.missing") : t("variantDetail.loadError")}
    action={<Button asChild variant="outline"><a href={missing ? localizedPath(location.pathname, "/products") : ""}>{missing ? t("variantDetail.backToProducts") : t("variantDetail.retry")}</a></Button>} />;
}
