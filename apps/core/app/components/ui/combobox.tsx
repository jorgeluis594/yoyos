import { Check, ChevronDown } from "lucide-react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass } from "@/components/ui/field";
import { SelectPortalContainer } from "@/components/ui/select";

// Adapted from shadcn's combobox to the house controls; checkbox items for multiple selection.
const Combobox = ComboboxPrimitive.Root;

function ComboboxInput({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <div data-slot="combobox-input" className="relative">
      <ComboboxPrimitive.Input className={cn(controlClass, "pr-10", className)} {...props} />
      <ComboboxPrimitive.Trigger aria-hidden="true" tabIndex={-1} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground disabled:opacity-50">
        <ChevronDown className="size-4" />
      </ComboboxPrimitive.Trigger>
    </div>
  );
}

function ComboboxContent({ className, children, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Popup>) {
  const container = React.useContext(SelectPortalContainer);
  return (
    <ComboboxPrimitive.Portal container={container ?? undefined}>
      <ComboboxPrimitive.Positioner sideOffset={4} className="z-50">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn("w-(--anchor-width) max-w-(--available-width) rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none", className)}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.List>) {
  return <ComboboxPrimitive.List data-slot="combobox-list" className={cn("max-h-72 overflow-y-auto overscroll-contain p-1 empty:p-0", className)} {...props} />;
}

function ComboboxEmpty({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return <ComboboxPrimitive.Empty data-slot="combobox-empty" className={cn("px-3 py-2 text-sm text-muted-foreground empty:hidden", className)} {...props} />;
}

/** The active option also takes the focus outline: some store themes set `accent` equal to `popover`, so the fill alone would not show it. */
function ComboboxItem({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn("flex min-h-10 cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[highlighted]:outline-2 data-[highlighted]:-outline-offset-2 data-[highlighted]:outline-ring data-[selected]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)}
      {...props}
    />
  );
}

function ComboboxCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn("group flex min-h-9 cursor-default items-center gap-3 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)}
      {...props}
    >
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-input text-transparent group-data-[selected]:border-primary group-data-[selected]:bg-primary group-data-[selected]:text-primary-foreground">
        <Check className="size-3.5" />
      </span>
      {children}
    </ComboboxPrimitive.Item>
  );
}

export { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxEmpty, ComboboxItem, ComboboxCheckboxItem };
