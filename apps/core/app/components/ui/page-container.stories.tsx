import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageContainer } from "./page-container";

const meta = {
  title: "Design System/Components/PageContainer",
  component: PageContainer,
} satisfies Meta<typeof PageContainer>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Widths: Story = {
  name: "Anchos",
  render: () => (
    <div className="flex flex-col gap-6">
      {(["default", "form", "reader"] as const).map((width) => (
        <PageContainer
          key={width}
          width={width}
          className="rounded-[var(--radius-card)] border border-dashed border-border p-4"
        >
          <p className="text-sm font-medium">width=&quot;{width}&quot;</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {width === "default"
              ? "Las listas ocupan el ancho del shell."
              : width === "form"
                ? "Los formularios permanecen estrechos."
                : "Las vistas de lectura limitan la línea de texto."}
          </p>
        </PageContainer>
      ))}
    </div>
  ),
};
