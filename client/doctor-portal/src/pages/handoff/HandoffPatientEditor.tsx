/**
 * One patient's handoff (mockup c2): the drafted SBAR lines, each beside the
 * record it came from, editable, removable, and added to; the outgoing
 * nurse's Stable / Watch / Unstable call; and the rest folded underneath.
 */
// ux-allow(no-form): rendered inside the shift handoff page form, where a nested <form> is invalid.
import { Plus, X } from 'lucide-react';
import { ChoiceChips, formatTimestamp, useTranslation } from '@medichain/shared';
import { HandoffDetails } from './HandoffDetails';
import { SECTIONS, lineKey, type HandoffLine, type PatientHandoff, type Section, type Stability } from './handoffModel';

function SourceChip({ line }: { line: HandoffLine }) {
  const { t } = useTranslation();
  if (!line.source) return null;
  const time = line.at ? formatTimestamp(line.at, { timeStyle: 'short' }) : '';
  return (
    <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-content-secondary">
      {[t(`docShiftHandoff.source_${line.source}`), time].filter(Boolean).join(' ')}
    </span>
  );
}

function SectionLines({ patient, section, onLines }: {
  patient: PatientHandoff;
  section: Section;
  onLines: (lines: HandoffLine[]) => void;
}) {
  const { t } = useTranslation();
  const lines = patient.lines[section];
  const label = t(`docShiftHandoff.section_${section}`);
  const setText = (key: string, text: string) => onLines(lines.map((l) => (l.key === key ? { ...l, text } : l)));
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold uppercase tracking-wide text-content-secondary">{label}</legend>
      {lines.map((line, i) => (
        <div key={line.key} className="flex items-center gap-2">
          <input
            aria-label={t('docShiftHandoff.lineLabel', { section: label, n: i + 1 })}
            value={line.text}
            onChange={(e) => setText(line.key, e.target.value)}
            className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-border-interactive bg-surface px-2 text-sm text-content"
          />
          <SourceChip line={line} />
          <button type="button" onClick={() => onLines(lines.filter((l) => l.key !== line.key))}
            aria-label={t('docShiftHandoff.removeLine', { section: label, n: i + 1 })}
            className="rounded p-1 text-content-muted hover:bg-surface-sunken hover:text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onLines([...lines, { key: lineKey(), text: '' }])}
        className="inline-flex min-h-[36px] items-center gap-1 text-sm font-semibold text-brand hover:underline">
        <Plus className="h-4 w-4" aria-hidden="true" />
        {section === 'recommendation' ? t('docShiftHandoff.addTodo') : t('docShiftHandoff.addLine', { section: label })}
      </button>
    </fieldset>
  );
}

export function HandoffPatientEditor({ patient, onChange }: {
  patient: PatientHandoff;
  onChange: (updates: Partial<PatientHandoff>) => void;
}) {
  const { t } = useTranslation();
  const drafted = SECTIONS.some((s) => patient.lines[s].some((l) => l.source));
  return (
    <section aria-labelledby={`handoff-patient-${patient.patientId}`} className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`handoff-patient-${patient.patientId}`} className="text-lg font-bold text-content">
          {patient.patientName}{patient.room ? ` · ${t('myWard.bed', { bed: patient.room })}` : ''}
        </h2>
        <p className="text-sm text-content-muted">
          {drafted ? (patient.entries === 1 ? t('docShiftHandoff.draftedFromOne') : t('docShiftHandoff.draftedFrom', { n: patient.entries })) : t('docShiftHandoff.notDrafted')}
        </p>
      </header>
      <ChoiceChips<Stability>
        id={`handoff-stability-${patient.patientId}`}
        label={t('docShiftHandoff.stabilityLabel')}
        value={patient.stability}
        onChange={(stability) => onChange({ stability: stability ?? undefined })}
        options={[
          { value: 'stable', label: t('docShiftHandoff.stability_stable') },
          { value: 'watch', label: t('docShiftHandoff.stability_watch') },
          { value: 'unstable', label: t('docShiftHandoff.stability_unstable') },
        ]}
      />
      {SECTIONS.map((section) => (
        <SectionLines key={section} patient={patient} section={section}
          onLines={(lines) => onChange({ lines: { ...patient.lines, [section]: lines } })} />
      ))}
      <HandoffDetails patient={patient} onChange={onChange} />
    </section>
  );
}
