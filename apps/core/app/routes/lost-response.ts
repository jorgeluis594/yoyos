import { isRouteErrorResponse } from "react-router";

export type LostResponse = "offline" | "in-doubt";

/** The status that keeps React Router from revalidating loaders after a lost answer: they would fail too and replace the form with the load error. */
export const lostResponseStatus = 503;

/** Why a client action got no usable answer: the request never reached the server, or a gateway failed after it left. Redirects and client errors are the route's to handle, so they answer `undefined`. */
export function lostResponse(cause: unknown): LostResponse | undefined {
  if (!(cause instanceof Response) && !isRouteErrorResponse(cause)) return "offline";
  return cause.status >= 500 ? "in-doubt" : undefined;
}
