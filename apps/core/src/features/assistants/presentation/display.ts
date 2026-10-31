import { formatCurrency } from "@core/app/format-currency";
import { salesTimeZone } from "@shared/orders-date";
import type { Display } from "@core/src/features/assistants/domain/order-projection";

const lima = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: salesTimeZone, hourCycle: "h23", ...options });
const dayFormat = lima({ day: "2-digit", month: "2-digit", year: "numeric" });
const timeFormat = lima({ day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** «S/ 120.00» as the web shows it, with an ordinary space so the agent can repeat it. */
export const formatMoney = (money: Readonly<{ amount: number; currency: string }>): string =>
  formatCurrency(money.amount, money.currency, "es").replace(/\u00a0/g, " ");

/** «30/10/2026» in America/Lima. */
export const formatDate = (date: Date): string => dayFormat.format(date);

/** «30/10/2026 10:42» in America/Lima. */
export const formatDateTime = (date: Date): string => timeFormat.format(date).replace(",", "");

/** A calendar day «2026-10-30» as «30/10/2026». */
export const formatDay = (day: string): string => day.split("-").reverse().join("/");

export const display: Display = { money: formatMoney, date: formatDate, dateTime: formatDateTime, day: formatDay };
