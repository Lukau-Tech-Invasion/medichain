/**
 * A record's text, laid out to read (mockup p5): what was found first, then the
 * details, then one folded line naming what was not recorded.
 *
 * The server sends every report as plain text in one shape: a title line,
 * "Label: value" lines, "Label:" followed by indented lines, and a closing
 * "Not recorded: a, b, c" (`api/src/handlers/ipfs_records.rs`). This only
 * re-lays that text; it adds nothing and drops nothing.
 */
import { formatTimestamp, useTranslation } from '@medichain/shared';

export interface DocumentField { label: string; value: string }
export interface ParsedDocument {
  /** Lines that are not fields: the title and any free prose. */
  prose: string[];
  /** The fields a reader came for, in the order the report gave them. */
  highlights: DocumentField[];
  fields: DocumentField[];
  notRecorded: string[];
}

const HIGHLIGHT = /^(impression|findings?|results?|interpretation|diagnosis|assessment|summary|conclusion|plan)\b/i;
const STAMP = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?\s*(UTC|Z)?)?$/;

/** A stored value as a person writes it: dates readable, true/false as Yes/No. */
export function readableValue(value: string, yes: string, no: string): string {
  const v = value.trim();
  if (/^(true|yes)$/i.test(v)) return yes;
  if (/^(false|no)$/i.test(v)) return no;
  const m = STAMP.exec(v);
  if (!m) return v;
  const iso = m[2] ? `${m[1]}T${m[2]}:00${m[3] ? 'Z' : ''}` : m[1];
  const text = m[2]
    ? formatTimestamp(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : formatTimestamp(`${iso}T12:00:00`, { day: 'numeric', month: 'short', year: 'numeric' });
  return text || v;
}

/** Split the server's text into prose, fields and the not-recorded list. */
export function parseDocument(text: string): ParsedDocument {
  const lines = text.replace(/\r/g, '').split('\n');
  const doc: ParsedDocument = { prose: [], highlights: [], fields: [], notRecorded: [] };
  const push = (label: string, value: string) => {
    const field = { label, value };
    (HIGHLIGHT.test(label) ? doc.highlights : doc.fields).push(field);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    const label = colon > 0 ? trimmed.slice(0, colon).trim() : '';
    const value = colon > 0 ? trimmed.slice(colon + 1).trim() : '';
    const isLabel = label.length > 0 && label.length <= 40 && !/^https?$/i.test(label);
    if (isLabel && label === 'Not recorded' && value) {
      doc.notRecorded = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (isLabel && value) {
      push(label, value);
    } else if (isLabel && !value && /^\s/.test(lines[i + 1] ?? '')) {
      // "Label:" with its value on the indented lines below it.
      const body: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) body.push(lines[(i += 1)].trim());
      push(label, body.join('\n'));
    } else {
      doc.prose.push(trimmed);
    }
  }
  return doc;
}

export function RecordDocument({ text }: { text: string }) {
  const { t } = useTranslation();
  const doc = parseDocument(text);
  const show = (v: string) => readableValue(v, t('common.yes'), t('common.no'));
  return (
    <div className="space-y-4">
      {doc.highlights.map((f) => (
        <div key={`h-${f.label}`} className="rounded-xl border-l-4 border-brand bg-surface-sunken px-4 py-3">
          <p className="text-sm text-content-muted">{f.label}</p>
          <p className="whitespace-pre-wrap text-lg text-content">{show(f.value)}</p>
        </div>
      ))}
      {doc.prose.length > 1 && (
        // The first prose line is the report's own title, already in the header.
        <div className="space-y-1 text-content">{doc.prose.slice(1).map((p, i) => <p key={i}>{p}</p>)}</div>
      )}
      {doc.fields.length > 0 && (
        // minmax(0, …) on both columns: a long id or code wraps inside its
        // cell instead of pushing the sheet wider than the phone.
        <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2">
          {doc.fields.map((f, i) => (
            <div key={`${f.label}-${i}`} className="contents">
              <dt className="break-words text-content-muted">{f.label}</dt>
              <dd className="whitespace-pre-wrap [overflow-wrap:anywhere] text-content">{show(f.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {doc.notRecorded.length > 0 && (
        <details className="rounded-xl border border-border bg-surface-sunken px-4 py-3">
          <summary className="cursor-pointer font-semibold text-content">
            {t('records.notRecordedCount', { n: String(doc.notRecorded.length) })}
          </summary>
          <p className="mt-2 text-sm text-content-muted">{doc.notRecorded.join(' · ')}</p>
        </details>
      )}
    </div>
  );
}
