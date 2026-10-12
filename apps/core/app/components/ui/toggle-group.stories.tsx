import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

const meta = { title: "Design System/Components/ToggleGroup", component: ToggleGroup } satisfies Meta<typeof ToggleGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

function Device() {
  const [device, setDevice] = useState("mobile");
  return (
    // Radix allows deselecting in single mode; keep the current value when it reports "".
    <ToggleGroup type="single" variant="outline" spacing={0} aria-label="Dispositivo" value={device} onValueChange={(value) => value && setDevice(value)}>
      <ToggleGroupItem value="mobile">Móvil</ToggleGroupItem>
      <ToggleGroupItem value="tablet">Tablet</ToggleGroupItem>
      <ToggleGroupItem value="desktop">Escritorio</ToggleGroupItem>
    </ToggleGroup>
  );
}

export const Single: Story = { args: { type: "single" }, render: () => <Device /> };
