import { useMemo } from "react";
import { View } from "react-native";
import QRCode from "qrcode";

type Props = Readonly<{ value: string; size?: number; accessibilityLabel: string }>;

/** Draws the QR matrix with plain views so no native drawing dependency is needed. */
export function QrCode({ value, size = 240, accessibilityLabel }: Props) {
  const rows = useMemo(() => {
    const code = QRCode.create(value, { errorCorrectionLevel: "L" });
    const count = code.modules.size;
    return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_unused, column) => code.modules.get(row, column) === 1));
  }, [value]);
  const quiet = 2;
  const cell = size / (rows.length + quiet * 2);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}
      style={{ width: size, height: size, padding: cell * quiet, backgroundColor: "#ffffff" }}>
      {rows.map((cells, row) => (
        <View key={row} style={{ flexDirection: "row", height: cell }}>
          {cells.map((dark, column) => <View key={column} style={{ width: cell, height: cell, backgroundColor: dark ? "#000000" : "#ffffff" }} />)}
        </View>
      ))}
    </View>
  );
}
