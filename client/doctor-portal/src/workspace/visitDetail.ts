/**
 * One line saying what a save in "This visit" was (mockup c4): "Metformin
 * 500 mg twice daily", "HbA1c, lipid panel", "NEWS2 1 · Low".
 *
 * Read from the request the form sent and the server's answer to it, so no
 * form has to report anything. Only the common writes are described; anything
 * else keeps its form name alone rather than a guess. A clinical value is shown
 * only as the server computed it (rule 8), and an unmeasured score is left out,
 * not shown as zero (rule 12).
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const MAX = 80;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** First line, cut to fit the panel. */
export function excerpt(v: string): string {
  const line = v.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > MAX ? `${line.slice(0, MAX - 1).trimEnd()}…` : line;
}

function joined(...parts: unknown[]): string {
  return parts.map(text).filter(Boolean).join(' ');
}

function vitals(response: Record<string, unknown>, t: Translate): string {
  const news2 = obj(response.news2);
  if (typeof news2.total !== 'number' || typeof news2.band !== 'string') return '';
  return t('workspace.visitNews2', { score: news2.total, band: t(`docVitalSigns.news2Band.${news2.band}`) });
}

const DESCRIBE: Array<[RegExp, (body: Record<string, unknown>, response: Record<string, unknown>, t: Translate) => string]> = [
  [/^\/api\/clinical\/soap$/, (b) => text(obj(b.subjective).chief_complaint)],
  [/^\/api\/clinical\/vitals$/, (_b, r, t) => vitals(r, t)],
  [/^\/api\/e-prescriptions$/, (b) => joined(b.medication_name, b.strength, b.directions)],
  [/^\/api\/clinical\/order$/, (b) => text(b.order_text)],
  [/^\/api\/clinical\/progress-note$/, (b) => text(b.assessment) || text(b.subjective)],
];

/** What the save at `path` was, or `undefined` when there is nothing reliable to say. */
export function describeSave(path: string, body: unknown, response: unknown, t: Translate): string | undefined {
  const rule = DESCRIBE.find(([pattern]) => pattern.test(path));
  if (!rule) return undefined;
  const line = excerpt(rule[1](obj(body), obj(response), t));
  return line || undefined;
}
