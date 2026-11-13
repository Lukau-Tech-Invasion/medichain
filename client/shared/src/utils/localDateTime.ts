/** Format an instant for an HTML datetime-local input in the browser timezone. */
export function localDateTimeInput(date: Date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Format the local calendar date for an HTML date input. */
export function localDateInput(date: Date = new Date()): string {
  return localDateTimeInput(date).slice(0, 10);
}
