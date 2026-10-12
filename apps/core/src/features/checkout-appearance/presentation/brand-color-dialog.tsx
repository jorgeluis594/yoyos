import { useRef, useState, type ReactNode } from "react";
import { RadioGroup } from "radix-ui";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@core/app/components/ui/dialog";
import { checkoutBrandColors, type CheckoutBrandColor } from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import { checkoutBrandColorCatalog } from "@core/src/features/checkout-appearance/domain/checkout-colors";
import type { CheckoutPreviewMode } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";

type BrandColorDialogProps = Readonly<{
  value: CheckoutBrandColor;
  mode: CheckoutPreviewMode;
  onUse: (color: CheckoutBrandColor) => void;
  /** The row that opens the dialog; it gets the focus back when the dialog closes. */
  children: ReactNode;
}>;

/** One swatch per color: the tone of the mode currently shown in the preview. */
export function swatchOf(color: CheckoutBrandColor, mode: CheckoutPreviewMode): string {
  return checkoutBrandColorCatalog[color][mode].primary;
}

export function BrandColorDialog({ value, mode, onUse, children }: BrandColorDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const current = useRef<HTMLButtonElement>(null);
  const selectedName = checkoutBrandColorCatalog[selected].name;

  function changeOpen(next: boolean) {
    if (next) setSelected(value);
    setOpen(next);
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>{children}</DialogTrigger>
    <DialogContent closeLabel={t("checkoutAppearance.colorClose")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl"
      onOpenAutoFocus={(event) => { event.preventDefault(); current.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>{t("checkoutAppearance.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t(mode === "light" ? "checkoutAppearance.dialogHintLight" : "checkoutAppearance.dialogHintDark")}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup.Root
          value={selected} onValueChange={(next) => setSelected(next as CheckoutBrandColor)}
          aria-label={t("checkoutAppearance.colorOptions")} className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          {checkoutBrandColors.map((color) => <RadioGroup.Item
            key={color} value={color} ref={color === value ? current : undefined}
            className="relative flex flex-col gap-2 rounded-lg border bg-card p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card data-[state=checked]:border-2 data-[state=checked]:border-foreground"
          >
            <span className="block h-14 rounded-md" style={{ backgroundColor: swatchOf(color, mode) }} data-testid={`swatch-${color}`} />
            <span className="flex items-center justify-between gap-2 px-0.5 text-sm font-semibold">
              {checkoutBrandColorCatalog[color].name}
              {color === "yoyos" && <span className="text-xs font-normal text-muted-foreground">{t("checkoutAppearance.defaultTag")}</span>}
            </span>
            <RadioGroup.Indicator className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-foreground text-background">
              <Check className="size-3" aria-hidden="true" />
            </RadioGroup.Indicator>
          </RadioGroup.Item>)}
        </RadioGroup.Root>
        <DialogFooter className="items-center">
          <p className="mr-auto text-xs text-muted-foreground">{t("checkoutAppearance.dialogNote")}</p>
          <DialogClose asChild><Button variant="outline">{t("checkoutAppearance.colorCancel")}</Button></DialogClose>
          <Button onClick={() => { onUse(selected); setOpen(false); }}>{t("checkoutAppearance.colorUse", { color: selectedName })}</Button>
        </DialogFooter>
    </DialogContent>
  </Dialog>;
}
