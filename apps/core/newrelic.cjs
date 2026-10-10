exports.config = {
  attributes: { exclude: ["request.*", "response.headers.*", "http.url", "http.target", "url.*", "orderId"] },
  allow_all_headers: false,
  strip_exception_messages: { enabled: true },
  url_obfuscation: {
    enabled: true,
    regex: { pattern: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", flags: "gi", replacement: "[redacted]" },
  },
  rules: { name: [
    { pattern: "^/checkout(?:/.*)?$", name: "checkout" },
    { pattern: "^/(?:[a-z]{2}-[A-Z]{2}/)?settings/checkout-appearance/preview/?(?:\\.data)?$", name: "settings/checkout-appearance/preview" },
    { pattern: "^/api/orders/[^/]+/checkout-link/?$", name: "orders/checkout-link" },
    { pattern: "^/(?:api/|[a-z]{2}-[A-Z]{2}/)?orders/[0-9a-f-]{36}(?:\\.data)?(?:/.*)?$", name: "orders/detail" },
  ] },
};
