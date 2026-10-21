import { useEffect, useRef, useState, type CSSProperties } from "react";

type CheckoutBrandHeaderProps = Readonly<{ companyName: string; logoUrl: string | null }>;

/** The plate is always white; a theme sets its size and shape through variables, and the fallbacks are the default Yoyos look. */
const plate: CSSProperties = {
  height: "var(--checkout-logo-height, 2.5rem)",
  borderRadius: "var(--checkout-logo-radius, var(--radius-sm))",
  border: "var(--checkout-logo-border, 1px solid var(--border))",
  boxShadow: "var(--checkout-logo-shadow, none)",
  padding: "var(--checkout-logo-padding, 0.25rem 0.5rem)",
};

function BrandLogo({ url }: Readonly<{ url: string }>) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // The image can fail before React attaches `onError` during hydration.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return <span data-slot="brand-logo" style={plate} className="flex max-w-40 shrink-0 items-center bg-white">
    <img ref={image} src={url} alt="" className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
  </span>;
}

export function CheckoutBrandHeader({ companyName, logoUrl }: CheckoutBrandHeaderProps) {
  return <div data-checkout-part="header-brand" className="flex min-w-0 items-center gap-3">
    {logoUrl && <BrandLogo key={logoUrl} url={logoUrl} />}
    <p className="min-w-0 break-words font-semibold">{companyName}</p>
  </div>;
}
