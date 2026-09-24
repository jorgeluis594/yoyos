import { isRouteErrorResponse, Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
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
  return <PageContainer width="reader">
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>{product.name}</PageHeader.Title>
      </PageHeader.Heading>
      <PageHeader.Actions>
        <Button asChild><Link to={`${catalog}/${product.id}/edit`}>Editar</Link></Button>
        <Button asChild variant="outline"><Link to={catalog}>Volver a productos</Link></Button>
      </PageHeader.Actions>
    </PageHeader>
    {image && <img src={image.url} alt={product.name} className="mt-6 max-h-80 w-full rounded-md object-contain" />}
    {product.description && <p className="mt-6 whitespace-pre-wrap text-sm leading-6">{product.description}</p>}
    <h2 className="mt-8 text-lg font-semibold">Variantes</h2>
    <div className="mt-3 flex flex-col gap-4">
      {product.variants.map((variant, index) => <Card key={variant.id} role="article" className="p-4">
        <h3 className="font-medium">Variante {index + 1}</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">SKU</dt><dd>{variant.sku ?? "Sin SKU"}</dd></div>
          <div><dt className="text-muted-foreground">Precio de venta</dt><dd>{variant.salePrice.amount.toFixed(2)} {variant.salePrice.currency}</dd></div>
          <div><dt className="text-muted-foreground">Precio de compra</dt><dd>{variant.purchasePrice ? `${variant.purchasePrice.amount.toFixed(2)} ${variant.purchasePrice.currency}` : "Sin precio"}</dd></div>
          <div><dt className="text-muted-foreground">Stock</dt><dd>{variant.stock.quantity}</dd></div>
          {Object.entries(variant.attributes).map(([name, value]) => <div key={name}><dt className="text-muted-foreground">{name}</dt><dd>{value}</dd></div>)}
        </dl>
      </Card>)}
    </div>
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
