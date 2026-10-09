/**
 * RFC 4180 CSV with spreadsheet formula-injection protection.
 *
 * Several exported columns are ultimately caller-controlled (question text,
 * self-reported KYC fields, free-form verifier ids). A cell that starts
 * with = + - @ TAB or CR would be executed as a formula by Excel/Sheets, so
 * it is prefixed with a single quote before quoting.
 */

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Objects -> CSV using `columns` as both header and key order. */
export function recordsToCsv<T extends Record<string, unknown>>(columns: readonly (keyof T & string)[], records: readonly T[]): string {
  return toCsv(columns, records.map((r) => columns.map((c) => r[c])));
}

/** A UTF-8 BOM so Excel opens non-ASCII text (e.g. Arabic) correctly. */
export const CSV_BOM = '﻿';
