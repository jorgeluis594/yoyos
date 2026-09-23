import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return redirect(`/es-PE${url.pathname}${url.search}`, 308);
}
