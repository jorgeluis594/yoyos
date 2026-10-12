// The zone name is only shown when option names alone would be ambiguous.
export function rateLabel(rate: Readonly<{ name: string; zoneName: string }>, rates: readonly Readonly<{ name: string }>[]): string {
  return rates.filter(other => other.name === rate.name).length > 1 ? `${rate.name} · ${rate.zoneName}` : rate.name;
}

export const agencyLabel = (agency: Readonly<{ name: string; address: string; courier: Readonly<{ name: string }>; location: Readonly<{ district: string }> }>) =>
  `${agency.name} · ${agency.courier.name} · ${agency.location.district} · ${agency.address}`;
