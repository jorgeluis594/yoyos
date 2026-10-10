import { useEffect, useRef, useState } from "react";

type CheckoutBrandHeaderProps = Readonly<{ companyName: string; logoUrl: string | null }>;

function BrandLogo({ url }: Readonly<{ url: string }>) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // The image can fail before React attaches `onError` during hydration.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return <span data-slot="brand-logo" className="flex h-10 max-w-40 shrink-0 items-center rounded-sm border bg-white px-2 py-1">
    <img ref={image} src={url} alt="" className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
  </span>;
}

export function CheckoutBrandHeader({ companyName, logoUrl }: CheckoutBrandHeaderProps) {
  return <div className="flex min-w-0 items-center gap-3">
    {logoUrl && <BrandLogo key={logoUrl} url={logoUrl} />}
    <p className="min-w-0 break-words font-semibold">{companyName}</p>
  </div>;
}
