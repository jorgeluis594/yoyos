import { useTranslation } from "react-i18next";
import { CheckoutBrandHeader } from "@core/src/features/checkout-appearance/presentation/checkout-brand-header";
import { CheckoutTheme } from "@core/src/features/checkout-appearance/presentation/checkout-theme";
import type { PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import type { PreviewMode } from "@core/src/features/checkout-appearance/presentation/editor-draft";

export type CheckoutPreviewSlotProps = Readonly<{
  companyName: string;
  /** Draft appearance, in the shape the buyer receives. */
  appearance: PublicCheckoutAppearance;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
}>;

const modes: readonly PreviewMode[] = ["light", "dark"];

/**
 * Reserved space with the final dimensions of the live preview (phone width, scrollable canvas).
 * The editor renders it from one place; replace this component with `<CheckoutPreviewFrame>`
 * keeping the same props (draft appearance and active mode).
 */
export function CheckoutPreviewPlaceholder({ companyName, appearance, mode, onModeChange }: CheckoutPreviewSlotProps) {
  const { t } = useTranslation();
  return <div className="flex min-w-0 flex-col items-center gap-4" data-testid="checkout-preview-slot">
    <div role="group" aria-label={t("checkoutAppearance.previewMode")} className="flex gap-1 rounded-md border bg-card p-1">
      {modes.map((option) => <button
        key={option} type="button" aria-pressed={mode === option} onClick={() => onModeChange(option)}
        className="min-h-9 rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
      >{t(option === "light" ? "checkoutAppearance.modeLight" : "checkoutAppearance.modeDark")}</button>)}
    </div>
    <div className={`w-full max-w-[390px] overflow-hidden rounded-3xl border-8 border-foreground ${mode === "dark" ? "dark" : ""}`}>
      <CheckoutTheme appearance={appearance}>
        <div className="flex min-h-[640px] flex-col gap-4 p-4">
          <CheckoutBrandHeader companyName={companyName} logoUrl={appearance.logoUrl} />
          <p className="text-sm text-muted-foreground">{t("checkoutAppearance.previewPlaceholder")}</p>
          <div className="mt-auto rounded-md bg-primary px-4 py-3 text-center text-sm font-medium text-primary-foreground" aria-hidden="true" />
        </div>
      </CheckoutTheme>
    </div>
  </div>;
}
