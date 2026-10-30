/** The zone every store sells in until a company time zone exists. */
export const salesTimeZone = "America/Lima";

export function limaMidnightUtc(day: string): string {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: salesTimeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${day}T12:00:00.000Z`)).find((part) => part.type === "timeZoneName")!.value.slice(3);
  return new Date(`${day}T00:00:00${offset || "+00:00"}`).toISOString();
}

export function nextCalendarDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
