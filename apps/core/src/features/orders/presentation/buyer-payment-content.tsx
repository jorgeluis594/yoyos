import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { reportPaymentResponseSchema, type BuyerPaymentView } from "@shared/contracts/orders";
import { imageResponseSchema } from "@shared/contracts/images";
import { formatCurrency } from "@core/app/format-currency";
import { Button } from "@core/app/components/ui/button";
import { Upload } from "lucide-react";

export function BuyerPaymentContent({ view }: { view: BuyerPaymentView }) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const [method, setMethod] = useState(view.settings[0]?.method);
  const [copied, setCopied] = useState("");
  const selectedMethod = view.settings.find(setting => setting.method === method)?.method ?? view.settings[0]?.method;
  const [file, setFile] = useState<File | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const paymentId = useRef<string | null>(null);
  const money = (value: typeof view.total) => formatCurrency(value.amount, value.currency, "es-PE");
  const pendingReport = view.payments.some((payment) => payment.status === "reported");

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(t("buyerPaymentContent.copied", { label })); }
    catch { setCopied(t("buyerPaymentContent.copyFailed")); }
  }

  async function upload(selected: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size > 10 * 1024 * 1024) { setError(t("buyerPaymentContent.invalidImage")); return; }
    setUploading(true);
    setError("");
    const body = new FormData();
    body.append("file", selected);
    try {
      const response = await fetch(`/api/buyer/orders/${view.orderId}/images`, { method: "POST", body });
      const parsed = imageResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("upload");
      setImageId(parsed.data.id);
    } catch {
      setError(t("buyerPaymentContent.uploadFailed"));
    } finally { setUploading(false); }
  }

  async function submit() {
    if (!imageId || submitting) return;
    paymentId.current ??= crypto.randomUUID();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/buyer/orders/${view.orderId}/reports`, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentId: paymentId.current, receiptImageId: imageId }) });
      const parsed = reportPaymentResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("report");
      setSuccess(true);
      revalidator.revalidate();
    } catch {
      setError(t("buyerPaymentContent.reportFailed"));
    } finally { setSubmitting(false); }
  }

  return <div className="flex flex-col gap-6">
    <section aria-label={t("buyerPaymentContent.summary")} className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{t("buyerPaymentContent.total")}</span><strong className="text-xl tabular-nums">{money(view.total)}</strong></div>
      {view.deliveryCharge.amount > 0 && <div className="mt-3 flex items-center justify-between gap-4 text-sm"><span className="text-muted-foreground">{t("buyerPaymentContent.includesDelivery")}</span><span className="tabular-nums">{money(view.deliveryCharge)}</span></div>}
      <div className="mt-5 flex items-center justify-between gap-4 border-t pt-4"><span className="font-medium">{t("buyerPaymentContent.balanceDue")}</span><strong className="text-xl tabular-nums">{money(view.balanceDue)}</strong></div>
    </section>
    {view.availability !== "available" ? <section role="status" className="rounded-lg border bg-card p-5"><h2 className="text-lg font-semibold">{t(view.availability === "delivery_quote_pending" ? "buyerPaymentContent.quotePendingTitle" : view.availability === "cancelled" ? "buyerPaymentContent.cancelledTitle" : "buyerPaymentContent.confirmTitle")}</h2><p className="mt-2 text-muted-foreground">{t(view.availability === "delivery_quote_pending" ? "buyerPaymentContent.quotePendingBody" : "buyerPaymentContent.contactStore")}</p></section> : view.paymentStatus === "paid" ? <section className="rounded-lg border bg-card p-5" role="status"><h2 className="text-lg font-semibold">{t("buyerPaymentContent.paidTitle")}</h2><p className="text-muted-foreground">{t("buyerPaymentContent.paidBody")}</p></section> : <>
      <section className="flex flex-col gap-4"><h2 className="text-xl font-semibold">{t("buyerPaymentContent.howToPay")}</h2>
        {view.settings.length === 0 ? <p className="rounded-lg border bg-card p-5 text-muted-foreground">{t("buyerPaymentContent.noSettings")}</p> :
          <div className="flex flex-col gap-4"><fieldset className="grid grid-cols-2 gap-3"><legend className="sr-only">{t("buyerPaymentContent.paymentMethod")}</legend>{view.settings.map(setting => <label key={setting.method} className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent"><input type="radio" name="payment-method" value={setting.method} checked={selectedMethod === setting.method} onChange={() => setMethod(setting.method)} className="accent-primary" />{setting.method === "digital_wallet" ? setting.provider : t("buyerPaymentContent.transfer")}</label>)}</fieldset>{view.settings.filter(setting => setting.method === selectedMethod).map((setting) => <article key={setting.method} className="flex flex-col gap-3">
            <h3 className="font-semibold">{t(setting.method === "digital_wallet" ? "buyerPaymentContent.wallet" : "buyerPaymentContent.bankTransfer")}</h3>
            <dl className="flex flex-col gap-2 text-sm">{setting.method === "digital_wallet" ? <><div><dt className="text-muted-foreground">{t("buyerPaymentContent.provider")}</dt><dd>{setting.provider}</dd></div><div><dt className="text-muted-foreground">{t("buyerPaymentContent.holder")}</dt><dd>{setting.holder}</dd></div></> : <><div><dt className="text-muted-foreground">{t("buyerPaymentContent.bank")}</dt><dd>{setting.bank}</dd></div><div><dt className="text-muted-foreground">{t("buyerPaymentContent.holder")}</dt><dd>{setting.holder}</dd></div>{setting.accountNumber && <div><dt className="text-muted-foreground">{t("buyerPaymentContent.account")}</dt><dd className="break-all tabular-nums">{setting.accountNumber} <Button size="sm" variant="ghost" className="text-primary" onClick={() => void copy(setting.accountNumber!, t("buyerPaymentContent.account"))}>{t("buyerPaymentContent.copyAccount")}</Button></dd></div>}{setting.cci && <div><dt className="text-muted-foreground">CCI</dt><dd className="break-all tabular-nums">{setting.cci} <Button size="sm" variant="ghost" className="text-primary" onClick={() => void copy(setting.cci!, "CCI")}>{t("buyerPaymentContent.copyCci")}</Button></dd></div>}</>}</dl>
            {setting.imageUrl && <a href={setting.imageUrl} target="_blank" rel="noreferrer" aria-label={t("buyerPaymentContent.openImage")}><img src={setting.imageUrl} alt={t("buyerPaymentContent.instructions", { method: t(setting.method === "digital_wallet" ? "buyerPaymentContent.walletLower" : "buyerPaymentContent.bankTransferLower") })} className="max-h-52 w-full rounded-md object-contain" /></a>}
          </article>)}</div>}
        {copied && <p role="status" className="text-sm text-muted-foreground">{copied}</p>}
      </section>
      {pendingReport || success ? <section role="status" className="rounded-lg border bg-card p-5"><h2 className="font-semibold">{t("buyerPaymentContent.pendingTitle")}</h2><p className="mt-1 text-muted-foreground">{t("buyerPaymentContent.pendingBody")}</p></section>
        : view.settings.length > 0 && <section className="flex flex-col gap-3 border-t pt-5"><div><h2 className="text-xl font-semibold">{t("buyerPaymentContent.attachTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("buyerPaymentContent.attachBody")}</p></div>
          <label htmlFor="receipt" className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card p-4 text-sm font-medium focus-within:outline-2 focus-within:outline-ring"><Upload className="size-5 text-primary" aria-hidden="true" /><span>{t("buyerPaymentContent.screenshot")}</span>
          <input className="sr-only" id="receipt" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || submitting} onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            setFile(selected); setImageId(null); paymentId.current = null; setSuccess(false);
            if (selected) void upload(selected);
          }} /><span className="max-w-full break-all text-center text-xs font-normal text-muted-foreground">{file?.name ?? t("buyerPaymentContent.selectImage")}</span></label>
          {uploading && <p role="status" className="text-sm text-muted-foreground">{t("buyerPaymentContent.uploading")}</p>}
          {file && !imageId && !uploading && <Button type="button" variant="outline" onClick={() => void upload(file)}>{t("buyerPaymentContent.retryUpload")}</Button>}
          {imageId && <p className="text-sm text-muted-foreground" role="status">{t("buyerPaymentContent.ready")}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="button" disabled={!imageId || uploading || submitting} onClick={() => void submit()}>{submitting ? t("buyerPaymentContent.sending") : t("buyerPaymentContent.paid")}</Button>
        </section>}
    </>}
    {view.payments.some((payment) => payment.receiptImageUrl) && <section className="flex flex-col gap-2"><h2 className="text-lg font-semibold">{t("buyerPaymentContent.sentReceipts")}</h2><ul className="flex flex-col gap-2">{view.payments.filter((payment) => payment.receiptImageUrl).map((payment) => <li key={payment.id}><a className="text-primary underline underline-offset-4" href={payment.receiptImageUrl!} target="_blank" rel="noreferrer">{t("buyerPaymentContent.viewScreenshot", { status: t(`buyerPaymentContent.status.${payment.status}`) })}</a></li>)}</ul></section>}
  </div>;
}
