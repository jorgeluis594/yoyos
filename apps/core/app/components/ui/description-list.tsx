import * as React from "react";
import { cn } from "@/lib/utils";

/** `horizontal`: term and value share a row (summaries). `vertical`: value under its term (account data). */
function DescriptionList({ className, orientation = "horizontal", ...props }: React.ComponentProps<"dl"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <dl
      data-slot="description-list"
      data-orientation={orientation}
      className={cn("group/description-list flex flex-col gap-2 text-sm", className)}
      {...props}
    />
  );
}

/** One term/value pair; a `div` is the only wrapper `dl` allows. */
function DescriptionItem({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="description-item"
      className={cn(
        "flex min-w-0 flex-col gap-0.5 group-data-[orientation=horizontal]/description-list:flex-row group-data-[orientation=horizontal]/description-list:flex-wrap group-data-[orientation=horizontal]/description-list:items-baseline group-data-[orientation=horizontal]/description-list:justify-between group-data-[orientation=horizontal]/description-list:gap-x-4",
        className,
      )}
      {...props}
    />
  );
}

function DescriptionTerm({ className, ...props }: React.ComponentProps<"dt">) {
  return <dt data-slot="description-term" className={cn("text-muted-foreground", className)} {...props} />;
}

function DescriptionDetails({ className, ...props }: React.ComponentProps<"dd">) {
  return (
    <dd
      data-slot="description-details"
      className={cn("min-w-0 break-words group-data-[orientation=horizontal]/description-list:text-right group-data-[orientation=horizontal]/description-list:tabular-nums", className)}
      {...props}
    />
  );
}

export { DescriptionList, DescriptionItem, DescriptionTerm, DescriptionDetails };
