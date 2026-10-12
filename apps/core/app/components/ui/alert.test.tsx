import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";

test("errors interrupt as alerts and other variants announce politely", () => {
  expect(renderToStaticMarkup(<Alert variant="destructive">No se pudo guardar.</Alert>)).toContain('role="alert"');
  for (const variant of ["default", "success", "warning", "info"] as const)
    expect(renderToStaticMarkup(<Alert variant={variant}>Listo</Alert>)).toContain('role="status"');
  expect(renderToStaticMarkup(<Alert role="note">Nota</Alert>)).toContain('role="note"');
});

test("composes title, description and a recovery action", () => {
  const html = renderToStaticMarkup(
    <Alert variant="destructive">
      <AlertTitle>No se pudo subir</AlertTitle>
      <AlertDescription>Revisa tu conexión.</AlertDescription>
      <AlertAction><button type="button">Reintentar</button></AlertAction>
    </Alert>,
  );
  for (const slot of ["alert", "alert-title", "alert-description", "alert-action"]) expect(html).toContain(`data-slot="${slot}"`);
  expect(html).toContain("Reintentar");
});
