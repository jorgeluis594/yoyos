import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext } from "@/components/ui/pagination";

test("marks only the current page", () => {
  const html = renderToStaticMarkup(
    <Pagination aria-label="Páginas">
      <PaginationContent>
        <PaginationItem><PaginationLink href="?page=1">1</PaginationLink></PaginationItem>
        <PaginationItem><PaginationLink href="?page=2" isActive>2</PaginationLink></PaginationItem>
      </PaginationContent>
    </Pagination>,
  );
  expect(html).toContain('aria-label="Páginas"');
  expect(html).not.toContain('aria-label="pagination"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
});

test("asChild puts the link styles, icon and text on the router link element", () => {
  const html = renderToStaticMarkup(<PaginationNext asChild><a href="/orders?page=3" data-router-link="">Siguiente</a></PaginationNext>);
  expect(html.match(/<a /g)).toHaveLength(1);
  expect(html).toMatch(/^<a [^>]*data-router-link=""[^>]*>Siguiente<svg/);
  expect(html).toContain('data-slot="pagination-link"');
});
