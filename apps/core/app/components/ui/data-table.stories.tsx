import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableSkeleton, type TableColumn } from "@/components/ui/data-table";

type Item = { id: string; name: string; detail: string; amount: string };
const items: Item[] = [
  { id: "1", name: "Artículo de ejemplo", detail: "Primera descripción", amount: "S/ 24.00" },
  { id: "2", name: "Artículo con un nombre muy largo que debe ajustarse sin cortar el contenido", detail: "Descripción larga para comprobar el ajuste de texto en un contenedor estrecho", amount: "S/ 148.50" },
  { id: "3", name: "Otro artículo", detail: "Tercera descripción", amount: "S/ 8.00" },
];
const columns: TableColumn<Item>[] = [
  { id: "name", header: "Artículo", cell: (row) => row.name, mobile: "title" },
  { id: "detail", header: "Detalle", cell: (row) => row.detail, mobile: "description" },
  { id: "amount", header: "Importe", cell: (row) => row.amount, align: "right", mobile: "value" },
];
const props = { columns, caption: "Artículos de ejemplo", getRowId: (row: Item) => row.id };

const meta = {
  title: "UI/DataTable",
  decorators: [(Story: React.ComponentType) => <div className="mx-auto w-full max-w-5xl"><Story /></div>],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Data: Story = { name: "Con datos", render: () => <DataTable {...props} data={items} /> };
export const Empty: Story = { name: "Vacío", render: () => <DataTable {...props} data={[]} emptyMessage="Todavía no hay artículos." /> };
export const Loading: Story = { name: "Carga", render: () => <DataTableSkeleton columns={columns} caption={props.caption} rows={3} /> };
export const ControlledLoading: Story = { name: "Carga controlada", render: () => <DataTable {...props} data={items} isLoading skeletonRows={3} /> };

function DeferredExample() {
  const [request, setRequest] = React.useState(0);
  const [promise, setPromise] = React.useState<Promise<Item[]>>(() => new Promise((resolve) => setTimeout(() => resolve(items), 1800)));
  return <div className="flex flex-col gap-4">
    <Button variant="outline" onClick={() => {
      setRequest((current) => current + 1);
      setPromise(new Promise((resolve) => setTimeout(() => resolve(items), 1800)));
    }}>Volver a cargar</Button>
    <DataTable key={request} {...props} loadData={promise} skeletonRows={3} />
  </div>;
}
export const Deferred: Story = { name: "Carga diferida", render: () => <DeferredExample /> };

function ActionsExample() {
  const [selected, setSelected] = React.useState("");
  const actionColumns: TableColumn<Item>[] = [...columns, {
    id: "actions", header: "Acciones", mobile: "actions", align: "right",
    cell: (row) => <Button variant="ghost" size="icon" aria-label={`Ver ${row.name}`} onClick={() => setSelected(row.name)}><Eye aria-hidden="true" /></Button>,
  }];
  return <div className="flex flex-col gap-4">
    <DataTable {...props} columns={actionColumns} data={items} />
    <p role="status" className="text-sm text-muted-foreground">{selected ? `Seleccionado: ${selected}` : "Selecciona un artículo."}</p>
  </div>;
}
export const Actions: Story = { name: "Acciones", render: () => <ActionsExample /> };
export const Narrow: Story = { name: "Contenedor estrecho", render: () => <div className="w-full max-w-80"><ActionsExample /></div> };
export const Light: Story = { name: "Tema claro", globals: { theme: "light" }, render: () => <DataTable {...props} data={items} /> };
export const Dark: Story = { name: "Tema oscuro", globals: { theme: "dark" }, render: () => <DataTable {...props} data={items} /> };
export const Horizontal: Story = { name: "Sin roles móviles", render: () => <div className="max-w-80"><DataTable {...props} columns={columns.map((column) => ({ ...column, mobile: undefined }))} data={items} /></div> };
