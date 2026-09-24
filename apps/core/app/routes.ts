import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/legacy-redirect.ts", { id: "legacy-home" }),
  route("login", "routes/login.tsx", { id: "public-login" }),
  route("register", "routes/register.tsx", { id: "public-register" }),
  layout("routes/private-layout.tsx", { id: "public-private-layout" }, [
    route("dashboard", "routes/dashboard.tsx", { id: "public-dashboard" }),
    route("products", "routes/product-list.tsx", { id: "public-product-list" }),
    route("products/new", "routes/product-new.tsx", { id: "public-product-new" }),
    route("products/:productId", "routes/product-detail.tsx", { id: "public-product-detail" }),
  ]),
  route(":locale", "routes/locale-layout.tsx", [
    index("routes/home.tsx"),
    route("login", "routes/login.tsx", { id: "localized-login" }),
    route("register", "routes/register.tsx", { id: "localized-register" }),
    layout("routes/private-layout.tsx", { id: "localized-private-layout" }, [
      route("dashboard", "routes/dashboard.tsx", { id: "localized-dashboard" }),
      route("products", "routes/product-list.tsx", { id: "localized-product-list" }),
      route("products/new", "routes/product-new.tsx", { id: "localized-product-new" }),
      route("products/:productId", "routes/product-detail.tsx", { id: "localized-product-detail" }),
    ]),
  ]),
] satisfies RouteConfig;
