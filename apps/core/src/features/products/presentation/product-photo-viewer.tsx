import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@core/app/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { RetryableImage } from "@core/src/shared/images/presentation/retryable-image";

/** `position` and `total` number the photo within the whole field, as its tile label does. */
export type ViewerPhoto = Readonly<{ key: string; url: string; position: number; total: number }>;

type Props = Readonly<{
  /** The photos that have an image to show, in the order of the field. */
  photos: readonly ViewerPhoto[];
  current: string;
  onChange: (key: string) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}>;

/** The photo large in a modal; with several photos the seller steps through them, and past either end it wraps around. */
export function ProductPhotoViewer({ photos, current, onChange, onClose, onCloseAutoFocus }: Props) {
  const { t } = useTranslation();
  const index = Math.max(0, photos.findIndex((photo) => photo.key === current));
  const photo = photos[index];
  if (!photo) return null;
  const { position, total } = photo;
  const step = (by: number) => onChange(photos[(index + by + photos.length) % photos.length].key);
  const several = photos.length > 1;
  const onKeyDown = (event: KeyboardEvent) => {
    if (!several || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent closeLabel={t("productPhotos.viewerClose")} onKeyDown={onKeyDown} onCloseAutoFocus={onCloseAutoFocus} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{t("productPhotos.viewerTitle", { position, total })}</DialogTitle><DialogDescription className="sr-only">{t("productPhotos.viewerHint")}</DialogDescription></DialogHeader>
      {/* Below sm the buttons go under the image so it keeps the dialog's width; the image area has a fixed height so nothing moves while a photo loads. */}
      <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="order-1 col-span-2 flex h-[min(60dvh,28rem)] min-w-0 items-center justify-center sm:order-2 sm:col-span-1">
          <RetryableImage key={photo.key} url={photo.url} alt={t("productPhotos.name", { position, total })} className="max-h-full" failedText={t("productPhotos.viewerLoadFailed")} retryText={t("productPhotos.retry")} />
        </div>
        {several && <Button type="button" variant="outline" size="icon" className="order-2 justify-self-start sm:order-1" aria-label={t("productPhotos.viewerPrevious")} onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></Button>}
        {several && <Button type="button" variant="outline" size="icon" className="order-3 justify-self-end" aria-label={t("productPhotos.viewerNext")} onClick={() => step(1)}><ChevronRight aria-hidden="true" /></Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
