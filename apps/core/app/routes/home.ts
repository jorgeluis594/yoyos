import { redirect, type LoaderFunctionArgs } from "react-router";
import { localizedPath } from "@core/app/locale";

// The private layout sends visitors without a session to the login.
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(`${localizedPath(url.pathname, "/dashboard")}${url.search}`);
}
