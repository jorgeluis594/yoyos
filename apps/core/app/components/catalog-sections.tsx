import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckoutBrandHeader } from "@core/src/features/checkout-appearance/presentation/checkout-brand-header";
import type { CatalogProduct } from "@core/src/features/products/domain/catalog-product";
import { formatCurrency } from "@core/app/format-currency";
import { Button } from "@core/app/components/ui/button";
import { cn } from "@core/app/lib/utils";
import type { Money } from "@shared/money";

export const catalogPage = "mx-auto w-full max-w-5xl px-4 sm:px-8";
export const catalogHeaders = { "Referrer-Policy": "no-referrer" };
export const catalogMeta = (title: string) => [{ title }, { name: "robots", content: "noindex, nofollow" }];

export const formatCatalogAmount = (money: Money) => formatCurrency(money.amount, money.currency, "es");
export const formatCatalogPrice = ({ kind, amount }: CatalogProduct["price"]) =>
  kind === "from" ? `Desde ${formatCatalogAmount(amount)}` : formatCatalogAmount(amount);

/** The catalog keeps the global Yoyos tokens: only the logo of the company's appearance reaches it, never a checkout theme. `cart` is the mount point for the cart button. */
export function CatalogShell({ logoUrl, storeName, cart, children }: Readonly<{
  logoUrl: string | null; storeName: string; cart?: ReactNode; children: ReactNode;
}>) {
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b bg-card"><div className={`${catalogPage} flex min-h-16 items-center justify-between gap-3 py-3`}>
      <CheckoutBrandHeader companyName={storeName} logoUrl={logoUrl} />{cart}
    </div></header>
    <main className={`${catalogPage} flex flex-col gap-4 py-6 pb-24`}>{children}</main>
  </div>;
}

/** Without photo, or when it fails to load, a neutral block with the initial; never a broken image. */
export function CatalogProductImage({ name, url, className }: Readonly<{ name: string; url: string | null; className?: string }>) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // The image can fail before React attaches `onError` during hydration.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0) setFailed(true);
  }, []);
  const frame = cn("aspect-square w-full overflow-hidden rounded-[var(--radius-card)] bg-muted", className);
  if (!url || failed) return <div className={cn(frame, "flex items-center justify-center text-4xl font-semibold text-muted-foreground")} aria-hidden="true">
    {name.trim().charAt(0).toUpperCase()}
  </div>;
  return <div className={frame}><img ref={image} src={url} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} /></div>;
}

export function CatalogMessage({ title, children }: Readonly<{ title: string; children?: ReactNode }>) {
  return <main className="mx-auto flex max-w-lg flex-col items-start gap-4 p-6"><h1 className="text-2xl font-semibold">{title}</h1>{children}</main>;
}

export function CatalogLoadError() {
  return <CatalogMessage title="No pudimos cargar el catálogo. Revisa tu conexión">
    {/* A full reload retries even when the failure happened during a client navigation. */}
    <Button asChild><a href="">Reintentar</a></Button>
  </CatalogMessage>;
}
