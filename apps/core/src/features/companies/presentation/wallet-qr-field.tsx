import { useTranslation } from "react-i18next";
import { imageUploadLimits } from "@shared/contracts/images";
import { Alert } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { FileUpload, FileUploadActions, FileUploadDropzone, FileUploadPreview, FileUploadTrigger } from "@core/app/components/ui/file-upload";
import { FieldDescription, FieldError, FieldLabel } from "@core/app/components/ui/field";

export type WalletQrState =
  | Readonly<{ status: "empty" }>
  | Readonly<{ status: "uploading" }>
  | Readonly<{ status: "checking"; imageId: string }>
  | Readonly<{ status: "valid"; imageId: string; origin: "chosen" | "saved"; fileName?: string; size?: number }>
  | Readonly<{ status: "not_a_qr"; imageId: string }>
  | Readonly<{ status: "check_unavailable"; imageId: string }>
  // Wallet saved before the QR check existed: hidden from buyers until it is saved with a valid QR.
  | Readonly<{ status: "unchecked"; imageId: string | null }>
  // The previous image, if any, stays when the upload or the file is refused.
  | Readonly<{ status: "upload_failed"; imageId: string | null }>
  | Readonly<{ status: "wrong_file"; imageId: string | null }>;

export type WalletQrField = Readonly<{ offered: boolean; state: WalletQrState }>;

/** The save check is the one that counts, so only a missing or visibly invalid QR, or a pending wait, blocks the save. */
export function canSaveWalletQr({ offered, state }: WalletQrField): boolean {
  if (!offered) return true;
  switch (state.status) {
    case "empty": case "uploading": case "checking": case "not_a_qr": return false;
    case "valid": case "check_unavailable": return true;
    case "unchecked": case "upload_failed": case "wrong_file": return state.imageId !== null;
  }
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
  return <FileUpload accept={acceptedTypes.join(",")} disabled={busy} onFileSelect={onFile} data-testid="wallet-qr-field">
    <FieldLabel>{t("paymentSettings.qrLabel")}</FieldLabel>
    {!hasImage && !busy && <FileUploadDropzone aria-invalid={state.status === "wrong_file" || undefined}>{t("paymentSettings.uploadQr")}</FileUploadDropzone>}
    {state.status === "empty" && <FieldDescription>{t("paymentSettings.qrHelp")}</FieldDescription>}
    {busy && <Alert role="status">{state.status === "uploading" ? t("paymentSettings.uploading") : t("paymentSettings.checkingQr")}</Alert>}
    {hasImage && <>
      <FileUploadPreview src={url} alt={t("paymentSettings.imagePreview")} className={invalid ? "border-destructive" : undefined} />
      {state.status === "valid" && <p className="text-sm text-muted-foreground">
        {state.origin === "chosen" && state.fileName ? `${state.fileName}${state.size ? ` · ${formatSize(state.size)}` : ""} · ` : ""}<span className="font-medium">{t("paymentSettings.qrValid")}</span></p>}
      {state.status === "unchecked" && <FieldDescription>{t("paymentSettings.uncheckedWithImage")}</FieldDescription>}
      <FileUploadActions>
        <FileUploadTrigger size="sm" disabled={busy}>{t("paymentSettings.changeImage")}</FileUploadTrigger>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRemove}>{t("paymentSettings.removeImage")}</Button>
      </FileUploadActions></>}
    {state.status === "unchecked" && !hasImage && <FieldDescription>{t("paymentSettings.uncheckedWithoutImage")}</FieldDescription>}
    {invalid && <FieldError>{t("paymentSettings.notAQr")}</FieldError>}
    {state.status === "wrong_file" && <FieldError>{t("paymentSettings.wrongFile")}</FieldError>}
    {state.status === "upload_failed" && <FieldError>{t("paymentSettings.uploadError")} <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t("paymentSettings.retry")}</Button></FieldError>}
    {state.status === "check_unavailable" && <FieldError>{t("paymentSettings.checkUnavailable")} <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t("paymentSettings.retry")}</Button></FieldError>}
  </FileUpload>;
}
