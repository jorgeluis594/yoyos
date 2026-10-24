import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { paymentQrCheckResponseSchema, paymentSettingsResponseSchema } from "@shared/contracts/payment-settings";
import { imageResponseSchema } from "@shared/contracts/images";
import { privateUserContext } from "@core/app/private-user-context";
import { companyPaymentSettings } from "@core/src/features/companies";
import { resolvePublicImages } from "@core/src/shared/images";
import { canSaveWalletQr, isAcceptableQrFile, WalletQrField, walletQrBlockReason, walletQrImageId, type WalletQrState } from "@core/src/features/companies/presentation/wallet-qr-field";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { Alert } from "@core/app/components/ui/alert";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { FileUpload, FileUploadActions, FileUploadPreview, FileUploadTrigger } from "@core/app/components/ui/file-upload";
import { Field, FieldDescription, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { PageHeader } from "@core/app/components/ui/page-header";

export async function loader({ context }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await companyPaymentSettings.getConfiguration(access.company.id);
  if (!result.success) throw new Response("Payment settings unavailable", { status: 503 });
  const settings = paymentSettingsResponseSchema.parse({ settings: result.data }).settings;
  const ids = settings.flatMap((setting) => {
    const id = setting.method === "digital_wallet" ? setting.qr.imageId : setting.imageId;
    return id ? [id] : [];
  });
  const resolved = await resolvePublicImages(ids);
  const imageUrls: Record<string, string> = {};
  if (resolved.success) for (const image of resolved.data.images) imageUrls[image.id] = image.url;
  return { settings, imageUrls };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const access = context.get(privateUserContext);
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const settings: unknown[] = [];
  if (form.get("walletEnabled") === "on") settings.push({ method: "digital_wallet", provider: text("walletProvider"),
    holder: text("walletHolder"), imageId: text("walletImageId") });
  if (form.get("bankEnabled") === "on") settings.push({ method: "bank_transfer", bank: text("bankName"),
    holder: text("bankHolder"), accountNumber: text("accountNumber") || null, cci: text("cci") || null,
    imageId: text("bankImageId") || null });
  const saved = await companyPaymentSettings.save(access.company.id, access.user.id, settings);
  if (saved.success) return { success: true };
  return { error: saved.error.code === "INVALID_PAYMENT_SETTINGS" ? "INVALID_INPUT" : saved.error.code };
}

export default function PaymentSettings() {
  const { t } = useTranslation();
  const { settings, imageUrls } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const wallet = settings.find((setting) => setting.method === "digital_wallet");
  const bank = settings.find((setting) => setting.method === "bank_transfer");
  const [walletEnabled, setWalletEnabled] = useState(!!wallet);
  const [bankEnabled, setBankEnabled] = useState(!!bank);
  const [qr, setQr] = useState<WalletQrState>(() => initialQrState(wallet?.qr, imageUrls));
  const [walletImageUrl, setWalletImageUrl] = useState(wallet?.qr.imageId ? imageUrls[wallet.qr.imageId] ?? "" : "");
  const [bankImageId, setBankImageId] = useState(bank?.imageId ?? "");
  const [bankImageUrl, setBankImageUrl] = useState(bank?.imageId ? imageUrls[bank.imageId] ?? "" : "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const field = { offered: walletEnabled, state: qr };
  const blocked = walletQrBlockReason(field);

  // The server decides the outcome of the save check: the field follows each new action result.
  const [followedAction, setFollowedAction] = useState(actionData);
  if (actionData !== followedAction) {
    setFollowedAction(actionData);
    if (actionData?.success) setQr(qr.status === "valid" ? qr : { status: "valid", imageId: walletQrImageId(qr), origin: "saved" });
    else if (actionData?.error === "INVALID_PAYMENT_QR") setQr({ status: "not_a_qr", imageId: walletQrImageId(qr) });
    else if (actionData?.error === "QR_CHECK_UNAVAILABLE") setQr({ status: "check_unavailable", imageId: walletQrImageId(qr) });
    else if (actionData?.error === "INVALID_IMAGE") { setQr({ status: "empty" }); setWalletImageUrl(""); }
  }

  async function uploadImage(file: File) {
    const body = new FormData(); body.append("file", file);
    const response = await fetch("/api/images", { method: "POST", body });
    const image = imageResponseSchema.safeParse(await response.json());
    if (!response.ok || !image.success) throw new Error("upload");
    return image.data;
  }

  async function checkQr(imageId: string, chosen?: File) {
    setQr({ status: "checking", imageId });
    try {
      const response = await fetch("/api/company/payment-settings/qr-checks", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ imageId }) });
      const checked = paymentQrCheckResponseSchema.safeParse(await response.json());
      if (!response.ok || !checked.success) throw new Error("check");
      setQr(checked.data.status === "verified"
        ? { status: "valid", imageId, origin: "chosen", ...(chosen ? { fileName: chosen.name, size: chosen.size } : {}) }
        : { status: "not_a_qr", imageId });
    } catch { setQr({ status: "check_unavailable", imageId }); }
  }

  async function chooseWalletImage(file: File) {
    const previous = walletQrImageId(qr) || null;
    if (!isAcceptableQrFile(file)) { setQr({ status: "wrong_file", imageId: previous }); return; }
    setQr({ status: "uploading" });
    try {
      const image = await uploadImage(file);
      setWalletImageUrl(image.url);
      await checkQr(image.id, file);
    } catch { setQr({ status: "upload_failed", imageId: previous }); }
  }

  async function uploadBankImage(file: File) {
    setUploading(true); setUploadError("");
    try {
      const image = await uploadImage(file);
      setBankImageId(image.id); setBankImageUrl(image.url);
    } catch { setUploadError(t("paymentSettings.uploadError")); }
    finally { setUploading(false); }
  }

  return <div className="flex flex-col gap-6"><PageHeader><PageHeader.Heading><PageHeader.Title>{t("paymentSettings.title")}</PageHeader.Title>
    <PageHeader.Description>{t("paymentSettings.description")}</PageHeader.Description></PageHeader.Heading></PageHeader>
    <Form method="post" className="flex flex-col gap-5">
      <input type="hidden" name="walletImageId" value={walletQrImageId(qr)} /><input type="hidden" name="bankImageId" value={bankImageId} />
      <Card><CardHeader><CardTitle>{t("paymentSettings.wallet")}</CardTitle><CardDescription>{t("paymentSettings.walletHint")}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4"><Field orientation="horizontal"><Checkbox id="wallet-enabled" name="walletEnabled" checked={walletEnabled} onCheckedChange={(checked) => setWalletEnabled(checked === true)} /><FieldLabel htmlFor="wallet-enabled">{t("paymentSettings.enableWallet")}</FieldLabel></Field>
          {walletEnabled && <><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="wallet-provider">{t("paymentSettings.provider")}</FieldLabel><Input id="wallet-provider" name="walletProvider" defaultValue={wallet?.method === "digital_wallet" ? wallet.provider : ""} required /></Field>
            <Field><FieldLabel htmlFor="wallet-holder">{t("paymentSettings.holder")}</FieldLabel><Input id="wallet-holder" name="walletHolder" defaultValue={wallet?.method === "digital_wallet" ? wallet.holder : ""} required /></Field></div>
            <WalletQrField state={qr} url={walletImageUrl} onFile={(file) => void chooseWalletImage(file)}
              onRetry={() => { const id = walletQrImageId(qr); if (id) void checkQr(id); }}
              onRemove={() => { setQr({ status: "empty" }); setWalletImageUrl(""); }} /></>}
        </CardContent></Card>
      <Card><CardHeader><CardTitle>{t("paymentSettings.bankTransfer")}</CardTitle><CardDescription>{t("paymentSettings.bankHint")}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4"><Field orientation="horizontal"><Checkbox id="bank-enabled" name="bankEnabled" checked={bankEnabled} onCheckedChange={(checked) => setBankEnabled(checked === true)} /><FieldLabel htmlFor="bank-enabled">{t("paymentSettings.enableBank")}</FieldLabel></Field>
          {bankEnabled && <><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="bank-name">{t("paymentSettings.bank")}</FieldLabel><Input id="bank-name" name="bankName" defaultValue={bank?.method === "bank_transfer" ? bank.bank : ""} required /></Field>
            <Field><FieldLabel htmlFor="bank-holder">{t("paymentSettings.holder")}</FieldLabel><Input id="bank-holder" name="bankHolder" defaultValue={bank?.method === "bank_transfer" ? bank.holder : ""} required /></Field>
            <Field><FieldLabel htmlFor="bank-account">{t("paymentSettings.accountNumber")}</FieldLabel><Input id="bank-account" name="accountNumber" inputMode="numeric" defaultValue={bank?.method === "bank_transfer" ? bank.accountNumber ?? "" : ""} /></Field>
            <Field><FieldLabel htmlFor="bank-cci">{t("paymentSettings.cci")}</FieldLabel><Input id="bank-cci" name="cci" inputMode="numeric" defaultValue={bank?.method === "bank_transfer" ? bank.cci ?? "" : ""} /></Field></div>
            <FieldDescription>{t("paymentSettings.bankIdentifierHint")}</FieldDescription>
            <ImageControl label={t("paymentSettings.optionalImage")} url={bankImageUrl} uploading={uploading} onFile={(file) => void uploadBankImage(file)}
              onRemove={() => { setBankImageId(""); setBankImageUrl(""); }} /></>}
        </CardContent></Card>
      {uploadError && <Alert variant="destructive">{uploadError}</Alert>}
      {actionData?.error && <Alert variant="destructive">{t("paymentSettings.saveError")}</Alert>}
      {actionData?.success && <Alert variant="success">{t("paymentSettings.saved")}</Alert>}
      {blocked && <FieldDescription>{t(blocked === "invalid" ? "paymentSettings.invalidQr" : "paymentSettings.missingQr")}</FieldDescription>}
      <Button type="submit" disabled={uploading || !canSaveWalletQr(field) || navigation.state !== "idle"} className="self-start">{navigation.state === "submitting" ? t("paymentSettings.saving") : t("paymentSettings.save")}</Button>
    </Form>
  </div>;
}

type StoredQr = { status: "verified"; imageId: string } | { status: "unchecked"; imageId: string | null } | undefined;

function initialQrState(qr: StoredQr, imageUrls: Record<string, string>): WalletQrState {
  if (!qr) return { status: "empty" };
  if (qr.status === "verified") return { status: "valid", imageId: qr.imageId, origin: "saved" };
  // An image whose URL does not resolve cannot be shown, so the seller uploads again.
  return { status: "unchecked", imageId: qr.imageId && imageUrls[qr.imageId] ? qr.imageId : null };
}

function ImageControl({ label, url, uploading, onFile, onRemove }: { label: string; url: string; uploading: boolean;
  onFile: (file: File) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  return <FileUpload accept="image/jpeg,image/png,image/webp" disabled={uploading} onFileSelect={onFile}>
    <FileUploadActions><FileUploadTrigger>{label}</FileUploadTrigger></FileUploadActions>
    {uploading && <Alert>{t("paymentSettings.uploading")}</Alert>}
    {url && <><FileUploadPreview src={url} alt={t("paymentSettings.imagePreview")} />
      <FileUploadActions><Button type="button" size="sm" variant="outline" onClick={onRemove}>{t("paymentSettings.removeImage")}</Button></FileUploadActions></>}
  </FileUpload>;
}
