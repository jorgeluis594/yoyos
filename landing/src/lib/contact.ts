import type { SiteConfig } from "@landing/src/config/site-config";

export function whatsappUrl(whatsapp: SiteConfig["whatsapp"]): string {
  const base = `https://wa.me/${whatsapp.number}`;
  return whatsapp.demoText === null ? base : `${base}?text=${encodeURIComponent(whatsapp.demoText)}`;
}

export function telUrl(phone: SiteConfig["phone"]): string {
  return `tel:${phone.number}`;
}
