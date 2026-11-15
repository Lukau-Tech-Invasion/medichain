/**
 * "Insert template" on the SOAP note (mockup c4): choose one of the
 * facility's note templates without leaving the note.
 *
 * The template is rendered by the server, as on the template screen, and split
 * into S/O/A/P by the same `toSoapDraft`. The caller adds it to what is already
 * written; nothing typed is ever replaced by a template.
 */
import { useEffect, useRef, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { getNoteTemplates, useNoteTemplate as renderNoteTemplate, useTranslation } from '@medichain/shared';
import { toSoapDraft, type SoapDraft } from '../../utils/noteDraft';

interface TemplateChoice {
  id: string;
  name: string;
  soap: boolean;
}

/** Active templates, SOAP ones first; a row without an id or a name is not offered. */
export function templateChoices(records: Record<string, unknown>[]): TemplateChoice[] {
  return records
    .filter((r) => r.is_active !== false && r.isActive !== false)
    .map((r) => ({
      id: String(r.template_id ?? r.templateId ?? ''),
      name: String(r.name ?? ''),
      soap: r.type === 'soap' || String(r.category ?? '').toLowerCase() === 'soap',
    }))
    .filter((c) => c.id && c.name)
    .sort((a, b) => Number(b.soap) - Number(a.soap) || a.name.localeCompare(b.name));
}

type ListState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; choices: TemplateChoice[] };

export function InsertTemplateMenu({ onInsert }: { onInsert: (draft: SoapDraft) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setList({ kind: 'loading' });
    getNoteTemplates().then(
      (body) => active && setList({ kind: 'ready', choices: templateChoices(body.templates ?? []) }),
      () => active && setList({ kind: 'failed' }),
    );
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => { active = false; document.removeEventListener('mousedown', close); };
  }, [open]);

  const choose = async (choice: TemplateChoice) => {
    setBusyId(choice.id);
    setFailed(false);
    try {
      const result = await renderNoteTemplate({ template_id: choice.id, variables: {} });
      const sections = result.rendered_sections
        ?? Object.entries(result.rendered_content).map(([title, content]) => ({ title, content: String(content) }));
      onInsert(toSoapDraft(choice.name, sections));
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div ref={root} className="relative" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="soap-template-menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-border-interactive px-3 text-sm font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Copy size={16} aria-hidden="true" />
        {t('docSOAPNote.insertTemplate')}
      </button>
      {open && (
        <div id="soap-template-menu" className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-border bg-surface p-1 shadow-lg">
          {list.kind === 'loading' && <p className="px-3 py-2 text-sm text-content-muted">{t('docSOAPNote.templatesLoading')}</p>}
          {list.kind === 'failed' && <p role="alert" className="px-3 py-2 text-sm text-critical-subtle-fg">{t('docSOAPNote.templatesFailed')}</p>}
          {list.kind === 'ready' && list.choices.length === 0 && (
            <p className="px-3 py-2 text-sm text-content-muted">{t('docSOAPNote.noTemplates')}</p>
          )}
          {list.kind === 'ready' && list.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busyId !== null}
              onClick={() => void choose(c)}
              className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:text-disabled-fg"
            >
              <span className="truncate">{c.name}</span>
              {busyId === c.id && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            </button>
          ))}
          {failed && <p role="alert" className="px-3 py-2 text-sm text-critical-subtle-fg">{t('docSOAPNote.templateInsertFailed')}</p>}
          <p className="border-t border-border px-3 py-2 text-xs text-content-muted">{t('docSOAPNote.templateAddsHint')}</p>
        </div>
      )}
    </div>
  );
}
