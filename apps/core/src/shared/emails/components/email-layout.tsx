import type { ReactNode } from "react";
import { toPlainText } from "@react-email/render";
import { useTranslation } from "react-i18next";
import { emailColors as c, emailDarkCss, emailFont, emailRadius } from "@core/src/shared/emails/components/email-theme";

type EmailLayoutProps = Readonly<{
  preview: string;
  category: string;
  fallbackUrl: string;
  children: ReactNode;
}>;

const cell = { padding: "0 32px" } as const;
const divider = { borderTop: `1px solid ${c.border}` } as const;

// Layout cells become separate lines so labels and values do not run together in the text version.
export function emailPlainText(html: string): string {
  return toPlainText(html, { selectors: [{ selector: "td", format: "block" }, { selector: "h1", options: { uppercase: false } }] });
}

// Shared frame: brand and category header, the email's own content, a fallback link band, and the notice outside the card.
export function EmailLayout({ preview, category, fallbackUrl, children }: EmailLayoutProps) {
  const { t, i18n } = useTranslation();
  return <html lang={i18n.language === "pt" ? "pt-BR" : "es"}>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <meta name="supported-color-schemes" content="light dark" />
      <title>{preview}</title>
      <style dangerouslySetInnerHTML={{ __html: emailDarkCss }} />
    </head>
    <body className="email-canvas" style={{ backgroundColor: c.canvas, color: c.text, fontFamily: emailFont, margin: 0, padding: 0 }}>
      <div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>{preview}</div>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} className="email-canvas" style={{ backgroundColor: c.canvas }}><tbody><tr><td align="center" style={{ padding: "40px 16px" }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: 560 }}><tbody>
          <tr><td className="email-card" style={{ backgroundColor: c.card, border: `1px solid ${c.border}`, borderRadius: emailRadius.overlay }}>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}><tbody>
              <tr><td style={{ ...cell, paddingTop: 20, paddingBottom: 20 }}>
                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}><tbody><tr>
                  <td className="email-brand" style={{ color: c.brand, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: "28px" }}>yoyos</td>
                  <td align="right" className="email-muted" style={{ color: c.muted, fontSize: 13, fontWeight: 500, lineHeight: "20px" }}>{category}</td>
                </tr></tbody></table>
              </td></tr>
              <tr><td className="email-divider" style={{ ...cell, ...divider, paddingTop: 32, paddingBottom: 36 }}>{children}</td></tr>
              <tr><td className="email-divider" style={{ ...cell, ...divider, paddingTop: 20, paddingBottom: 20 }}>
                <p className="email-muted" style={{ color: c.muted, fontSize: 13, lineHeight: "20px", margin: 0 }}>{t("emails.fallback")}</p>
                <p style={{ fontSize: 13, lineHeight: "20px", margin: 0, wordBreak: "break-all" }}><a href={fallbackUrl} className="email-link" style={{ color: c.link }}>{fallbackUrl}</a></p>
              </td></tr>
            </tbody></table>
          </td></tr>
          <tr><td style={{ ...cell, paddingTop: 20 }}>
            <p className="email-muted" style={{ color: c.muted, fontSize: 12, lineHeight: "18px", margin: 0 }}>{t("emails.ignore")}</p>
            <p className="email-muted" style={{ color: c.muted, fontSize: 12, lineHeight: "18px", margin: "8px 0 0" }}>Yoyos</p>
          </td></tr>
        </tbody></table>
      </td></tr></tbody></table>
    </body>
  </html>;
}
