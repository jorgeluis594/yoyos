import { useTranslation } from "react-i18next";
import { companyPath, localizedPath } from "@core/app/locale";
import { formatCurrency } from "@core/app/format-currency";
import { log } from "@core/src/shared/infrastructure/logger";
import { isRouteErrorResponse, Link, useActionData, useLoaderData, useNavigation, useSubmit, useLocation, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { privateUserContext } from "@/private-user-context";
import { products } from "@core/src/features/products/composition";
import { parseUpdateJson } from "@core/src/features/products/presentation/input";
import { updateErrors, type FormErrors } from "@core/src/features/products/presentation/messages";
import { ProductForm, type ProductFormValues, type ProductImageSelection } from "@core/src/features/products/presentation/product-form";
import type { ProductId } from "@core/src/features/products/domain/product";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  if (!params.productId || !uuid.test(params.productId)) throw new Response("Not found", { status: 404 });
  const company = context.get(privateUserContext).company;
  try {
    const result = await products.get(params.productId as ProductId);
    if (!result.success) throw new Response("La imagen no está disponible.", { status: 503 });
    if (!result.data) throw new Response("Not found", { status: 404 });
    const { product } = result.data;
    const variant = product.variants.length === 1 ? product.variants[0] : undefined;
    return {
      product,
      catalog: companyPath(new URL(request.url).pathname, company.country, "/products"),
      imageUrl: result.data.image?.url,
      variantId: variant?.id,
      saved: new URL(request.url).searchParams.get("saved") === "1",
      stock: product.variants.reduce((sum, item) => sum + item.stock.quantity, 0),
      values: {
        name: product.name,
        description: product.description ?? "",
        sku: variant?.sku ?? "",
        salePrice: variant ? String(variant.salePrice.amount) : "",
        purchasePrice: variant?.purchasePrice ? String(variant.purchasePrice.amount) : "",
        initialStock: "",
      } satisfies ProductFormValues,
    };
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    log.error({ event: "unable_to_load_product", err: cause }, "unable_to_load_product");
    throw new Response("No se pudo cargar el producto. Inténtalo de nuevo.", { status: 503 });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs): Promise<Response | { errors: FormErrors }> {
  if (!params.productId || !uuid.test(params.productId)) throw new Response("Not found", { status: 404 });
  const parsed = parseUpdateJson(await request.text());
  if (!parsed.success) return { errors: updateErrors(parsed.error) };
  const company = context.get(privateUserContext).company;
  try {
    const result = await products.update(params.productId as ProductId, parsed.data);
    if (!result.success) return { errors: updateErrors(result.error) };
    return redirect(`${companyPath(new URL(request.url).pathname, company.country, `/products/${result.data}`)}?saved=1`);
  } catch (cause) {
    log.error({ event: "unable_to_update_product", err: cause }, "unable_to_update_product");
    return { errors: { form: "No se pudo guardar el producto. Inténtalo de nuevo." } };
  }
}

export default function ProductDetail() {
  const { t, i18n } = useTranslation();
  const { product, catalog, values, stock, variantId, imageUrl, saved } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const errors = actionData && "errors" in actionData ? actionData.errors : {};
  const pending = navigation.state === "submitting";

  function save(next: ProductFormValues, image: ProductImageSelection) {
    submit({
      name: next.name,
      description: next.description === "" ? null : next.description,
      ...(image.kind === "set" ? { imageId: image.id } : image.kind === "remove" ? { imageId: null } : {}),
      ...(variantId === undefined ? {} : { variants: [{
        id: variantId,
        sku: next.sku === "" ? null : next.sku,
        salePrice: Number(next.salePrice),
        purchasePrice: next.purchasePrice === "" ? null : Number(next.purchasePrice),
      }] }),
    }, { method: "post", encType: "application/json", action: `${catalog}/${product.id}` });
  }

  return <PageContainer>
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{product.name}</PageHeader.Title>
      </PageHeader.Heading>
      <PageHeader.Actions><Button asChild variant="outline"><Link to={catalog}>{t("products.backProducts")}</Link></Button></PageHeader.Actions>
    </PageHeader>
    {saved && <p role="status" className="mt-5 text-sm">{t("products.saved")}</p>}
    <ProductForm currency={product.currency} cancelTo={catalog} errors={errors} pending={pending} values={values} variantFields={variantId ? "editable" : "hidden"} stock={stock} submitLabel={t("products.saveChanges")} imageUrl={imageUrl} onSave={save} variants={variantId ? undefined : <section aria-labelledby="variants-heading">
      <h2 id="variants-heading" className="text-base font-semibold">{t("products.variants")}</h2>
      <div className="mt-3 grid gap-3">{product.variants.map((variant, index) => <Card key={variant.id} role="article" className="p-4">
        <h3 className="font-medium">{t("products.variant", { number: index + 1 })}</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          {Object.entries(variant.attributes).map(([name, value]) => <div key={name}><dt className="text-muted-foreground">{name}</dt><dd>{value}</dd></div>)}
          <div><dt className="text-muted-foreground">SKU</dt><dd>{variant.sku ?? t("products.noSku")}</dd></div>
          <div><dt className="text-muted-foreground">{t("products.salePrice")}</dt><dd>{formatCurrency(variant.salePrice.amount, variant.salePrice.currency, i18n.language)}</dd></div>
          <div><dt className="text-muted-foreground">{t("products.purchasePrice")}</dt><dd>{variant.purchasePrice ? formatCurrency(variant.purchasePrice.amount, variant.purchasePrice.currency, i18n.language) : t("products.noPrice")}</dd></div>
          <div><dt className="text-muted-foreground">{t("products.stock")}</dt><dd>{variant.stock.quantity}</dd></div>
        </dl>
      </Card>)}</div>
    </section>} />
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
          <a href={missing ? localizedPath(location.pathname, "/dashboard") : ""}>{missing ? "Volver al inicio" : "Reintentar"}</a>
        </Button>
      }
    />
  );
}
