/** Latin digits in every locale (docs/09-i18n.md §3): prices, GSM, SKUs read the same in French, English and Arabic. */
const withLatinDigits = (locale: string) => `${locale}-u-nu-latn`;

export function formatMoney(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(withLatinDigits(locale), { style: "currency", currency }).format(amount);
}

export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(withLatinDigits(locale), options).format(value);
}

/** Read a translatable jsonb field {fr,en,ar}, falling back to French (the source language). */
export type I18nField = { fr?: string; en?: string; ar?: string } | null | undefined;
export function localized(field: I18nField, locale: string): string {
  if (!field) return "";
  return (field as Record<string, string | undefined>)[locale] || field.fr || "";
}

/** Only digits, for wa.me links and tel: links. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}
