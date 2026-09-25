import { Field as FieldPrimitive } from "@base-ui/react/field";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared base styles for text-like controls (Input, Textarea, Select). */
export const controlClass =
  "min-h-control w-full rounded-[var(--radius-control)] border border-input bg-background px-3 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive";

function Field({ className, ...props }: React.ComponentProps<typeof FieldPrimitive.Root>) {
  return <FieldPrimitive.Root data-slot="field" className={cn("flex min-w-0 flex-col gap-2", className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof FieldPrimitive.Label>) {
  return <FieldPrimitive.Label data-slot="field-label" className={cn("text-sm font-medium", className)} {...props} />;
}

function FieldError({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-error" role="alert" className={cn("text-sm text-destructive", className)} {...props} />;
}

export { Field, FieldLabel, FieldError };
