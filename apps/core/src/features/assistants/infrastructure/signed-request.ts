/**
 * The plugin's `verifyOAuthQueryParams` answers one boolean for signature and expiry together. When it fails, a well-formed query
 * (client, signature and a numeric `exp`) whose `exp` is past is an expired request; anything else is invalid.
 */
export function signedRequestFailure(signedQuery: string, now: Date): "REQUEST_EXPIRED" | "REQUEST_INVALID" {
  const query = new URLSearchParams(signedQuery);
  const exp = query.get("exp");
  const wellFormed = (query.get("client_id") ?? "") !== "" && (query.get("sig") ?? "") !== "" && exp !== null && /^\d+$/.test(exp);
  return wellFormed && Number(exp) * 1000 < now.getTime() ? "REQUEST_EXPIRED" : "REQUEST_INVALID";
}
