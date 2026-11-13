/**
 * CSV for files a person opens in a spreadsheet.
 *
 * Every cell is quoted, so a comma or quote inside a value cannot shift the
 * columns after it. A value that begins with `=`, `+`, `-`, `@`, a tab or a
 * carriage return is prefixed with an apostrophe: a spreadsheet would otherwise
 * run it as a formula (CSV injection, OWASP), and an access log carries text
 * that callers supplied.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** One CSV line from a row of values. */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',');
}
