import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared base styles for text-like controls (Input, Textarea, Select). */
export const controlClass =
  "min-h-control w-full rounded-[var(--radius-control)] border border-input bg-background px-3 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive";

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return <fieldset data-slot="field-set" className={cn("flex min-w-0 flex-col gap-4 has-[>[data-slot=radio-group]]:gap-3", className)} {...props} />;
}

function FieldLegend({ className, variant = "legend", ...props }: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn("mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base", className)}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("group/field-group flex min-w-0 flex-col gap-4", className)} {...props} />;
}

const fieldVariants = cva("group/field flex min-w-0 gap-2", {
  variants: {
    orientation: {
      vertical: "flex-col",
      // Checkbox/radio next to its label on one touch-sized row.
      horizontal: "min-h-touch flex-row items-center gap-3 has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto",
    },
  },
  defaultVariants: { orientation: "vertical" },
});

function Field({ className, orientation = "vertical", ...props }: React.ComponentProps<typeof FieldPrimitive.Root> & VariantProps<typeof fieldVariants>) {
  return <FieldPrimitive.Root data-slot="field" data-orientation={orientation} className={cn(fieldVariants({ orientation }), className)} {...props} />;
}

/** Title + description stacked next to a checkbox or radio. */
function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-content" className={cn("flex flex-1 flex-col gap-0.5 leading-snug", className)} {...props} />;
}

/** Wrapping a `Field` turns the label into a selectable choice card. */
function FieldLabel({ className, ...props }: React.ComponentProps<typeof FieldPrimitive.Label>) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn(
        "text-sm font-medium group-data-[orientation=horizontal]/field:cursor-pointer group-data-[orientation=horizontal]/field:font-normal",
        "has-[>[data-slot=field]]:flex has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:cursor-pointer has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-[var(--radius-control)] has-[>[data-slot=field]]:border has-[>[data-slot=field]]:hover:bg-muted has-[>[data-slot=field]]:has-[:focus-visible]:ring-2 has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring has-data-checked:border-primary has-data-checked:bg-accent *:data-[slot=field]:px-3",
        className,
      )}
      {...props}
    />
  );
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-title" className={cn("flex w-fit items-center gap-2 text-sm font-medium", className)} {...props} />;
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("text-sm font-normal text-muted-foreground", className)} {...props} />;
}

function FieldError({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-error" role="alert" className={cn("text-sm text-destructive", className)} {...props} />;
}

export { Field, FieldSet, FieldLegend, FieldGroup, FieldContent, FieldLabel, FieldTitle, FieldDescription, FieldError };
