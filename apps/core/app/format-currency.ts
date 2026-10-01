export function formatCurrency(amount: number, currency: string, language: string): string {
  return new Intl.NumberFormat(language === "pt" ? "pt-BR" : "es-PE", {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}
