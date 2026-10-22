import type { ContactMethod, Rubro } from "@landing/src/content/demo-form";

export type CtaLocation = "header" | "hero" | "precio" | "cta_final" | "footer" | "404";

export type AnalyticsEvent =
  | Readonly<{ name: "whatsapp_click"; location: CtaLocation }>
  | Readonly<{ name: "call_click"; location: Exclude<CtaLocation, "precio" | "404"> }>
  | Readonly<{ name: "demo_form_open"; location: "hero" | "precio" }>
  | Readonly<{ name: "demo_form_submit"; location: "cta_final"; rubro: Rubro; contacto_preferido: ContactMethod }>
  | Readonly<{ name: "demo_form_error"; location: "cta_final"; reason: "validation" | "server" }>
  | Readonly<{ name: "faq_open"; location: "faq"; q: number }>;

export type AnalyticsAdapter = Readonly<{
  track: (name: AnalyticsEvent["name"], props: Record<string, string | number>) => void;
}>;

declare global {
  interface Window {
    yoyosAnalytics?: AnalyticsAdapter;
  }
}

/** Forwards to the adapter installed on `window`; sends nothing when there is none. */
export function track(event: AnalyticsEvent): void {
  const { name, ...props } = event;
  globalThis.window?.yoyosAnalytics?.track(name, props);
}

const locations: readonly CtaLocation[] = ["header", "hero", "precio", "cta_final", "footer", "404"];

const isLocation = (value: string | undefined): value is CtaLocation => locations.some((location) => location === value);

/** Builds the click event of an element from its `data-event` and `data-location` attributes. */
export function eventFromDataset(dataset: Readonly<Record<string, string | undefined>>): AnalyticsEvent | null {
  const { event, location } = dataset;
  switch (event) {
    case "whatsapp_click":
      return isLocation(location) ? { name: event, location } : null;
    case "call_click":
      return isLocation(location) && location !== "precio" && location !== "404" ? { name: event, location } : null;
    case "demo_form_open":
      return location === "hero" || location === "precio" ? { name: event, location } : null;
    default:
      return null;
  }
}

/**
 * Builds the `faq_open` event of a FAQ `<details>` from its `data-faq-q` attribute. It is read only by the toggle
 * listener, so the delegated click listener never matches a FAQ element.
 */
export function faqOpenEvent(dataset: Readonly<Record<string, string | undefined>>): AnalyticsEvent | null {
  const q = Number(dataset.faqQ);
  return Number.isInteger(q) && q > 0 ? { name: "faq_open", location: "faq", q } : null;
}
