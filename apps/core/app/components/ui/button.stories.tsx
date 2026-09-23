import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";

const meta = { component: Button } satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(["default", "secondary", "outline", "ghost", "destructive", "link"] as const).map((variant) => (
        <Button key={variant} variant={variant}>{variant}</Button>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {(["xs", "sm", "default", "lg", "icon-xs", "icon-sm", "icon", "icon-lg"] as const).map((size) => (
        <Button key={size} size={size} aria-label={size.startsWith("icon") ? size : undefined}>
          {size.startsWith("icon") ? "+" : size}
        </Button>
      ))}
    </div>
  ),
};

export const Disabled: Story = { args: { children: "Disabled", disabled: true } };
