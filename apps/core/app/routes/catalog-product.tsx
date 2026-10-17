import { useState } from "react";
import { data, isRouteErrorResponse, Link, useLoaderData, useLocation, useNavigate, useParams, type LoaderFunctionArgs, type MetaArgs } from "react-router";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { catalogPathSchema, catalogProductPathSchema } from "@core/src/features/catalog/presentation/browse-schemas";
import { optionState, selectedVariant, type VariantSelection } from "@core/src/features/catalog/presentation/variant-selection";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { CatalogLoadError, CatalogMessage, CatalogProductImage, CatalogShell, catalogHeaders, catalogMeta, formatCatalogAmount, formatCatalogPrice } from "@core/app/components/catalog-sections";
import { Button } from "@core/app/components/ui/button";

const productUnavailable = "product";
export const headers = () => catalogHeaders;
export const meta = ({ data: page }: MetaArgs<typeof loader>) => catalogMeta(page ? `${page.product.name} · ${page.storeName}` : "Catálogo no disponible");

export async function loader({ params }: LoaderFunctionArgs) {
  bindRequestOperation({ operation: "get_catalog_product" });
  const company = catalogPathSchema.safeParse(params);
  if (!company.success) throw data(null, { status: 404, headers: catalogHeaders });
  const path = catalogProductPathSchema.safeParse(params);
  if (!path.success) throw data(productUnavailable, { status: 404, headers: catalogHeaders });
  const result = await catalogBrowse.getProduct(path.data.productId, { companyId: path.data.companyId });
  if (!result.success) {
    const code = result.error.code;
    bindRequestOperation({ outcome: code === "CATALOG_UNAVAILABLE" || code === "PRODUCT_UNAVAILABLE" ? "unavailable" : "technical_failure" });
    if (code === "PRODUCT_UNAVAILABLE") throw data(productUnavailable, { status: 404, headers: catalogHeaders });
    throw data(null, { status: code === "CATALOG_UNAVAILABLE" ? 404 : 503, headers: catalogHeaders });
  }
  return data({ ...result.data, appearance: await catalogBrowse.appearance(path.data.companyId) }, { headers: catalogHeaders });
}

/** Returns to the list entry when coming from it, so search, pages and scroll come back as they were. */
function BackToCatalog() {
  const { companyId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const fromCatalog = (location.state as { fromCatalog?: boolean } | null)?.fromCatalog === true;
  return <Button asChild={!fromCatalog} variant="ghost" className="self-start" onClick={fromCatalog ? () => navigate(-1) : undefined}>
    {fromCatalog ? <span>Volver al catálogo</span> : <Link to={`/catalogo/${companyId}`}>Volver al catálogo</Link>}
  </Button>;
}

export default function CatalogProductPage() {
  const { storeName, appearance, product } = useLoaderData<typeof loader>();
  const [selection, setSelection] = useState<VariantSelection>({});
  const [quantity, setQuantity] = useState(1);
  const variant = selectedVariant(product, selection);
  const max = variant?.maxQuantity ?? 0;
  const shown = Math.max(1, Math.min(quantity, max));

  return <CatalogShell appearance={appearance} storeName={storeName}>
    <BackToCatalog />
    <article className="grid gap-6 md:grid-cols-2 md:gap-10">
      <CatalogProductImage name={product.name} url={product.imageUrl} />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-balance">{product.name}</h1>
          <p className="text-xl font-semibold">{variant ? formatCatalogAmount(variant.price) : formatCatalogPrice(product.price)}</p>
          {product.soldOut && <p className="text-sm font-medium text-muted-foreground">Agotado</p>}
        </div>
        {product.variants.length > 1 && product.attributes.map(({ name, values }) => <fieldset key={name} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{name}{selection[name] ? `: ${selection[name]}` : ""}</legend>
          <div className="flex flex-wrap gap-2">
            {values.map((value) => {
              const state = optionState(product, selection, name, value);
              return <Button key={value} type="button" variant={selection[name] === value ? "default" : "outline"} aria-pressed={selection[name] === value}
                disabled={state !== "available"} onClick={() => setSelection({ ...selection, [name]: value })}>
                {value}{state === "sold_out" && " · Agotado"}
              </Button>;
            })}
          </div>
        </fieldset>)}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium" id="quantity-label">Cantidad</span>
          <div className="flex items-center rounded-[var(--radius-control)] border" role="group" aria-labelledby="quantity-label">
            <Button type="button" variant="ghost" size="icon" aria-label="Quitar uno" disabled={shown <= 1} onClick={() => setQuantity(shown - 1)}>−</Button>
            <output className="w-8 text-center tabular-nums" aria-live="polite">{shown}</output>
            <Button type="button" variant="ghost" size="icon" aria-label="Agregar uno" disabled={shown >= max} onClick={() => setQuantity(shown + 1)}>+</Button>
          </div>
        </div>
        {/* Mount point for the cart: browsing only decides when adding is possible. */}
        <Button type="button" size="lg" className="h-11" disabled={!variant || max === 0}>Agregar al carrito</Button>
        {product.description && <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>}
      </div>
    </article>
  </CatalogShell>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const { companyId = "" } = useParams();
  if (isRouteErrorResponse(error) && error.status === 404 && error.data === productUnavailable) return <CatalogMessage title="Este producto ya no está disponible">
    <Button asChild><Link to={`/catalogo/${companyId}`}>Volver al catálogo</Link></Button>
  </CatalogMessage>;
  if (isRouteErrorResponse(error) && error.status === 404) return <CatalogMessage title="Catálogo no disponible" />;
  return <CatalogLoadError />;
}
