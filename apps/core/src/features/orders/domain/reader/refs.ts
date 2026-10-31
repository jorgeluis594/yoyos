/** Leaf types of the staged reader: they import nothing from the orders domain, so every other reader file may depend on them. */

/** Short references the prompts use for what the reading may point at: `M1…` context messages, `R1…` requests, `I1…` items, `Q1…` pendings. */
export type ContextMessageRef = string & { readonly __brand: "ContextMessageRef" };
export type RequestRef = string & { readonly __brand: "RequestRef" };
export type ItemRef = string & { readonly __brand: "ItemRef" };
export type PendingRef = string & { readonly __brand: "PendingRef" };
/** Position of a justifying quote in the trace's quote list of a message. */
export type QuoteId = number & { readonly __brand: "QuoteId" };
export type BuyerLanguage = "es" | "pt";
