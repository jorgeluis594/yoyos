import { isRouteErrorResponse, Link, useActionData, useLoaderData, useNavigation, useSubmit, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
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
import type { CompanyId, ProductId } from "@core/src/features/products/domain/product";

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
      catalog: `/es-${company.country}/products`,
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
    console.error("Unable to load product", cause);
    throw new Response("No se pudo cargar el producto. Inténtalo de nuevo.", { status: 503 });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs): Promise<Response | { errors: FormErrors }> {
  if (!params.productId || !uuid.test(params.productId)) throw new Response("Not found", { status: 404 });
  const parsed = parseUpdateJson(await request.text());
  if (!parsed.success) return { errors: updateErrors(parsed.error) };
  const company = context.get(privateUserContext).company;
  try {
    const result = await products.update(company.id as CompanyId, params.productId as ProductId, parsed.data);
    if (!result.success) return { errors: updateErrors(result.error) };
    return redirect(`/es-${company.country}/products/${result.data}?saved=1`);
  } catch (cause) {
    console.error("Unable to update product", cause);
    return { errors: { form: "No se pudo guardar el producto. Inténtalo de nuevo." } };
  }
}

export default function ProductDetail() {
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
      <PageHeader.Actions><Button asChild variant="outline"><Link to={catalog}>Volver a productos</Link></Button></PageHeader.Actions>
    </PageHeader>
    {saved && <p role="status" className="mt-5 text-sm">Producto guardado correctamente.</p>}
    <ProductForm currency={product.currency} cancelTo={catalog} errors={errors} pending={pending} values={values} variantFields={variantId ? "editable" : "hidden"} stock={stock} submitLabel="Guardar cambios" imageUrl={imageUrl} onSave={save} variants={variantId ? undefined : <section aria-labelledby="variants-heading">
      <h2 id="variants-heading" className="text-base font-semibold">Variantes</h2>
      <div className="mt-3 grid gap-3">{product.variants.map((variant, index) => <Card key={variant.id} role="article" className="p-4">
        <h3 className="font-medium">Variante {index + 1}</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          {Object.entries(variant.attributes).map(([name, value]) => <div key={name}><dt className="text-muted-foreground">{name}</dt><dd>{value}</dd></div>)}
          <div><dt className="text-muted-foreground">SKU</dt><dd>{variant.sku ?? "Sin SKU"}</dd></div>
          <div><dt className="text-muted-foreground">Precio de venta</dt><dd>{variant.salePrice.amount.toFixed(2)} {variant.salePrice.currency}</dd></div>
          <div><dt className="text-muted-foreground">Precio de compra</dt><dd>{variant.purchasePrice ? `${variant.purchasePrice.amount.toFixed(2)} ${variant.purchasePrice.currency}` : "Sin precio"}</dd></div>
          <div><dt className="text-muted-foreground">Stock</dt><dd>{variant.stock.quantity}</dd></div>
        </dl>
      </Card>)}</div>
    </section>} />
  </PageContainer>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <ErrorState
      title={missing ? "Producto no encontrado" : "No se pudo cargar el producto"}
      description={missing ? "No hay un producto disponible en esta dirección." : "Inténtalo de nuevo."}
      action={
        <Button asChild variant="outline">
          <a href={missing ? "/dashboard" : ""}>{missing ? "Volver al inicio" : "Reintentar"}</a>
        </Button>
      }
    />
  );
}
