import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const textLinkClass =
  "font-medium text-primary underline underline-offset-4 outline-none hover:no-underline focus-visible:rounded-[var(--radius-control)] focus-visible:ring-2 focus-visible:ring-ring";

/** Inline link inside text. Use `asChild` to style a router `<Link>`. */
function TextLink({ className, asChild = false, ...props }: React.ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a";
  return <Comp data-slot="text-link" className={cn(textLinkClass, className)} {...props} />;
}

export { TextLink, textLinkClass };
