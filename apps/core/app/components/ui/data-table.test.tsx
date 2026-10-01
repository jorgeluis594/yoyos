import * as React from "react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import resources from "@core/app/locales";
import { PassThrough } from "node:stream";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { DataTable, DataTableSkeleton, type TableColumn } from "@/components/ui/data-table";

type Row = { id: string; name: string };
const columns: TableColumn<Row>[] = [
  { id: "name", header: "Nombre", cell: (row) => row.name, mobile: "title" },
];
const props = { columns, caption: "Artículos", getRowId: (row: Row) => row.id };
const i18n = createInstance();
await i18n.init({ lng: "es", resources });
const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

test("renders data, empty and loading states", () => {
  expect(render(<DataTable {...props} data={[{ id: "1", name: "Ejemplo" }]} />)).toContain("Ejemplo");
  expect(render(<DataTable {...props} data={[]} />)).toContain("Sin resultados.");
  const loading = render(<DataTable {...props} data={[]} isLoading skeletonRows={2} />);
  expect(loading).toContain('aria-busy="true"');
  expect(loading.match(/aria-hidden="true"/g)).toHaveLength(2);
  expect(loading).toBe(render(<DataTableSkeleton columns={columns} caption={props.caption} rows={2} />));
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
    const stream = renderToPipeableStream(<I18nextProvider i18n={i18n}><main><DataTable {...props} loadData={promise} /></main></I18nextProvider>, {
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
  const html = render(<DataTable {...props} columns={[
    { ...columns[0], cell: name },
    { id: "action", header: "Acciones", cell: action, mobile: "actions" },
  ]} data={[{ id: "1", name: "Ejemplo" }]} />);
  expect(name).toHaveBeenCalledTimes(1);
  expect(action).toHaveBeenCalledTimes(1);
  expect(html.match(/<tr\b/g)).toHaveLength(2);
  expect(html.match(/<button\b/g)).toHaveLength(1);
  expect(html.match(/data-column=/g)).toHaveLength(2);
});

test("uses the active language for table status and empty message", async () => {
  await i18n.changeLanguage("pt");
  expect(render(<DataTable {...props} data={[]} />)).toContain("Nenhum resultado.");
  expect(render(<DataTableSkeleton columns={columns} caption={props.caption} />)).toContain("Carregando Artículos");
  await i18n.changeLanguage("es");
});
