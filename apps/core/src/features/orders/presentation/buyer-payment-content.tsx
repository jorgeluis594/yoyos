import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { reportPaymentResponseSchema, type BuyerPaymentView } from "@shared/contracts/orders";
import { imageResponseSchema } from "@shared/contracts/images";
import { formatCurrency } from "@core/app/format-currency";
import { Button } from "@core/app/components/ui/button";
import { Upload } from "lucide-react";

export function BuyerPaymentContent({ view }: { view: BuyerPaymentView }) {
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
    try { await navigator.clipboard.writeText(value); setCopied(`${label} copiada.`); }
    catch { setCopied("No se pudo copiar. Selecciona y copia el número mostrado."); }
  }

  async function upload(selected: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size > 10 * 1024 * 1024) { setError("Usa una imagen JPG, PNG o WEBP de hasta 10 MB."); return; }
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
      setError("No se pudo subir la captura. Inténtalo de nuevo.");
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
      setError("No se pudo enviar el aviso. Tu captura sigue lista; vuelve a intentarlo.");
    } finally { setSubmitting(false); }
  }

  return <div className="flex flex-col gap-6">

    {view.availability === "available" && (view.paymentStatus === "paid" || pendingReport || success || view.settings.length === 0) && <section aria-label="Importe pendiente" className="flex items-center justify-between gap-4 border-y py-4"><span className="font-medium">{view.paymentStatus === "paid" ? "Total pagado" : "Importe a pagar"}</span><strong className="text-xl tabular-nums">{money(view.paymentStatus === "paid" ? view.paidAmount : view.balanceDue)}</strong></section>}
    {view.availability !== "available" ? <section role="status" className="rounded-lg border bg-card p-5"><h2 className="text-lg font-semibold">{view.availability === "delivery_quote_pending" ? "Entrega pendiente de cotización" : view.availability === "cancelled" ? "Pedido cancelado" : "Confirma tu pedido"}</h2><p className="mt-2 text-muted-foreground">{view.availability === "delivery_quote_pending" ? "La tienda confirmará el costo de entrega antes de habilitar el pago." : "Contacta a la tienda para revisar tu pedido."}</p></section> : view.paymentStatus === "paid" ? <section className="rounded-lg border bg-card p-5" role="status"><h2 className="text-lg font-semibold">Pedido pagado</h2><p className="text-muted-foreground">El pago de este pedido ya está confirmado.</p></section> : <>
      <section className="flex flex-col gap-4"><h2 className="text-xl font-semibold">Cómo pagar</h2>
        {view.settings.length === 0 ? <p className="rounded-lg border bg-card p-5 text-muted-foreground">El negocio aún no ha configurado sus datos de cobro. Contacta al vendedor.</p> :
          <div className="flex flex-col gap-4"><fieldset className="grid grid-cols-2 gap-3"><legend className="sr-only">Medio de pago</legend>{view.settings.map(setting => <label key={setting.method} className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent"><input type="radio" name="payment-method" value={setting.method} checked={selectedMethod === setting.method} onChange={() => setMethod(setting.method)} className="accent-primary" />{setting.method === "digital_wallet" ? setting.provider : "Transferencia"}</label>)}</fieldset>{view.settings.filter(setting => setting.method === selectedMethod).map((setting) => <article key={setting.method} className="flex flex-col gap-3">
            <h3 className="font-semibold">{setting.method === "digital_wallet" ? "Billetera digital" : "Transferencia bancaria"}</h3>
            <dl className="flex flex-col gap-2 text-sm">{setting.method === "digital_wallet" ? <><div><dt className="text-muted-foreground">Proveedor</dt><dd>{setting.provider}</dd></div><div><dt className="text-muted-foreground">Titular</dt><dd>{setting.holder}</dd></div></> : <><div><dt className="text-muted-foreground">Banco</dt><dd>{setting.bank}</dd></div><div><dt className="text-muted-foreground">Titular</dt><dd>{setting.holder}</dd></div>{setting.accountNumber && <div><dt className="text-muted-foreground">Cuenta</dt><dd className="break-all tabular-nums">{setting.accountNumber} <Button size="sm" variant="ghost" className="text-primary" onClick={() => void copy(setting.accountNumber!, "Cuenta")}>Copiar cuenta</Button></dd></div>}{setting.cci && <div><dt className="text-muted-foreground">CCI</dt><dd className="break-all tabular-nums">{setting.cci} <Button size="sm" variant="ghost" className="text-primary" onClick={() => void copy(setting.cci!, "CCI")}>Copiar CCI</Button></dd></div>}</>}</dl>
            {setting.imageUrl && <a href={setting.imageUrl} target="_blank" rel="noreferrer" aria-label="Abrir imagen de pago"><img src={setting.imageUrl} alt={`Instrucciones de ${setting.method === "digital_wallet" ? "billetera digital" : "transferencia bancaria"}`} className="max-h-52 w-full rounded-md object-contain" /></a>}
          </article>)}</div>}
        {copied && <p role="status" className="text-sm text-muted-foreground">{copied}</p>}
      </section>
      {pendingReport || success ? <section role="status" className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Pago pendiente de revisión</h2><p className="mt-1 text-muted-foreground">El vendedor revisará la captura y confirmará el importe recibido.</p></section>
        : view.settings.length > 0 && <section className="flex flex-col gap-3 border-t pt-5"><div><h2 className="text-xl font-semibold">Adjunta tu comprobante</h2><p className="mt-1 text-sm text-muted-foreground">Adjunta tu comprobante en JPG, PNG o WEBP (hasta 10 MB). La tienda verificará el pago.</p></div>
          <label htmlFor="receipt" className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card p-4 text-sm font-medium focus-within:outline-2 focus-within:outline-ring"><Upload className="size-5 text-primary" aria-hidden="true" /><span>Captura del pago</span>
          <input className="sr-only" id="receipt" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || submitting} onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            setFile(selected); setImageId(null); paymentId.current = null; setSuccess(false);
            if (selected) void upload(selected);
          }} /><span className="max-w-full break-all text-center text-xs font-normal text-muted-foreground">{file?.name ?? "Selecciona una imagen de tu comprobante"}</span></label>
          {uploading && <p role="status" className="text-sm text-muted-foreground">Subiendo captura…</p>}
          {file && !imageId && !uploading && <Button type="button" variant="outline" onClick={() => void upload(file)}>Reintentar subida</Button>}
          {imageId && <p className="text-sm text-muted-foreground" role="status">Captura lista para enviar.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="mt-2 flex items-center justify-between gap-4 border-t pt-4"><span className="font-medium">Importe a pagar</span><strong className="text-xl tabular-nums">{money(view.balanceDue)}</strong></div>
          <Button type="button" disabled={!imageId || uploading || submitting} onClick={() => void submit()}>{submitting ? "Enviando…" : "Ya pagué"}</Button>
        </section>}
    </>}
    {view.payments.some((payment) => payment.receiptImageUrl) && <section className="flex flex-col gap-2"><h2 className="text-lg font-semibold">Comprobantes enviados</h2><ul className="flex flex-col gap-2">{view.payments.filter((payment) => payment.receiptImageUrl).map((payment) => <li key={payment.id}><a className="text-primary underline underline-offset-4" href={payment.receiptImageUrl!} target="_blank" rel="noreferrer">Ver captura · {payment.status === "reported" ? "Pendiente" : payment.status === "confirmed" ? "Confirmado" : "Anulado"}</a></li>)}</ul></section>}
  </div>;
}
