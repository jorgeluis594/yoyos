/** Sends the browser to the agent or back to the authorization screen. A seam for tests: jsdom cannot navigate. */
export function redirectBrowser(url: string): void {
  window.location.assign(url);
}

/** Only http(s) targets: the agent's redirect URI is validated on registration, this keeps any other scheme from running. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url, window.location.origin);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
