/** The project's canonical international phone format (E.164-shaped). */
export const internationalPhonePattern = /^\+[1-9]\d{7,14}$/;

export type PhoneCountry = Readonly<{ iso: string; dial: string }>;
export type SplitPhone = Readonly<{ country: string; national: string }>;

export const defaultPhoneCountry = "PE";

/**
 * ISO 3166-1 alpha-2 and calling code without the "+". When several countries share a code the
 * first one listed is the main one (US for 1, RU for 7, GB for 44...). Territories of the North
 * American plan carry their area code (Jamaica 1876) so a saved number still splits correctly.
 */
const countryDialCodes = `
AF93 AL355 DZ213 AS1684 AD376 AO244 AI1264 AG1268 AR54 AM374 AW297 AU61 AT43 AZ994 BS1242 BH973 BD880 BB1246 BY375 BE32
BZ501 BJ229 BM1441 BT975 BO591 BA387 BW267 BR55 IO246 VG1284 BN673 BG359 BF226 BI257 KH855 CM237 US1 CA1 CV238 BQ599 KY1345
CF236 TD235 CL56 CN86 CO57 KM269 CG242 CD243 CK682 CR506 CI225 HR385 CU53 CW599 CY357 CZ420 DK45 DJ253 DM1767 DO1809
EC593 EG20 SV503 GQ240 ER291 EE372 SZ268 ET251 FK500 FO298 FJ679 FI358 AX358 FR33 GF594 PF689 GA241 GM220 GE995 DE49 GH233
GI350 GR30 GL299 GD1473 GP590 BL590 MF590 GU1671 GT502 GB44 GG44 IM44 JE44 GN224 GW245 GY592 HT509 HN504 HK852 HU36 IS354
IN91 ID62 IR98 IQ964 IE353 IL972 IT39 JM1876 JP81 JO962 RU7 KZ7 KE254 KI686 XK383 KW965 KG996 LA856 LV371 LB961 LS266 LR231
LY218 LI423 LT370 LU352 MO853 MG261 MW265 MY60 MV960 ML223 MT356 MH692 MQ596 MR222 MU230 RE262 YT262 MX52 FM691 MD373 MC377
MN976 ME382 MS1664 MA212 EH212 MZ258 MM95 NA264 NR674 NP977 NL31 NC687 NZ64 NI505 NE227 NG234 NU683 KP850 MK389 MP1670 NO47
SJ47 OM968 PK92 PW680 PS970 PA507 PG675 PY595 PE51 PH63 PL48 PT351 PR1787 QA974 RO40 RW250 SH290 KN1869 LC1758 PM508 VC1784
WS685 SM378 ST239 SA966 SN221 RS381 SC248 SL232 SG65 SX1721 SK421 SI386 SB677 SO252 ZA27 KR82 SS211 ES34 LK94 SD249 SR597
SE46 CH41 SY963 TW886 TJ992 TZ255 TH66 TL670 TG228 TK690 TO676 TT1868 TN216 TR90 TM993 TC1649 TV688 UG256 UA380 AE971 UY598
VI1340 UZ998 VU678 VE58 VN84 WF681 YE967 ZM260 ZW263
`;

export const phoneCountries: readonly PhoneCountry[] = countryDialCodes.trim().split(/\s+/)
  .map(entry => ({ iso: entry.slice(0, 2), dial: entry.slice(2) }));

const dialByIso = new Map(phoneCountries.map(country => [country.iso, country.dial]));
const mainCountryByDial = new Map<string, string>();
for (const country of phoneCountries) if (!mainCountryByDial.has(country.dial)) mainCountryByDial.set(country.dial, country.iso);

const longestDial = Math.max(...phoneCountries.map(country => country.dial.length));
const digitsOf = (text: string) => text.replace(/\D/g, "");

/** Dial code (without "+") of a country; falls back to the default country for an unknown ISO code. */
export function dialCodeOf(iso: string): string {
  return dialByIso.get(iso) ?? dialByIso.get(defaultPhoneCountry)!;
}

/** E.164 phone from a country and a national number typed in any format; empty when no digits were typed. */
export function joinPhone(iso: string, nationalNumber: string): string {
  const digits = digitsOf(nationalNumber);
  return digits ? `+${dialCodeOf(iso)}${digits}` : "";
}

/** Country (the main one for shared codes) and national digits of an international phone, or null when the code is unknown. */
export function splitPhone(phone: string): SplitPhone | null {
  const text = phone.trim();
  if (!text.startsWith("+")) return null;
  const digits = digitsOf(text);
  for (let length = Math.min(longestDial, digits.length); length > 0; length--) {
    const country = mainCountryByDial.get(digits.slice(0, length));
    if (country) return { country, national: digits.slice(length) };
  }
  return null;
}

/** A saved phone as the checkout form holds it: E.164 stays, any other phone becomes its digits under the default country, as the field shows it. */
export function savedPhoneForForm(phone: string): string {
  return splitPhone(phone) ? phone.trim() : joinPhone(defaultPhoneCountry, phone);
}
