import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass } from "@/components/ui/field";

function Textarea({
  className,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      id={id}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      className={cn(controlClass, "py-2", className)}
      {...props}
    />
  );
}

export { Textarea };
