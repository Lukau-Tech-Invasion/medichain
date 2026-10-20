/**
 * Carrying a rendered note template into a note.
 *
 * "Use template" used to show the text inside the template card and stop
 * there: nothing could take it into a note, and nothing copied it. The
 * template screen now stashes the rendered sections here and opens the note
 * page, which takes them once on load and fills its fields.
 *
 * sessionStorage, not a URL: template text can carry clinical wording and
 * must not land in browser history or server logs. It is taken (read and
 * removed) once, and ignored when older than a few minutes, so a stale draft
 * never fills a note someone opens later.
 */

const KEY = 'medichain:note-template-draft';
const MAX_AGE_MS = 5 * 60_000;

export interface TemplateSectionText {
  title: string;
  content: string;
}

/** The four SOAP buckets a note page fills. */
export interface SoapDraft {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  templateName: string;
}

export function stashNoteDraft(templateName: string, sections: TemplateSectionText[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ templateName, sections, at: Date.now() }));
  } catch {
    // Storage blocked: the copy button still works.
  }
}

function bucketOf(title: string): keyof Omit<SoapDraft, 'templateName'> | null {
  const t = title.trim().toLowerCase();
  if (t.startsWith('subj') || t.includes('history') || t.includes('complaint')) return 'subjective';
  if (t.startsWith('obj') || t.includes('exam') || t.includes('vital')) return 'objective';
  if (t.startsWith('assess') || t.includes('diagnos') || t.includes('impression')) return 'assessment';
  if (t.startsWith('plan') || t.includes('treatment') || t.includes('follow')) return 'plan';
  return null;
}

/**
 * Map rendered sections to S/O/A/P. A section whose title names no bucket goes
 * into the plan under its own title, rather than being dropped.
 */
export function toSoapDraft(templateName: string, sections: TemplateSectionText[]): SoapDraft {
  const draft: SoapDraft = { subjective: '', objective: '', assessment: '', plan: '', templateName };
  for (const section of sections) {
    const bucket = bucketOf(section.title);
    const text = bucket ? section.content : `${section.title}:\n${section.content}`;
    const target = bucket ?? 'plan';
    draft[target] = draft[target] ? `${draft[target]}\n\n${text}` : text;
  }
  return draft;
}

/** The waiting draft, removed as it is read; `null` when none or stale. */
export function takeNoteDraft(): SoapDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const stored = JSON.parse(raw) as { templateName?: string; sections?: TemplateSectionText[]; at?: number };
    if (!stored.at || Date.now() - stored.at > MAX_AGE_MS || !Array.isArray(stored.sections)) return null;
    return toSoapDraft(stored.templateName ?? 'template', stored.sections);
  } catch {
    return null;
  }
}

/** The rendered template as plain text, for the clipboard. */
export function templateAsText(sections: TemplateSectionText[]): string {
  return sections.map((section) => `${section.title}\n${section.content}`).join('\n\n');
}
