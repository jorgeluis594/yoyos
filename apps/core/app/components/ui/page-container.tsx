import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pageContainerVariants = cva("mx-auto w-full min-w-0", {
  variants: {
    width: {
      default: "",
      form: "max-w-form",
      reader: "max-w-reader",
    },
  },
  defaultVariants: {
    width: "default",
  },
});

/** Page content width by role: lists fill the shell, forms and reading views stay narrow. */
function PageContainer({
  className,
  width,
  ...props
}: React.ComponentProps<"section"> &
  VariantProps<typeof pageContainerVariants>) {
  return (
    <section
      data-slot="page-container"
      className={cn(pageContainerVariants({ width }), className)}
      {...props}
    />
  );
}

export { PageContainer, pageContainerVariants };
