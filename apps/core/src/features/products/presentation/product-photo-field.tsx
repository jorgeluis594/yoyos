import { useTranslation } from "react-i18next";
import { useState, type ChangeEvent } from "react";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { uploadImageFile } from "@core/src/shared/images/presentation/client";

export type ProductImageSelection =
  | Readonly<{ kind: "keep" }>
  | Readonly<{ kind: "set"; id: string }>
  | Readonly<{ kind: "remove" }>;

export type ProductPhotoState = Readonly<{ image: ProductImageSelection; uploading: boolean }>;

export const initialProductPhotoState: ProductPhotoState = { image: { kind: "keep" }, uploading: false };

/** Photo picker with immediate upload and preview; reports every selection change to the parent form. */
export function ProductPhotoField({ initialUrl, onChange, className }: {
  initialUrl?: string;
  onChange: (state: ProductPhotoState) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [photo, setPhoto] = useState<{ url: string } | null>(initialUrl ? { url: initialUrl } : null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    onChange({ image: removed ? { kind: "remove" } : uploadedId ? { kind: "set", id: uploadedId } : { kind: "keep" }, uploading: true });
    const result = await uploadImageFile(file);
    if (result.success) {
      setPhoto({ url: result.data.url });
      setUploadedId(result.data.id);
      setRemoved(false);
      onChange({ image: { kind: "set", id: result.data.id }, uploading: false });
    } else {
      setError(result.error.code === "IMAGE_TOO_LARGE" ? t("products.imageTooLarge") : result.error.code === "INVALID_IMAGE" ? t("products.invalidImage") : t("products.uploadError"));
      onChange({ image: removed ? { kind: "remove" } : uploadedId ? { kind: "set", id: uploadedId } : { kind: "keep" }, uploading: false });
    }
    setUploading(false);
  }

  function removePhoto() {
    setPhoto(null);
    setUploadedId(null);
    setRemoved(true);
    setError("");
    onChange({ image: { kind: "remove" }, uploading: false });
  }

  return (
    <Field data-invalid={Boolean(error)} className={className}>
      <FieldLabel htmlFor="photo">{t("products.photo")}</FieldLabel>
      <div className="flex flex-wrap items-center gap-3">
        <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={selectPhoto} aria-invalid={!!error} aria-describedby={error ? "photo-error" : undefined} className="text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive" />
        {photo && <Button type="button" variant="outline" onClick={removePhoto}>{t("products.removePhoto")}</Button>}
      </div>
      {uploading && <p role="status" className="text-sm text-muted-foreground">{t("products.uploading")}</p>}
      {photo && <img src={photo.url} alt={t("products.preview")} className="max-h-48 rounded-md border border-border object-contain" />}
      {error && <FieldError id="photo-error">{error}</FieldError>}
    </Field>
  );
}
