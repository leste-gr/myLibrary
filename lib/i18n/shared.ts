import { el } from "./el";

export type Locale = "en" | "el";
export const LOCALE_COOKIE = "mylibrary-language";
export function parseLocale(value: unknown): Locale { return value === "el" ? "el" : "en"; }
const english = new Map(Object.entries(el).map(([key, value]) => [value, key]));
// Validation messages include a book position and schema field; translate the
// surrounding message while preserving these values exactly.
const validationPatterns = Object.keys(el).filter(key => /^(Book |schemaVersion |books )/.test(key) && key.includes("{0}")).map(key => ({
  key,
  pattern: new RegExp("^" + key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)") + "$"),
}));
export function translator(locale: Locale) {
  return (message: string, values: readonly unknown[] = []): string => {
    let key = english.get(message) ?? message;
    if (locale === "el" && !el[key]) {
      for (const entry of validationPatterns) {
        const match = entry.pattern.exec(key);
        if (match) { key = entry.key; values = match.slice(1); break; }
      }
    }
    const text = locale === "el" ? el[key] ?? key : key;
    return text.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
      Number(index) < values.length ? String(values[Number(index)]) : placeholder);
  };
}
