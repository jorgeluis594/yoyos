import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  return <html lang={i18n.language === "pt" ? "pt-BR" : "es"}><head><title>{preview}</title></head><body style={{ backgroundColor: "#f5f5f5", fontFamily: "Arial, sans-serif", margin: 0, padding: "32px 0" }}><table role="presentation" width="100%"><tbody><tr><td align="center"><table role="presentation" style={{ backgroundColor: "#ffffff", borderRadius: 8, margin: "0 auto", maxWidth: 560, padding: 32 }}><tbody><tr><td><p style={{ color: "#166534", fontSize: 20, fontWeight: 700, margin: "0 0 24px" }}>yoyos</p>{children}<p style={{ color: "#737373", fontSize: 12, marginTop: 32 }}>{t("emails.ignore")}</p></td></tr></tbody></table></td></tr></tbody></table></body></html>;
}
