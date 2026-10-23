import { data } from "react-router";

const privacyHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const unavailable = (status: number) => data({ code: "CATALOG_UNAVAILABLE" as const }, { status, headers: privacyHeaders });

/** The cart of a page opened before the move to brand addresses: it learns the catalog is gone, as with a hidden catalog. */
export const loader = () => unavailable(404);
export const action = () => unavailable(409);
