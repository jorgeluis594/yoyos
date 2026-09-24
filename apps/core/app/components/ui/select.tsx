import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass, useFieldContext } from "@/components/ui/field";

function Select({
  className,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<"select">) {
  const field = useFieldContext();
  const invalid = ariaInvalid ?? (field?.invalid || undefined);

  return (
    <select
      data-slot="select"
      id={id ?? field?.id}
      aria-invalid={invalid}
      aria-describedby={ariaDescribedBy ?? (invalid ? field?.errorId : undefined)}
      className={cn(controlClass, className)}
      {...props}
    />
  );
}

export { Select };
