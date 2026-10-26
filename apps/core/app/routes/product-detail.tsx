import { useTranslation } from "react-i18next";
import { companyPath, languageForLocale, localizedPath } from "@core/app/locale";
import resources from "@core/app/locales";
import { formatCurrency } from "@core/app/format-currency";
import { log } from "@core/src/shared/infrastructure/logger";
import { isRouteErrorResponse, Link, useActionData, useLoaderData, useNavigation, useSubmit, useLocation, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionDetails, DescriptionItem, DescriptionList, DescriptionTerm } from "@/components/ui/description-list";
import { ErrorState } from "@/components/ui/error-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { privateUserContext } from "@/private-user-context";
import { updateProductRequestSchema } from "@shared/contracts/products";
import { combinationLabel } from "@shared/product-variants";
import { products } from "@core/src/features/products/composition";
import { productEditing } from "@core/src/composition/product-editing";
import { parseRequestJson, toUpdateInput } from "@core/src/features/products/presentation/request-input";
import { updateErrors, type FormErrors } from "@core/src/features/products/presentation/messages";
import { ProductForm, type ProductFormValues, type ProductImageSelection } from "@core/src/features/products/presentation/product-form";
import type { ProductId } from "@core/src/features/products/domain/product";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  if (!params.productId || !uuid.test(params.productId)) throw new Response("Not found", { status: 404 });
  const company = context.get(privateUserContext).company;
  try {
    const result = await productEditing.get(params.productId as ProductId);
    if (!result.success) throw new Response("La imagen no está disponible.", { status: 503 });
    if (!result.data) throw new Response("Not found", { status: 404 });
    const { product } = result.data;
    const variant = product.variants.length === 1 ? product.variants[0] : undefined;
    return {
      product: { id: product.id, name: product.name, currency: product.currency, variants: product.variants.map((item) => ({
        id: item.id, sku: item.sku, salePrice: item.salePrice, purchasePrice: item.purchasePrice, stock: item.stock,
        label: combinationLabel(product.options, item.combination),
        // Option name to value name, in saved option order.
        attributes: product.options.flatMap((option) => option.values.filter((value) => value.id === item.combination[option.id]).map((value) => ({ name: option.name, value: value.name }))),
      })) },
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
  const language = languageForLocale(new URL(request.url).pathname.split("/")[1]);
  if (!params.productId || !uuid.test(params.productId)) throw new Response("Not found", { status: 404 });
  const parsed = parseRequestJson(updateProductRequestSchema, await request.text(), "Invalid product update");
  if (!parsed.success) return { errors: updateErrors(parsed.error, language) };
  const company = context.get(privateUserContext).company;
  try {
    const result = await products.update(params.productId as ProductId, toUpdateInput(parsed.data));
    if (!result.success) return { errors: updateErrors(result.error, language) };
    return redirect(`${companyPath(new URL(request.url).pathname, company.country, `/products/${result.data}`)}?saved=1`);
  } catch (cause) {
    log.error({ event: "unable_to_update_product", err: cause }, "unable_to_update_product");
    return { errors: { form: resources[language].translation.productErrors.saveError } };
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
    {saved && <Alert variant="success" className="mt-5"><AlertDescription>{t("products.saved")}</AlertDescription></Alert>}
    <ProductForm currency={product.currency} cancelTo={catalog} errors={errors} pending={pending} values={values} variantFields={variantId ? "editable" : "hidden"} stock={stock} submitLabel={t("products.saveChanges")} imageUrl={imageUrl} onSave={save} variants={variantId ? undefined : <section aria-labelledby="variants-heading">
      <h2 id="variants-heading" className="text-base font-semibold">{t("products.variants")}</h2>
      <div className="mt-3 grid gap-3">{product.variants.map((variant, index) => <Card key={variant.id} role="article">
        <CardHeader><CardTitle className="text-base font-medium">{variant.label || t("products.variant", { number: index + 1 })}</CardTitle></CardHeader>
        <CardContent>
          <DescriptionList orientation="vertical" className="grid gap-3 sm:grid-cols-2">
            {variant.attributes.map(({ name, value }) => <DescriptionItem key={name}><DescriptionTerm>{name}</DescriptionTerm><DescriptionDetails>{value}</DescriptionDetails></DescriptionItem>)}
            <DescriptionItem><DescriptionTerm>SKU</DescriptionTerm><DescriptionDetails>{variant.sku ?? t("products.noSku")}</DescriptionDetails></DescriptionItem>
            <DescriptionItem><DescriptionTerm>{t("products.salePrice")}</DescriptionTerm><DescriptionDetails>{formatCurrency(variant.salePrice.amount, variant.salePrice.currency, i18n.language)}</DescriptionDetails></DescriptionItem>
            <DescriptionItem><DescriptionTerm>{t("products.purchasePrice")}</DescriptionTerm><DescriptionDetails>{variant.purchasePrice ? formatCurrency(variant.purchasePrice.amount, variant.purchasePrice.currency, i18n.language) : t("products.noPrice")}</DescriptionDetails></DescriptionItem>
            <DescriptionItem><DescriptionTerm>{t("products.stock")}</DescriptionTerm><DescriptionDetails>{variant.stock.quantity}</DescriptionDetails></DescriptionItem>
          </DescriptionList>
        </CardContent>
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
          <a href={missing ? localizedPath(location.pathname, "/dashboard") : ""}>{missing ? t("products.backHome") : t("products.retry")}</a>
        </Button>
      }
    />
  );
}
