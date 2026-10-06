import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { paymentSettingsSchema } from "@shared/contracts/payment-settings";
import { imageResponseSchema } from "@shared/contracts/images";
import { privateUserContext } from "@core/app/private-user-context";
import { companyPaymentSettings } from "@core/src/features/companies";
import { resolvePublicImage } from "@core/src/shared/images";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { PageHeader } from "@core/app/components/ui/page-header";

export async function loader({ context }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await companyPaymentSettings.get(access.company.id);
  if (!result.success) throw new Response("Payment settings unavailable", { status: 503 });
  const settings = paymentSettingsSchema.parse({ settings: result.data }).settings;
  const imageUrls: Record<string, string> = {};
  for (const setting of settings) {
    if (!setting.imageId) continue;
    const image = await resolvePublicImage(setting.imageId);
    if (image.success && image.data) imageUrls[setting.imageId] = image.data.url;
  }
  return { settings, imageUrls };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const access = context.get(privateUserContext);
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const settings: unknown[] = [];
  if (form.get("walletEnabled") === "on") settings.push({ method: "digital_wallet", provider: text("walletProvider"),
    holder: text("walletHolder"), imageId: text("walletImageId") || null });
  if (form.get("bankEnabled") === "on") settings.push({ method: "bank_transfer", bank: text("bankName"),
    holder: text("bankHolder"), accountNumber: text("accountNumber") || null, cci: text("cci") || null,
    imageId: text("bankImageId") || null });
  const parsed = paymentSettingsSchema.safeParse({ settings });
  if (!parsed.success) return { error: "INVALID_INPUT" };
  const saved = await companyPaymentSettings.save(access.company.id, access.user.id, parsed.data.settings);
  return saved.success ? { success: true } : { error: saved.error.code };
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
  const [walletImageId, setWalletImageId] = useState(wallet?.imageId ?? "");
  const [bankImageId, setBankImageId] = useState(bank?.imageId ?? "");
  const [walletImageUrl, setWalletImageUrl] = useState(wallet?.imageId ? imageUrls[wallet.imageId] ?? "" : "");
  const [bankImageUrl, setBankImageUrl] = useState(bank?.imageId ? imageUrls[bank.imageId] ?? "" : "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function upload(file: File, method: "wallet" | "bank") {
    setUploading(true); setUploadError("");
    const body = new FormData(); body.append("file", file);
    try {
      const response = await fetch("/api/images", { method: "POST", body });
      const image = imageResponseSchema.safeParse(await response.json());
      if (!response.ok || !image.success) throw new Error("upload");
      if (method === "wallet") { setWalletImageId(image.data.id); setWalletImageUrl(image.data.url); }
      else { setBankImageId(image.data.id); setBankImageUrl(image.data.url); }
    } catch { setUploadError(t("paymentSettings.uploadError")); }
    finally { setUploading(false); }
  }

  return <div className="flex flex-col gap-6"><PageHeader><PageHeader.Heading><PageHeader.Title>{t("paymentSettings.title")}</PageHeader.Title>
    <PageHeader.Description>{t("paymentSettings.description")}</PageHeader.Description></PageHeader.Heading></PageHeader>
    <Form method="post" className="flex flex-col gap-5">
      <input type="hidden" name="walletImageId" value={walletImageId} /><input type="hidden" name="bankImageId" value={bankImageId} />
      <Card><CardHeader><CardTitle>{t("paymentSettings.wallet")}</CardTitle><CardDescription>{t("paymentSettings.walletHint")}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="walletEnabled" checked={walletEnabled} onChange={(event) => setWalletEnabled(event.target.checked)} />{t("paymentSettings.enableWallet")}</label>
          {walletEnabled && <><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="wallet-provider">{t("paymentSettings.provider")}</FieldLabel><Input id="wallet-provider" name="walletProvider" defaultValue={wallet?.method === "digital_wallet" ? wallet.provider : ""} required /></Field>
            <Field><FieldLabel htmlFor="wallet-holder">{t("paymentSettings.holder")}</FieldLabel><Input id="wallet-holder" name="walletHolder" defaultValue={wallet?.method === "digital_wallet" ? wallet.holder : ""} required /></Field></div>
            <ImageControl label={t("paymentSettings.optionalImage")} url={walletImageUrl} uploading={uploading} onFile={(file) => void upload(file, "wallet")}
              onRemove={() => { setWalletImageId(""); setWalletImageUrl(""); }} /></>}
        </CardContent></Card>
      <Card><CardHeader><CardTitle>{t("paymentSettings.bankTransfer")}</CardTitle><CardDescription>{t("paymentSettings.bankHint")}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="bankEnabled" checked={bankEnabled} onChange={(event) => setBankEnabled(event.target.checked)} />{t("paymentSettings.enableBank")}</label>
          {bankEnabled && <><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="bank-name">{t("paymentSettings.bank")}</FieldLabel><Input id="bank-name" name="bankName" defaultValue={bank?.method === "bank_transfer" ? bank.bank : ""} required /></Field>
            <Field><FieldLabel htmlFor="bank-holder">{t("paymentSettings.holder")}</FieldLabel><Input id="bank-holder" name="bankHolder" defaultValue={bank?.method === "bank_transfer" ? bank.holder : ""} required /></Field>
            <Field><FieldLabel htmlFor="bank-account">{t("paymentSettings.accountNumber")}</FieldLabel><Input id="bank-account" name="accountNumber" inputMode="numeric" defaultValue={bank?.method === "bank_transfer" ? bank.accountNumber ?? "" : ""} /></Field>
            <Field><FieldLabel htmlFor="bank-cci">{t("paymentSettings.cci")}</FieldLabel><Input id="bank-cci" name="cci" inputMode="numeric" defaultValue={bank?.method === "bank_transfer" ? bank.cci ?? "" : ""} /></Field></div>
            <p className="text-sm text-muted-foreground">{t("paymentSettings.bankIdentifierHint")}</p>
            <ImageControl label={t("paymentSettings.optionalImage")} url={bankImageUrl} uploading={uploading} onFile={(file) => void upload(file, "bank")}
              onRemove={() => { setBankImageId(""); setBankImageUrl(""); }} /></>}
        </CardContent></Card>
      {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
      {actionData?.error && <p role="alert" className="text-sm text-destructive">{t("paymentSettings.saveError")}</p>}
      {actionData?.success && <p role="status" className="text-sm text-muted-foreground">{t("paymentSettings.saved")}</p>}
      <Button type="submit" disabled={uploading || navigation.state !== "idle"} className="self-start">{navigation.state === "submitting" ? t("paymentSettings.saving") : t("paymentSettings.save")}</Button>
    </Form>
  </div>;
}

function ImageControl({ label, url, uploading, onFile, onRemove }: { label: string; url: string; uploading: boolean;
  onFile: (file: File) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  return <div className="flex flex-col gap-2"><label className="text-sm font-medium">{label}<Input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
    onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); }} /></label>
    {uploading && <p className="text-sm text-muted-foreground" role="status">{t("paymentSettings.uploading")}</p>}
    {url && <div className="flex flex-col items-start gap-2"><img src={url} alt={t("paymentSettings.imagePreview")} className="max-h-40 rounded-md object-contain" />
      <Button type="button" size="sm" variant="outline" onClick={onRemove}>{t("paymentSettings.removeImage")}</Button></div>}
  </div>;
}
