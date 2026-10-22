import { redirect, type LoaderFunctionArgs } from "react-router";

/** The checkout appearance editor became the store appearance editor; old links keep their language prefix and query. */
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/settings\/checkout-appearance\/?$/, "/settings/store-appearance");
  return redirect(`${path}${url.search}`, 308);
}
