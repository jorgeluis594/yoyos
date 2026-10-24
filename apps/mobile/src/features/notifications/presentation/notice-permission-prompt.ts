import { showConfirmation } from "@mobile/components/ui/show-confirmation";

type Translate = (key: string) => string;

/** The app's two-button confirmation; resolves `true` for «Activar avisos» and `false` for «Ahora no». */
export function confirmNoticePrompt(t: Translate): Promise<boolean> {
  return new Promise((resolve) => {
    showConfirmation({
      title: t("noticesPromptTitle"),
      description: t("noticesPromptDescription"),
      confirmLabel: t("noticesEnable"),
      cancelLabel: t("noticesNotNow"),
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
