import type { SiteConfig } from "@landing/src/config/site-config";
import type { FaqEntry } from "@landing/src/content/faq";

export type JsonLdGraph = Readonly<{ "@context": "https://schema.org"; "@graph": readonly Record<string, unknown>[] }>;

const appDescription =
  "Sistema de pedidos por WhatsApp para emprendedores que venden por redes sociales en Perú: pedidos desde las fotos que te mandan por WhatsApp, catálogo, checkout con zonas, cobro con Yape, Plin o transferencia y rótulos para envíos por Shalom y Olva.";

function organization(config: SiteConfig): Record<string, unknown> {
  const sameAs = [config.social.tiktok, config.social.instagram].filter((url): url is string => url !== null);
  return {
    "@type": "Organization",
    "@id": `${config.siteUrl}/#organization`,
    name: "Yoyos",
    url: `${config.siteUrl}/`,
    logo: `${config.siteUrl}/logo-512.png`,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "sales",
      telephone: config.phone.number,
      areaServed: "PE",
      availableLanguage: "es",
    },
    ...(config.contactEmail === null ? {} : { email: config.contactEmail }),
    ...(sameAs.length === 0 ? {} : { sameAs }),
  };
}

function website(config: SiteConfig): Record<string, unknown> {
  return {
    "@type": "WebSite",
    "@id": `${config.siteUrl}/#website`,
    url: `${config.siteUrl}/`,
    name: "Yoyos",
    inLanguage: "es-PE",
    publisher: { "@id": `${config.siteUrl}/#organization` },
  };
}

function softwareApplication(config: SiteConfig): Record<string, unknown> {
  return {
    "@type": "SoftwareApplication",
    "@id": `${config.siteUrl}/#app`,
    name: "Yoyos",
    url: `${config.siteUrl}/`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Android",
    description: appDescription,
    inLanguage: "es-PE",
    areaServed: "PE",
    publisher: { "@id": `${config.siteUrl}/#organization` },
    offers: {
      "@type": "Offer",
      price: "50.00",
      priceCurrency: "PEN",
      availability: "https://schema.org/InStock",
      url: `${config.siteUrl}/#precio`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "50.00",
        priceCurrency: "PEN",
        billingDuration: "P1M",
        valueAddedTaxIncluded: false,
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
      },
    },
  };
}

function faqPage(config: SiteConfig, faq: readonly FaqEntry[]): Record<string, unknown> {
  return {
    "@type": "FAQPage",
    "@id": `${config.siteUrl}/#preguntas`,
    mainEntity: faq.flatMap((entry) =>
      entry.visibility === "published"
        ? [{ "@type": "Question", name: entry.question, acceptedAnswer: { "@type": "Answer", text: entry.answer } }]
        : [],
    ),
  };
}

export function buildHomeStructuredData(config: SiteConfig, faq: readonly FaqEntry[]): JsonLdGraph {
  return {
    "@context": "https://schema.org",
    "@graph": [organization(config), website(config), softwareApplication(config), faqPage(config, faq)],
  };
}

/** Serializes for an inline script element: `<` is escaped so the JSON cannot close the tag. */
export function serializeJsonLd(graph: JsonLdGraph): string {
  return JSON.stringify(graph).replaceAll("<", "\\u003c");
}
