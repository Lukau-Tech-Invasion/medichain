/** Check optional coverage dates as real, four-digit-year calendar dates in chronological order. */
export function validInsuranceDates(from: string, to: string): boolean {
  const start = from.trim();
  const end = to.trim();
  return validOptionalDate(start) && validOptionalDate(end) && (!start || !end || start <= end);
}

/** Reject normalized impossible dates rather than letting Date roll into another month. */
function validOptionalDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
