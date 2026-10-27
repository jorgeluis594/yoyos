import { useState } from "react";
import { useTranslation } from "react-i18next";
import { companyPath, languageForLocale, localizedPath } from "@core/app/locale";
import resources from "@core/app/locales";
import { log } from "@core/src/shared/infrastructure/logger";
import { isRouteErrorResponse, Link, useActionData, useLoaderData, useLocation, useNavigation, useRevalidator, useSubmit, redirect, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { privateUserContext } from "@/private-user-context";
import { saveProductRequestSchema } from "@shared/contracts/products";
import { buildSaveProductBody, draftFromProduct } from "@shared/product-variants";
import { productEditing } from "@core/src/composition/product-editing";
import { toProductDetailResponse } from "@core/src/features/products/presentation/product-presenter";
import { parseRequestJson, toSaveInput } from "@core/src/features/products/presentation/request-input";
import { saveFeedback, type SaveFeedback } from "@core/src/features/products/presentation/messages";
import { ProductForm, type ProductFormSubmission, type ProductFormValues } from "@core/src/features/products/presentation/product-form";
import type { ProductId } from "@core/src/features/products/domain/product";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  if (!params.productId || !uuid.test(params.productId)) throw new Response("Not found", { status: 404 });
  const company = context.get(privateUserContext).company;
  try {
    const result = await productEditing.get(params.productId as ProductId);
    if (!result.success) throw new Response("La imagen no está disponible.", { status: 503 });
    if (!result.data) throw new Response("Not found", { status: 404 });
    const detail = toProductDetailResponse(result.data);
    return {
      product: detail.product,
      catalog: companyPath(new URL(request.url).pathname, company.country, "/products"),
      imageUrl: detail.image?.url,
      saved: new URL(request.url).searchParams.get("saved") === "1",
    };
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    log.error({ event: "unable_to_load_product", err: cause }, "unable_to_load_product");
    throw new Response("No se pudo cargar el producto. Inténtalo de nuevo.", { status: 503 });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs): Promise<Response | SaveFeedback> {
  const language = languageForLocale(new URL(request.url).pathname.split("/")[1]);
  if (!params.productId || !uuid.test(params.productId)) throw new Response("Not found", { status: 404 });
  const parsed = parseRequestJson(saveProductRequestSchema, await request.text(), "Invalid product update");
  if (!parsed.success) return saveFeedback(parsed.error, language);
  const company = context.get(privateUserContext).company;
  try {
    const result = await productEditing.save(toSaveInput(params.productId as ProductId, parsed.data));
    if (!result.success) return saveFeedback(result.error, language);
    return redirect(`${companyPath(new URL(request.url).pathname, company.country, `/products/${result.data.product.id}`)}?saved=1`);
  } catch (cause) {
    log.error({ event: "unable_to_update_product", err: cause }, "unable_to_update_product");
    return { errors: { inDoubt: resources[language].translation.productEditor.inDoubtSave }, issues: [] };
  }
}

// A request that never reached the server is a connection problem, not a rejection. Redirects and client errors keep their usual handling.
export async function clientAction({ request, serverAction }: ClientActionFunctionArgs): Promise<Response | SaveFeedback> {
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    if (cause instanceof Response || isRouteErrorResponse(cause)) throw cause;
    const language = languageForLocale(new URL(request.url).pathname.split("/")[1]);
    return { errors: { form: resources[language].translation.productEditor.offline }, issues: [] };
  }
}

// A rejected save leaves the form as it is: reloading is the seller's decision.
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: { actionResult?: unknown; defaultShouldRevalidate: boolean }) {
  return actionResult && typeof actionResult === "object" && "errors" in actionResult ? false : defaultShouldRevalidate;
}

export default function ProductDetail() {
  const { t } = useTranslation();
  const { product, catalog, imageUrl, saved } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof clientAction>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [reloads, setReloads] = useState(0);
  const [dismissed, setDismissed] = useState<unknown>();
  const feedback = actionData && "errors" in actionData && actionData !== dismissed ? actionData : undefined;
  const pending = navigation.state === "submitting";
  const single = product.options.length === 0 ? product.variants[0] : undefined;
  const values: ProductFormValues = {
    name: product.name, description: product.description ?? "", sku: single?.sku ?? "",
    salePrice: single ? single.salePrice.amount.toFixed(2) : "", purchasePrice: single?.purchasePrice ? String(single.purchasePrice.amount) : "", initialStock: "",
  };
  const originalNames = Object.fromEntries(product.options.flatMap((option) => [[option.id, option.name], ...option.values.map((value) => [value.id, value.name])]));

  function save({ values: next, image, draft }: ProductFormSubmission) {
    submit(buildSaveProductBody(draft, {
      structureVersion: product.structureVersion, name: next.name, description: next.description === "" ? null : next.description,
      imageId: image.kind === "set" ? image.id : image.kind === "remove" ? null : product.imageId,
    }), { method: "put", encType: "application/json", action: `${catalog}/${product.id}` });
  }

  async function reload() {
    setDismissed(actionData);
    await revalidator.revalidate();
    setReloads((current) => current + 1);
  }

  return <PageContainer>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{product.name}</PageHeader.Title>
      </PageHeader.Heading>
      <PageHeader.Actions><Button asChild variant="outline"><Link to={catalog}>{t("products.backProducts")}</Link></Button></PageHeader.Actions>
    </PageHeader>
    {saved && <Alert variant="success" className="mt-5"><AlertDescription>{t("products.saved")}</AlertDescription></Alert>}
    <ProductForm key={`${product.updatedAt}:${product.structureVersion}:${reloads}`} currency={product.currency} cancelTo={catalog} feedback={feedback} pending={pending} values={values}
      draft={draftFromProduct(product)} originalNames={originalNames} submitLabel={t("products.saveChanges")} imageUrl={imageUrl} onSave={save} onReload={reload} />
  </PageContainer>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const location = useLocation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <ErrorState
      title={missing ? t("products.missing") : t("products.loadProductError")}
      description={missing ? t("products.missingDescription") : t("common.retry")}
      action={
        <Button asChild variant="outline">
          <a href={missing ? localizedPath(location.pathname, "/dashboard") : ""}>{missing ? t("products.backHome") : t("products.retry")}</a>
        </Button>
      }
    />
  );
}
