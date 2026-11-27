import { useMemo } from "react";
import QRCode from "qrcode";

/** The QR as an SVG, drawn from its modules with the 4-module quiet zone of the mobile label. */
export function QrCode({ value, label, className }: Readonly<{ value: string; label: string; className?: string }>) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
    const runs: string[] = [];
    for (let row = 0; row < modules.size; row++) for (let col = 0; col < modules.size; col++) if (modules.get(row, col)) runs.push(`M${col + 4} ${row + 4}h1v1h-1z`);
    return { size: modules.size + 8, path: runs.join("") };
  }, [value]);
  return <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className={className}>
    <rect width={size} height={size} fill="#fff" /><path d={path} fill="#000" />
  </svg>;
}
