import { forwardRef, useImperativeHandle, useRef } from "react";
import { QrCode } from "@core/app/components/qr-code";

export type LabelHandle = Readonly<{ fits: () => boolean }>;

const printStyles = `
@media screen { #variant-label { position: absolute; left: -9999px; top: 0; } }
@media print {
  @page { size: 50mm 30mm; margin: 0; }
  body * { visibility: hidden; }
  #variant-label, #variant-label * { visibility: visible; }
  #variant-label { position: fixed; left: 0; top: 0; }
}`;

/**
 * The label the browser prints: product name, combination, SKU and QR, on 50 × 30 mm. It sits off screen so it can be measured:
 * `fits` is false when any line is cut, and the caller then does not print it.
 */
export const VariantLabel = forwardRef<LabelHandle, Readonly<{ productName: string; combination: string; sku: string | null; qrCode: string }>>(
  function VariantLabel({ productName, combination, sku, qrCode }, ref) {
    const lines = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => ({
      fits: () => {
        const box = lines.current;
        return !box || [box, ...Array.from(box.children)].every((element) => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1);
      },
    }), []);
    return <>
      <style>{printStyles}</style>
      <div id="variant-label" aria-hidden="true" className="flex items-center gap-[1.5mm] bg-white p-[2mm] text-black" style={{ width: "50mm", height: "30mm", boxSizing: "border-box" }}>
        <QrCode value={qrCode} label={qrCode} className="h-[24mm] w-[24mm] shrink-0" />
        <div ref={lines} className="min-w-0 flex-1 overflow-hidden" style={{ maxHeight: "26mm", overflowWrap: "anywhere", lineHeight: 1.16 }}>
          <div style={{ fontSize: "9pt", fontWeight: 600, maxHeight: "8.5mm", overflow: "hidden" }}>{productName}</div>
          {combination !== "" && <div style={{ fontSize: "8pt", maxHeight: "8mm", overflow: "hidden" }}>{combination}</div>}
          {sku && <div style={{ fontSize: "8pt", maxHeight: "8mm", overflow: "hidden" }}>{sku}</div>}
        </div>
      </div>
    </>;
  });
