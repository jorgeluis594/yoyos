/** Nearest-rank percentile of a list of numbers; 0 for an empty list. */
export function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(fraction * ordered.length) - 1))]!;
}
