import { isRouteErrorResponse, Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Button } from "@/components/ui/button";
import { privateUserContext } from "@/private-user-context";
import { products } from "@core/src/features/products/composition";
import type { CompanyId, ProductId } from "@core/src/features/products/domain/product";

export async function loader({ context, params }: LoaderFunctionArgs) {
  if (!params.productId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.productId)) throw new Response("Not found", { status: 404 });
  const company = context.get(privateUserContext).company;
  try {
    const result = await products.get(company.id as CompanyId, params.productId as ProductId);
    if (!result.success) throw new Response("La imagen no está disponible.", { status: 503 });
    if (!result.data) throw new Response("Not found", { status: 404 });
    return { detail: result.data, catalog: `/es-${company.country}/products` };
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    console.error("Unable to load product", cause);
    throw new Response("No se pudo cargar el producto. Inténtalo de nuevo.", { status: 503 });
  }
}

export default function ProductDetail() {
  const { detail, catalog } = useLoaderData<typeof loader>();
  const { product, image } = detail;
  return <section className="mx-auto max-w-3xl">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Producto</p><h1 className="mt-1 break-words text-2xl font-semibold tracking-tight">{product.name}</h1></div>
      <Button asChild variant="outline"><Link to={catalog}>Volver a productos</Link></Button>
    </div>
    {image && <img src={image.url} alt={product.name} className="mt-6 max-h-80 w-full rounded-md object-contain" />}
    {product.description && <p className="mt-6 whitespace-pre-wrap text-sm leading-6">{product.description}</p>}
    <h2 className="mt-8 text-lg font-semibold">Variantes</h2>
    <div className="mt-3 flex flex-col gap-4">
      {product.variants.map((variant, index) => <article key={variant.id} className="rounded-md border border-border p-4">
        <h3 className="font-medium">Variante {index + 1}</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">SKU</dt><dd>{variant.sku ?? "Sin SKU"}</dd></div>
          <div><dt className="text-muted-foreground">Precio de venta</dt><dd>{variant.salePrice.amount.toFixed(2)} {variant.salePrice.currency}</dd></div>
          <div><dt className="text-muted-foreground">Precio de compra</dt><dd>{variant.purchasePrice ? `${variant.purchasePrice.amount.toFixed(2)} ${variant.purchasePrice.currency}` : "Sin precio"}</dd></div>
          <div><dt className="text-muted-foreground">Stock</dt><dd>{variant.stock.quantity}</dd></div>
          {Object.entries(variant.attributes).map(([name, value]) => <div key={name}><dt className="text-muted-foreground">{name}</dt><dd>{value}</dd></div>)}
        </dl>
      </article>)}
    </div>
  </section>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <section role="alert" className="mx-auto max-w-xl"><h1 className="text-2xl font-semibold">{missing ? "Producto no encontrado" : "No se pudo cargar el producto"}</h1><p className="mt-2 text-muted-foreground">{missing ? "No hay un producto disponible en esta dirección." : "Inténtalo de nuevo."}</p><Button asChild variant="outline" className="mt-5"><a href={missing ? "/dashboard" : ""}>{missing ? "Volver al inicio" : "Reintentar"}</a></Button></section>;
}
