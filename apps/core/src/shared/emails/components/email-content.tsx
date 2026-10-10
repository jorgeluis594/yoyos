import type { ReactNode } from "react";
import { emailColors as c, emailRadius } from "@core/src/shared/emails/components/email-theme";

// Content blocks for EmailLayout; each email composes only the blocks it needs.
export function EmailTitle({ children }: { children: ReactNode }) {
  return <h1 className="email-text" style={{ color: c.text, fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: "32px", margin: "0 0 12px" }}>{children}</h1>;
}

export function EmailText({ children }: { children: ReactNode }) {
  return <p className="email-text" style={{ color: c.text, fontSize: 16, lineHeight: "24px", margin: "0 0 28px" }}>{children}</p>;
}

export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} className="email-action" style={{ backgroundColor: c.action, borderRadius: emailRadius.control, color: c.actionText, display: "inline-block", fontSize: 15, fontWeight: 600, lineHeight: "20px", padding: "14px 24px", textDecoration: "none" }}>{children}</a>;
}

export function EmailNote({ children }: { children: ReactNode }) {
  return <p className="email-muted" style={{ color: c.muted, fontSize: 13, lineHeight: "20px", margin: "16px 0 0" }}>{children}</p>;
}

export type EmailDetail = Readonly<{ label: string; value: string }>;

export function EmailDetails({ rows }: { rows: readonly EmailDetail[] }) {
  return <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} className="email-divider" style={{ borderTop: `1px solid ${c.border}`, margin: "-4px 0 28px" }}><tbody>
    {rows.map((row) => <tr key={row.label}>
      <td className="email-muted email-divider" style={{ borderBottom: `1px solid ${c.border}`, color: c.muted, fontSize: 14, lineHeight: "20px", padding: "12px 16px 12px 0" }}>{row.label}</td>
      <td align="right" className="email-text email-divider" style={{ borderBottom: `1px solid ${c.border}`, color: c.text, fontSize: 14, fontWeight: 500, lineHeight: "20px", padding: "12px 0" }}>{row.value}</td>
    </tr>)}
  </tbody></table>;
}
