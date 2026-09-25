import { redirect, type LoaderFunctionArgs } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/edit\/?$/, "");
  return redirect(url.pathname + url.search);
}
