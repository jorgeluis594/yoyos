import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ErrorState } from "@/components/ui/error-state";

test("announces the error with its recovery action", () => {
  const html = renderToStaticMarkup(
    <ErrorState
      title="Producto no encontrado"
      description="No hay un producto disponible en esta dirección."
      action={<a href="/products">Volver a productos</a>}
    />,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("<h1");
  expect(html).toContain("Producto no encontrado");
  expect(html).toContain("No hay un producto disponible en esta dirección.");
  expect(html).toContain("Volver a productos");
});

test("omits description and action when not provided", () => {
  const html = renderToStaticMarkup(<ErrorState title="No se pudo cargar" />);
  expect(html).toContain("No se pudo cargar");
  expect(html).not.toContain("<p");
});
