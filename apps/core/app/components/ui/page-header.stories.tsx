import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { PageContainer } from "./page-container";
import { PageHeader } from "./page-header";

const meta = {
  title: "Design System/Components/PageHeader",
  component: PageHeader,
} satisfies Meta<typeof PageHeader>;
export default meta;

type Story = StoryObj<typeof meta>;

export const WithActions: Story = {
  render: () => (
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>
          Productos
          <PageHeader.Count>128</PageHeader.Count>
        </PageHeader.Title>
        <PageHeader.Description>
          Administra el catálogo, precios y disponibilidad del punto de venta.
        </PageHeader.Description>
      </PageHeader.Heading>
      <PageHeader.Actions>
        <Button variant="outline">Exportar</Button>
        <Button>Nuevo producto</Button>
      </PageHeader.Actions>
    </PageHeader>
  ),
};

export const TitleOnly: Story = {
  render: () => (
    <PageHeader>
      <PageHeader.Heading>
        <PageHeader.Title>Nuevo producto</PageHeader.Title>
        <PageHeader.Description>
          Completa los datos para agregarlo a tu empresa.
        </PageHeader.Description>
      </PageHeader.Heading>
    </PageHeader>
  ),
};

export const PageWidths: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {(["default", "reader", "form"] as const).map((width) => (
        <PageContainer
          key={width}
          width={width}
          className="border border-dashed border-border p-4"
        >
          <p className="text-sm text-muted-foreground">
            PageContainer width=&quot;{width}&quot;
          </p>
        </PageContainer>
      ))}
    </div>
  ),
};
