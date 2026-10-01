import { Outlet, type MiddlewareFunction } from "react-router";
import { isLocale } from "@/locale";

export const middleware: MiddlewareFunction<Response>[] = [async ({ params }, next) => {
  if (!isLocale(params.locale ?? "")) throw new Response("Not found", { status: 404 });
  return next();
}];

export default function LocaleLayout() {
  return <Outlet />;
}
