import { index, prefix, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/legacy-redirect.ts", { id: "legacy-home" }),
  ...["login", "register", "dashboard"].map((path) =>
    route(path, "routes/legacy-redirect.ts", { id: `legacy-${path}` }),
  ),
  ...prefix("es-PE", [
    index("routes/home.tsx"),
    route("login", "routes/login.tsx"),
    route("register", "routes/register.tsx"),
    route("dashboard", "routes/dashboard.tsx"),
  ]),
] satisfies RouteConfig;
