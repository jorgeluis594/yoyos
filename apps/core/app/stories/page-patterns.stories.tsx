import type { ComponentType } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type TableColumn } from "@/components/ui/data-table";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import {
  ProductForm,
  type ProductFormValues,
} from "@core/src/features/products/presentation/product-form";
import type { FormErrors } from "@core/src/features/products/presentation/messages";

const meta = {
  title: "Design System/Patterns",
  decorators: [
    (Story: ComponentType) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

export const Dashboard: Story = {
  name: "Inicio",
  render: () => (
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>Hola, Alex</PageHeader.Title>
        <PageHeader.Description>Tu espacio de trabajo está listo.</PageHeader.Description>
      </PageHeader.Heading>
    </PageHeader>
  ),
};

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  price: string;
  stock: number;
};

const products: ProductRow[] = [
  { id: "1", name: "Polo oversize", sku: "POLO-M-CAR", price: "59.90 PEN", stock: 24 },
  { id: "2", name: "Casaca denim", sku: "CJ-DEN-M", price: "Desde 189.00 PEN", stock: 8 },
  { id: "3", name: "Gorro tejido", sku: "Varias variantes", price: "39.50 PEN", stock: 41 },
];

const columns: TableColumn<ProductRow>[] = [
  {
    id: "name",
    header: "Nombre",
    mobile: "title",
    cell: (row) => (
      <a
        href={`/products/${row.id}`}
        className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {row.name}
      </a>
    ),
  },
  { id: "sku", header: "SKU", mobile: "description", cell: (row) => row.sku },
  { id: "price", header: "Precio de venta", mobile: "value", align: "right", cell: (row) => row.price },
  { id: "stock", header: "Stock", mobile: "description", align: "right", cell: (row) => row.stock },
];

export const ProductList: Story = {
  name: "Lista de productos",
  render: () => (
    <section>
      <PageHeader>
        <PageHeader.Heading>
          <PageHeader.Title>
            Productos
            <PageHeader.Count>{products.length}</PageHeader.Count>
          </PageHeader.Title>
        </PageHeader.Heading>
        <PageHeader.Actions>
          <Button asChild>
            <a href="/products/new">Nuevo producto</a>
          </Button>
        </PageHeader.Actions>
      </PageHeader>
      <form role="search" className="mt-6 flex flex-wrap items-end gap-3">
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor="pattern-search">Buscar por nombre o SKU</FieldLabel>
          <Input id="pattern-search" name="search" type="search" placeholder="Polo, gorra…" />
        </Field>
        <Button type="submit">Buscar</Button>
      </form>
      <DataTable
        className="mt-6"
        columns={columns}
        caption="Productos del catálogo"
        getRowId={(row) => row.id}
        data={products}
      />
      <nav aria-label="Páginas de productos" className="mt-6 flex flex-wrap items-center gap-2">
        {[1, 2, 3].map((page) => (
          <Button key={page} asChild variant={page === 1 ? "default" : "outline"} size="sm">
            <a href={`/products?page=${page}`} aria-current={page === 1 ? "page" : undefined}>
              {page}
            </a>
          </Button>
        ))}
      </nav>
    </section>
  ),
};

const editValues: ProductFormValues = {
  name: "Polo oversize",
  description: "Producto de temporada con acabado premium.",
  sku: "POLO-M-CAR",
  salePrice: "59.90",
  purchasePrice: "32.00",
  initialStock: "24",
};

function FormPage({ errors }: { errors?: FormErrors }) {
  return (
    <PageContainer>
      <PageHeader>
        <PageHeader.Heading>
          <PageHeader.Title>Nuevo producto</PageHeader.Title>
          <PageHeader.Description>Completa los datos para agregarlo a tu empresa.</PageHeader.Description>
        </PageHeader.Heading>
      </PageHeader>
      <ProductForm
        currency="PEN"
        cancelTo="/products"
        errors={errors ?? {}}
        pending={false}
        onSave={() => {}}
      />
    </PageContainer>
  );
}

export const ProductNew: Story = {
  name: "Nuevo producto",
  render: () => <FormPage />,
};

export const ProductFormErrors: Story = {
  name: "Formulario con errores",
  render: () => (
    <FormPage
      errors={{
        name: "El nombre es obligatorio.",
        salePrice: "El precio debe ser mayor a 0.",
        form: "No se pudo guardar el producto. Inténtalo de nuevo.",
      }}
    />
  ),
};

export const ProductDetail: Story = {
  name: "Manejo de producto",
  render: () => (
    <PageContainer>
      <PageHeader>
        <PageHeader.Heading><PageHeader.Title>Polo oversize</PageHeader.Title></PageHeader.Heading>
        <PageHeader.Actions><Button asChild variant="outline"><a href="/products">Volver a productos</a></Button></PageHeader.Actions>
      </PageHeader>
      <ProductForm currency="PEN" cancelTo="/products" errors={{}} pending={false} values={editValues} stock={24} submitLabel="Guardar cambios" onSave={() => {}} />
    </PageContainer>
  ),
};

export const ProductDetailMultipleVariants: Story = {
  name: "Producto con varias variantes",
  render: () => (
    <PageContainer>
      <PageHeader><PageHeader.Heading><PageHeader.Title>Polo oversize</PageHeader.Title></PageHeader.Heading></PageHeader>
      <ProductForm currency="PEN" cancelTo="/products" errors={{}} pending={false} values={editValues} stock={41} variantFields="hidden" submitLabel="Guardar cambios" onSave={() => {}} variants={
        <section aria-labelledby="variants-story-heading">
          <h2 id="variants-story-heading" className="text-base font-semibold">Variantes</h2>
          <div className="mt-3 grid gap-3">{["M", "L"].map((size, index) => <Card key={size} role="article" className="p-4">
            <h3 className="font-medium">Variante {index + 1}</h3>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Talla</dt><dd>{size}</dd></div>
              <div><dt className="text-muted-foreground">SKU</dt><dd>POLO-{size}-CAR</dd></div>
              <div><dt className="text-muted-foreground">Precio de venta</dt><dd>59.90 PEN</dd></div>
              <div><dt className="text-muted-foreground">Precio de compra</dt><dd>32.00 PEN</dd></div>
              <div><dt className="text-muted-foreground">Stock</dt><dd>{size === "M" ? 24 : 17}</dd></div>
            </dl>
          </Card>)}</div>
        </section>
      } />
    </PageContainer>
  ),
};
