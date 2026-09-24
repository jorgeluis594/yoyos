import * as React from "react";
import { PassThrough } from "node:stream";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { DataTable, DataTableSkeleton, type TableColumn } from "@/components/ui/data-table";

type Row = { id: string; name: string };
const columns: TableColumn<Row>[] = [
  { id: "name", header: "Nombre", cell: (row) => row.name, mobile: "title" },
];
const props = { columns, caption: "Artículos", getRowId: (row: Row) => row.id };

test("renders data, empty and loading states", () => {
  expect(renderToStaticMarkup(<DataTable {...props} data={[{ id: "1", name: "Ejemplo" }]} />)).toContain("Ejemplo");
  expect(renderToStaticMarkup(<DataTable {...props} data={[]} />)).toContain("Sin resultados.");
  const loading = renderToStaticMarkup(<DataTable {...props} data={[]} isLoading skeletonRows={2} />);
  expect(loading).toContain('aria-busy="true"');
  expect(loading.match(/aria-hidden="true"/g)).toHaveLength(2);
  expect(loading).toBe(renderToStaticMarkup(<DataTableSkeleton columns={columns} caption={props.caption} rows={2} />));
});

test("streams a skeleton for a pending loader promise, then renders its rows", async () => {
  let resolve!: (rows: Row[]) => void;
  const promise = new Promise<Row[]>((done) => { resolve = done; });
  let html = "";
  const output = new PassThrough();
  output.on("data", (chunk) => { html += chunk.toString(); });
  const finished = new Promise<void>((done, reject) => {
    output.on("end", done);
    output.on("error", reject);
  });
  await new Promise<void>((done, reject) => {
    const stream = renderToPipeableStream(<main><DataTable {...props} loadData={promise} /></main>, {
      onShellReady() { output.once("data", () => done()); stream.pipe(output); },
      onError: reject,
    });
  });
  expect(html.replaceAll("<!-- -->", "")).toContain("Cargando Artículos");
  expect(html).not.toContain("Ejemplo");
  resolve([{ id: "1", name: "Ejemplo" }]);
  await finished;
  expect(html).toContain("Ejemplo");
});

test("renders each cell and action once in the same row", () => {
  const name = vi.fn((row: Row) => row.name);
  const action = vi.fn((row: Row) => <button aria-label={`Ver ${row.name}`}>Ver</button>);
  const html = renderToStaticMarkup(<DataTable {...props} columns={[
    { ...columns[0], cell: name },
    { id: "action", header: "Acciones", cell: action, mobile: "actions" },
  ]} data={[{ id: "1", name: "Ejemplo" }]} />);
  expect(name).toHaveBeenCalledTimes(1);
  expect(action).toHaveBeenCalledTimes(1);
  expect(html.match(/<tr\b/g)).toHaveLength(2);
  expect(html.match(/<button\b/g)).toHaveLength(1);
  expect(html.match(/data-column=/g)).toHaveLength(2);
});
