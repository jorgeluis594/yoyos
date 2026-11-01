export type CatalogSearchReadiness = "no_active_products" | "all_products_hidden" | "no_searchable_photos" | "ready";

export type ProductMatcherError = Readonly<{ code: "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE"; message: string }>;
