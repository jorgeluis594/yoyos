import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass } from "@/components/ui/field";

function Select({ id, ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root id={id} {...props} />;
}

function SelectTrigger({ className, id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select"
      id={id}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      className={cn(controlClass, "flex items-center justify-between gap-2 text-left", className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronDown aria-hidden="true" className="size-4 shrink-0 opacity-50" />} />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Popup>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn("z-50 max-h-60 min-w-[var(--anchor-width)] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none", className)}
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn("relative flex min-h-9 cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center justify-center">
        <Check aria-hidden="true" className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

const SelectValue = SelectPrimitive.Value;
const SelectGroup = SelectPrimitive.Group;

export { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem };
