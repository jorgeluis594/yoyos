import { useTranslation } from "react-i18next";
import { imageUploadLimits } from "@shared/contracts/images";
import { Alert } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { FileUpload, FileUploadActions, FileUploadDropzone, FileUploadPreview, FileUploadTrigger } from "@core/app/components/ui/file-upload";
import { Field, FieldDescription, FieldError, FieldLabel } from "@core/app/components/ui/field";

export type WalletQrState =
  | Readonly<{ status: "empty" }>
  | Readonly<{ status: "uploading" }>
  | Readonly<{ status: "checking"; imageId: string }>
  | Readonly<{ status: "valid"; imageId: string; origin: "chosen" | "saved"; fileName?: string; size?: number }>
  | Readonly<{ status: "not_a_qr"; imageId: string; fileName?: string; size?: number }>
  | Readonly<{ status: "check_unavailable"; imageId: string }>
  // Wallet saved before the QR check existed: hidden from buyers until it is saved with a valid QR.
  | Readonly<{ status: "unchecked"; imageId: string | null }>
  // The previous image, if any, stays when the upload or the file is refused.
  | Readonly<{ status: "upload_failed"; imageId: string | null; previousNotAQr?: boolean }>
  | Readonly<{ status: "wrong_file"; imageId: string | null; previousNotAQr?: boolean }>;

export type WalletQrField = Readonly<{ offered: boolean; state: WalletQrState }>;

/** The save check is the one that counts, so only a missing or visibly invalid QR, or a pending wait, blocks the save. */
export function canSaveWalletQr({ offered, state }: WalletQrField): boolean {
  if (!offered) return true;
  switch (state.status) {
    case "empty": case "uploading": case "checking": case "not_a_qr": return false;
    case "valid": case "check_unavailable": return true;
    case "unchecked": return state.imageId !== null;
    // The previous image stays, so a previous image that was read and is not a QR keeps blocking the save.
    case "upload_failed": case "wrong_file": return state.imageId !== null && !state.previousNotAQr;
  }
}

/** The field after a successful save: only a wallet that was offered and holds an image is now a saved valid QR. */
export function walletQrAfterSave({ offered, state }: WalletQrField): WalletQrState {
  if (!offered || state.status === "valid") return state;
  const imageId = walletQrImageId(state);
  return imageId ? { status: "valid", imageId, origin: "saved" } : state;
}

/** Whether the previously chosen image was read and is not a QR, so a failed replacement keeps blocking the save. */
export const walletQrWasNotAQr = (state: WalletQrState): boolean =>
  state.status === "not_a_qr" || ((state.status === "upload_failed" || state.status === "wrong_file") && state.previousNotAQr === true);

/** Retry repeats the step that failed: the upload of the last chosen file, or the check of the current image. */
export function walletQrRetry(state: WalletQrState, lastFile: File | null): "upload" | "check" | null {
  if (state.status === "upload_failed") return lastFile ? "upload" : null;
  if (state.status === "check_unavailable") return "check";
  return null;
}

export const walletQrImageId = (state: WalletQrState): string => "imageId" in state && state.imageId ? state.imageId : "";

export function walletQrBlockReason(field: WalletQrField): "missing" | "invalid" | null {
  if (canSaveWalletQr(field)) return null;
  return field.state.status === "not_a_qr" ? "invalid" : field.state.status === "empty" || field.state.status === "unchecked" || field.state.status === "upload_failed" || field.state.status === "wrong_file" ? "missing" : null;
}

const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
export const isAcceptableQrFile = (file: File) => acceptedTypes.includes(file.type) && file.size <= imageUploadLimits.maxBytes;
const formatSize = (bytes: number) => bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

export function WalletQrField({ state, url, onFile, onRetry, onRemove }: { state: WalletQrState; url: string; onFile: (file: File) => void;
  onRetry: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const busy = state.status === "uploading" || state.status === "checking";
  const hasImage = "imageId" in state && state.imageId !== null && url !== "";
  const invalid = state.status === "not_a_qr";
  const missing = state.status === "empty" || (state.status === "unchecked" && !hasImage);
  const chosenFile = (state.status === "valid" && state.origin === "chosen") || state.status === "not_a_qr" ? state : null;
  const fileInfo = chosenFile?.fileName ? `${chosenFile.fileName}${chosenFile.size ? ` · ${formatSize(chosenFile.size)}` : ""}` : "";
  return <Field><FieldLabel>{t("paymentSettings.qrLabel")}</FieldLabel>
    <FileUpload accept={acceptedTypes.join(",")} disabled={busy} onFileSelect={onFile} data-testid="wallet-qr-field">
    {!hasImage && !busy && <FileUploadDropzone aria-invalid={state.status === "wrong_file" || missing || undefined}>{t("paymentSettings.uploadQr")}</FileUploadDropzone>}
    {busy && <Alert role="status">{state.status === "uploading" ? t("paymentSettings.uploading") : t("paymentSettings.checkingQr")}</Alert>}
    {hasImage && <div data-testid="wallet-qr-box" aria-invalid={invalid || undefined}
      className={`flex items-center gap-4 rounded-[var(--radius-card)] border bg-card p-3 ${invalid ? "border-destructive" : "border-border"}`}>
      <FileUploadPreview src={url} alt={t("paymentSettings.imagePreview")} className="size-20 max-h-20 shrink-0 object-contain" />
      <div className="flex min-w-0 flex-col gap-2">
        {fileInfo && <p className="truncate text-sm">{fileInfo}</p>}
        {state.status === "valid" && <p className="text-sm font-medium">{t("paymentSettings.qrValid")}</p>}
        {state.status === "unchecked" && <FieldDescription>{t("paymentSettings.uncheckedWithImage")}</FieldDescription>}
        <FileUploadActions>
          <FileUploadTrigger size="sm" disabled={busy}>{t("paymentSettings.changeImage")}</FileUploadTrigger>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRemove}>{t("paymentSettings.removeImage")}</Button>
        </FileUploadActions></div></div>}
    <FieldDescription>{t("paymentSettings.qrHelp")}</FieldDescription>
    {state.status === "unchecked" && !hasImage && <FieldDescription>{t("paymentSettings.uncheckedWithoutImage")}</FieldDescription>}
    {invalid && <FieldError>{t("paymentSettings.notAQr")}</FieldError>}
    {state.status === "wrong_file" && <FieldError>{t("paymentSettings.wrongFile")}</FieldError>}
    {state.status === "upload_failed" && <FieldError>{t("paymentSettings.uploadError")} <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t("paymentSettings.retry")}</Button></FieldError>}
    {state.status === "check_unavailable" && <FieldError>{t("paymentSettings.checkUnavailable")} <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t("paymentSettings.retry")}</Button></FieldError>}
    </FileUpload></Field>;
}
