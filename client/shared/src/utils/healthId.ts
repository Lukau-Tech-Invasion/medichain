/**
 * A health ID as a person reads it aloud or copies it from a card: the prefix,
 * then the rest in groups of four ("MC-7F3A 9C21 0B44"). The stored value is
 * unchanged; this is display only. A 20-character run of letters and digits is
 * where people lose their place on a phone call to a clinic.
 */
export function formatHealthId(id: string | null | undefined): string {
  const value = (id ?? '').trim();
  if (!value) return '';
  const dash = value.indexOf('-');
  const prefix = dash > 0 && dash <= 4 ? value.slice(0, dash + 1) : '';
  const rest = value.slice(prefix.length).replace(/[\s-]+/g, '');
  const groups = rest.match(/.{1,4}/g) ?? [];
  return `${prefix}${groups.join(' ')}`;
}
