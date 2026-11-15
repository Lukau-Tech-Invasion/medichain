/**
 * One quick entry on the run's timeline: vitals, a treatment, a medicine or a
 * note. Numbers open the numeric keypad; common treatments, medicines and
 * routes are one tap; only what was entered is sent (rule 9) and every entry
 * is stamped with the time it was saved — or the time the crew says.
 */
import { useState } from 'react';
import { ChoiceChips, Sheet, useTranslation } from '@medichain/shared';
import type { AddEmsRunEventBody, EmsRunVitals } from '@medichain/shared';

export type EntryKind = 'vitals' | 'treatment' | 'medication' | 'note';

const VITALS: Array<{ key: keyof EmsRunVitals; unit: string; decimal?: boolean }> = [
  { key: 'systolic_bp', unit: 'mmHg' },
  { key: 'diastolic_bp', unit: 'mmHg' },
  { key: 'heart_rate', unit: '/min' },
  { key: 'respiratory_rate', unit: '/min' },
  { key: 'spo2', unit: '%' },
  { key: 'gcs', unit: '3–15' },
  { key: 'temperature_c', unit: '°C', decimal: true },
  { key: 'glucose_mmol', unit: 'mmol/L', decimal: true },
];

const TREATMENTS = [
  'Oxygen', 'IV access', 'Splint', 'Cervical collar', 'Spinal immobilisation', 'Bleeding control',
  'Wound dressing', 'Airway adjunct', 'CPR', 'Defibrillation',
] as const;

const MEDICINES = [
  'Sodium chloride 0.9%', 'Paracetamol', 'Aspirin', 'Adrenaline', 'Glucose 10%', 'Morphine', 'Salbutamol', 'Ondansetron',
] as const;

const ROUTES = ['IV', 'IM', 'Oral', 'Nebulised', 'Sublingual', 'IO'] as const;

export function EntrySheet({ kind, onClose, onSave }: {
  kind: EntryKind;
  onClose: () => void;
  /** Resolves true when the entry is on the timeline. */
  onSave: (body: AddEmsRunEventBody) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [vitals, setVitals] = useState<Partial<Record<keyof EmsRunVitals, string>>>({});
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState<(typeof ROUTES)[number] | undefined>();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  const body = (): AddEmsRunEventBody | null => {
    if (kind === 'vitals') {
      const payload: Record<string, number> = {};
      for (const { key } of VITALS) {
        const raw = vitals[key]?.trim();
        const n = raw ? Number(raw) : NaN;
        if (raw && Number.isFinite(n)) payload[key] = n;
      }
      return Object.keys(payload).length ? { kind, payload } : null;
    }
    if (kind === 'treatment') return name.trim() ? { kind, payload: { name: name.trim() } } : null;
    if (kind === 'medication') {
      if (!name.trim()) return null;
      return { kind, payload: { name: name.trim(), ...(dose.trim() ? { dose: dose.trim() } : {}), ...(route ? { route } : {}) } };
    }
    return text.trim() ? { kind, payload: { text: text.trim() } } : null;
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const b = body();
    if (!b) {
      setProblem(t(`ems.entryEmpty.${kind}`));
      return;
    }
    setSaving(true);
    const ok = await onSave(b);
    setSaving(false);
    if (ok) onClose();
  };

  const field = 'min-h-[48px] w-full rounded-lg border border-border-interactive bg-surface px-3 text-base text-content';
  return (
    <Sheet
      title={t(`ems.entry.${kind}`)}
      onClose={onClose}
      actions={
        <button type="submit" form="ems-entry" aria-disabled={saving || undefined}
          className="mc-press min-h-[52px] w-full rounded-xl bg-brand px-4 text-lg font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {saving ? t('common.saving') : t('ems.addToTimeline')}
        </button>
      }
    >
      <form id="ems-entry" onSubmit={save} className="space-y-4" noValidate>
        {problem && <p role="alert" className="rounded-lg bg-caution-subtle p-3 text-sm text-caution-subtle-fg">{problem}</p>}
        {kind === 'vitals' && (
          <div className="grid grid-cols-2 gap-3">
            {VITALS.map(({ key, unit, decimal }) => (
              <label key={key} className="block text-sm font-medium text-content-secondary">
                {t(`ems.vital.${key}`)} <span className="text-content-muted">({unit})</span>
                <input inputMode={decimal ? 'decimal' : 'numeric'} value={vitals[key] ?? ''} className={`${field} mt-1 tabular-nums`}
                  onChange={(e) => { setProblem(''); setVitals((v) => ({ ...v, [key]: e.target.value })); }} />
              </label>
            ))}
          </div>
        )}
        {kind === 'treatment' && (
          <>
            <ChoiceChips label={t('ems.commonTreatments')} value={TREATMENTS.find((x) => x === name)}
              options={TREATMENTS.map((x) => ({ value: x, label: x }))} onChange={(v) => { setProblem(''); setName(v ?? ''); }} />
            <label className="block text-sm font-medium text-content-secondary">{t('ems.orDescribe')}
              <input value={name} onChange={(e) => { setProblem(''); setName(e.target.value); }} className={`${field} mt-1`} />
            </label>
          </>
        )}
        {kind === 'medication' && (
          <>
            <ChoiceChips label={t('ems.commonMedicines')} value={MEDICINES.find((x) => x === name)}
              options={MEDICINES.map((x) => ({ value: x, label: x }))} onChange={(v) => { setProblem(''); setName(v ?? ''); }} />
            <label className="block text-sm font-medium text-content-secondary">{t('ems.medicineName')}
              <input value={name} onChange={(e) => { setProblem(''); setName(e.target.value); }} className={`${field} mt-1`} />
            </label>
            <label className="block text-sm font-medium text-content-secondary">{t('ems.dose')}
              <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="500 mL" className={`${field} mt-1`} />
            </label>
            <ChoiceChips label={t('ems.route')} value={route} options={ROUTES.map((x) => ({ value: x, label: x }))} onChange={setRoute} />
          </>
        )}
        {kind === 'note' && (
          <label className="block text-sm font-medium text-content-secondary">{t('ems.noteLabel')}
            <textarea value={text} rows={4} onChange={(e) => { setProblem(''); setText(e.target.value); }}
              className="mt-1 w-full rounded-lg border border-border-interactive bg-surface p-3 text-base text-content" />
          </label>
        )}
      </form>
    </Sheet>
  );
}
