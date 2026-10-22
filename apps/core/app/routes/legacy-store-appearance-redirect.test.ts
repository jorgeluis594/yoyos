import { expect, test } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { loader } from "@core/app/routes/legacy-store-appearance-redirect";

const redirected = (path: string) => loader({ request: new Request(`http://localhost${path}`) } as LoaderFunctionArgs) as Response;

test("redirects the old checkout appearance address to the store appearance editor, plain and localized, keeping the query", () => {
  for (const [from, to] of [
    ["/settings/checkout-appearance", "/settings/store-appearance"],
    ["/es-PE/settings/checkout-appearance?x=1", "/es-PE/settings/store-appearance?x=1"],
    ["/pt-BR/settings/checkout-appearance/", "/pt-BR/settings/store-appearance"],
  ]) {
    const response = redirected(from);
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(to);
  }
});
