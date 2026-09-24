import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PageHeader } from "@/components/ui/page-header";

test("renders the page title as the single h1 with description and actions", () => {
  const html = renderToStaticMarkup(
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>
          Productos
          <PageHeader.Count>128</PageHeader.Count>
        </PageHeader.Title>
        <PageHeader.Description>Administra el catálogo.</PageHeader.Description>
      </PageHeader.Heading>
      <PageHeader.Actions>
        <button>Nuevo producto</button>
      </PageHeader.Actions>
    </PageHeader>,
  );
  expect(html.match(/<h1/g)).toHaveLength(1);
  expect(html).toContain("Productos");
  expect(html).toContain("128");
  expect(html).toContain("Administra el catálogo.");
  expect(html).toContain("Nuevo producto");
});
