// The zone name is only shown when option names alone would be ambiguous.
export function rateLabel(rate: Readonly<{ name: string; zoneName: string }>, rates: readonly Readonly<{ name: string }>[]): string {
  return rates.filter(other => other.name === rate.name).length > 1 ? `${rate.name} · ${rate.zoneName}` : rate.name;
}
