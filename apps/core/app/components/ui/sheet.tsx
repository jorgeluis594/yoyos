import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@core/app/components/ui/button";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  return <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/20 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
    <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-sm flex-col border-l bg-background text-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-10">
      <header className="flex items-start justify-between gap-4 border-b p-5">
        <div className="flex flex-col gap-1"><Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title><Dialog.Description className="text-sm text-muted-foreground">{description}</Dialog.Description></div>
        <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={t("common.close")}><X aria-hidden="true" /></Button></Dialog.Close>
      </header>
      {children}
    </Dialog.Content>
  </Dialog.Portal>;
}
