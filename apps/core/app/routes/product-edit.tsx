import { isRouteErrorResponse, useActionData, useLoaderData, useNavigation, useSubmit, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { Button } from "@/components/ui/button";
import { privateUserContext } from "@/private-user-context";
import { products } from "@core/src/features/products/composition";
import { parseUpdateJson } from "@core/src/features/products/presentation/input";
import { updateErrors, type FormErrors } from "@core/src/features/products/presentation/messages";
import { ProductForm, type ProductFormValues } from "@core/src/features/products/presentation/product-form";
import type { CompanyId, ProductId } from "@core/src/features/products/domain/product";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loader({ context, params }: LoaderFunctionArgs) {
  if (!params.productId || !uuid.test(params.productId)) throw new Response("Not found", { status: 404 });
  const company = context.get(privateUserContext).company;
  try {
    const result = await products.get(company.id as CompanyId, params.productId as ProductId);
    if (!result.success) throw new Response("La imagen no está disponible.", { status: 503 });
    if (!result.data) throw new Response("Not found", { status: 404 });
    const { product } = result.data;
    const single = product.variants.length === 1;
    const variant = product.variants[0];
    return {
      detail: `/es-${company.country}/products/${product.id}`,
      currency: product.currency,
      variantId: single ? variant.id : undefined,
      variantFields: single ? ("editable" as const) : ("hidden" as const),
      stock: product.variants.reduce((sum, item) => sum + item.stock.quantity, 0),
      values: {
        name: product.name,
        description: product.description ?? "",
        sku: single ? variant.sku ?? "" : "",
        salePrice: single ? String(variant.salePrice.amount) : "",
        purchasePrice: single && variant.purchasePrice ? String(variant.purchasePrice.amount) : "",
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
    return redirect(`/es-${company.country}/products/${result.data}`);
  } catch (cause) {
    console.error("Unable to update product", cause);
    return { errors: { form: "No se pudo guardar el producto. Inténtalo de nuevo." } };
  }
}

export default function ProductEdit() {
  const { detail, currency, values, variantFields, stock, variantId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const errors = actionData && "errors" in actionData ? actionData.errors : {};
  const pending = navigation.state === "submitting";

  function save(next: ProductFormValues) {
    submit({
      name: next.name,
      description: next.description === "" ? null : next.description,
      ...(variantId === undefined ? {} : { variants: [{
        id: variantId,
        sku: next.sku === "" ? null : next.sku,
        salePrice: Number(next.salePrice),
        purchasePrice: next.purchasePrice === "" ? null : Number(next.purchasePrice),
      }] }),
    }, { method: "post", encType: "application/json" });
  }

  return <section className="mx-auto max-w-2xl">
    <h1 className="text-2xl font-semibold tracking-tight">Editar producto</h1>
    <p className="mt-2 text-sm text-muted-foreground">Actualiza los datos del producto.</p>
    <ProductForm currency={currency} cancelTo={detail} errors={errors} pending={pending} values={values} variantFields={variantFields} stock={stock} submitLabel="Guardar cambios" onSave={save} />
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <section role="alert" className="mx-auto max-w-xl"><h1 className="text-2xl font-semibold">{missing ? "Producto no encontrado" : "No se pudo cargar el producto"}</h1><p className="mt-2 text-muted-foreground">{missing ? "No hay un producto disponible en esta dirección." : "Inténtalo de nuevo."}</p><Button asChild variant="outline" className="mt-5"><a href={missing ? "/dashboard" : ""}>{missing ? "Volver al inicio" : "Reintentar"}</a></Button></section>;
}
