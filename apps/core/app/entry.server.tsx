import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter, RouterContextProvider, type EntryContext } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { getInstance } from "@/middleware/i18next";
import { log, bindRequestOperation } from "@core/src/shared/infrastructure/logger";

export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted) return;
  const checkout = new URL(request.url).pathname.startsWith("/checkout/");
  if (checkout) bindRequestOperation({ outcome: "technical_failure" });
  log.error({ event: checkout ? "order_checkout_request_failed" : "web_request_failed", err: error }, "Web request failed");
}

export function createRequestContext() {
  return new RouterContextProvider();
}

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  entryContext: EntryContext,
  routerContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || entryContext.isSpaMode ? "onAllReady" : "onShellReady";
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const { pipe, abort } = renderToPipeableStream(
      <I18nextProvider i18n={getInstance(routerContext)}>
        <ServerRouter context={entryContext} url={request.url} />
      </I18nextProvider>,
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          pipe(body);
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
        },
        onShellError(error: unknown) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) handleError(error, { request });
        },
      },
    );
    timeoutId = setTimeout(abort, streamTimeout + 1000);
  });
}
