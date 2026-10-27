import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import QRCode from "qrcode";

const QUIET = 2;

/** The variant's QR as dark runs per row, so a code costs one view per run instead of one per module. */
export function VariantQr({ value, size = 112, label }: { value: string; size?: number; label: string }) {
  const rows = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
    return Array.from({ length: modules.size }, (_, row) => {
      const runs: { start: number; length: number }[] = [];
      for (let col = 0; col < modules.size; col++) {
        if (!modules.get(row, col)) continue;
        const last = runs[runs.length - 1];
        if (last && last.start + last.length === col) last.length += 1; else runs.push({ start: col, length: 1 });
      }
      return { row, runs, count: modules.size };
    });
  }, [value]);
  const count = rows[0]?.count ?? 1;
  const cell = size / (count + 2 * QUIET);
  return <View accessible accessibilityRole="image" accessibilityLabel={label} style={[styles.code, { width: size, height: size }]}>
    {rows.map(({ row, runs }) => runs.map((run) => <View key={`${row}-${run.start}`}
      style={{ position: "absolute", backgroundColor: "#000000", left: (run.start + QUIET) * cell, top: (row + QUIET) * cell, width: run.length * cell, height: cell }} />))}
  </View>;
}

const styles = StyleSheet.create({ code: { backgroundColor: "#FFFFFF" } });
