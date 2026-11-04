/**
 * "Start from my shift": the patients this nurse recorded something for this
 * shift, plus the patients on their ward, chosen together and added to the
 * handoff in one tap (UX plan WP 5.6, mockup c2).
 */
import { useState } from 'react';
import { formatDateOnly, getApiErrorMessage, getShiftHandoffDraft, useTranslation } from '@medichain/shared';
import type { HandoffDraftPatient } from '@medichain/shared';

export function ShiftDraftPanel({ onAdd, alreadyAdded }: { onAdd: (chosen: HandoffDraftPatient[]) => void; alreadyAdded: string[] }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<HandoffDraftPatient[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await getShiftHandoffDraft();
      setDraft(r.patients);
      setChosen(new Set());
    } catch (e) {
      setError(getApiErrorMessage(e, t('handoffDraft.loadFailed')));
    } finally {
      setLoading(false);
    }
  };

  const open = (draft ?? []).filter((p) => !alreadyAdded.includes(p.patient_id));
  const toggle = (id: string) => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section aria-labelledby="shift-draft-title" className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-4">
      <h3 id="shift-draft-title" className="font-semibold text-content">{t('handoffDraft.title')}</h3>
      {draft === null && (
        <button type="button" onClick={() => void load()} aria-disabled={loading || undefined}
          className="mc-press min-h-[44px] w-full rounded-lg border border-border-interactive px-3 font-semibold text-content hover:bg-surface-sunken">
          {loading ? t('ems.loading') : t('handoffDraft.load')}
        </button>
      )}
      {error && <p role="alert" className="rounded-lg bg-critical-subtle p-3 text-sm text-critical-subtle-fg">{error}</p>}
      {draft !== null && open.length === 0 && <p className="text-sm text-content-muted">{t('handoffDraft.none')}</p>}
      {open.length > 0 && (
        <form onSubmit={(e) => { e.preventDefault(); onAdd(open.filter((p) => chosen.has(p.patient_id))); setChosen(new Set()); }} className="space-y-3">
          <button type="button" onClick={() => setChosen(new Set(open.map((p) => p.patient_id)))}
            className="min-h-[36px] text-sm font-semibold text-brand underline">
            {t('handoffDraft.selectAll', { n: open.length })}
          </button>
          <ul className="space-y-2">
            {open.map((p) => (
              <li key={p.patient_id}>
                <label className="flex min-h-[48px] cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-selected">
                  <input type="checkbox" checked={chosen.has(p.patient_id)} onChange={() => toggle(p.patient_id)} className="mt-1" />
                  <span className="min-w-0">
                    <span className="block font-semibold text-content">{p.full_name ?? t('today.unreadablePatient')}</span>
                    <span className="block text-sm text-content-muted">
                      {[p.bed_label ? t('myWard.bed', { bed: p.bed_label }) : null,
                        p.date_of_birth ? `${t('patientSelect.born')} ${formatDateOnly(p.date_of_birth)}` : null,
                        t('handoffDraft.recordsCount', { n: p.recorded.reduce((n, r) => n + r.count, 0) })]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button type="submit"
            aria-disabled={chosen.size === 0 || undefined}
            className="mc-press min-h-[44px] w-full rounded-lg bg-brand px-3 font-semibold text-brand-fg hover:bg-brand-hover">
            {t('handoffDraft.add', { n: chosen.size })}
          </button>
        </form>
      )}
    </section>
  );
}
