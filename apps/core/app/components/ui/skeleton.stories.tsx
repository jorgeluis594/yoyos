import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "./skeleton";

const meta = {
  title: "Design System/Components/Skeleton",
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Shapes: Story = {
  name: "Formas",
  render: () => (
    <div className="flex max-w-form flex-col gap-4">
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-10 w-full rounded-[var(--radius-control)]" />
      <Skeleton className="size-12 rounded-full" />
    </div>
  ),
};

export const CardPlaceholder: Story = {
  name: "Placeholder de tarjeta",
  render: () => (
    <div className="max-w-form rounded-[var(--radius-card)] border bg-card p-4 text-card-foreground">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  ),
};

export const TablePlaceholder: Story = {
  name: "Placeholder de tabla",
  render: () => (
    <div className="min-w-0 rounded-[var(--radius-card)] border bg-card p-4 text-card-foreground">
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton key={index} className="h-5 w-full min-w-12" />
        ))}
      </div>
    </div>
  ),
};
