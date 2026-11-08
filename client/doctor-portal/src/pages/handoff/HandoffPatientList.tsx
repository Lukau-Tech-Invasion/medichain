/**
 * The patients on this handoff (mockup c2): everyone the nurse cared for this
 * shift, from the shift's own records, each with whether it is handed over,
 * how much was recorded, and where its review stands.
 */
// ux-allow(no-form): rendered inside the shift handoff page form, where a nested <form> is invalid.
import { Plus } from 'lucide-react';
import { useTranslation } from '@medichain/shared';
import { listStatus, type ListStatus, type PatientHandoff } from './handoffModel';

const STATUS_STYLE: Record<ListStatus, string> = {
  toReview: 'bg-surface-sunken text-content-secondary',
  reviewed: 'bg-ok-subtle text-ok-subtle-fg',
  stable: 'bg-ok-subtle text-ok-subtle-fg',
  watch: 'bg-caution-subtle text-caution-subtle-fg',
  unstable: 'bg-critical-subtle text-critical-subtle-fg',
};

export function HandoffPatientList(props: {
  patients: PatientHandoff[];
  selected: Set<string>;
  openId: string | null;
  onToggle: (patientId: string) => void;
  onSelectAll: () => void;
  onOpen: (patientId: string) => void;
  onAddPatient: () => void;
}) {
  const { t } = useTranslation();
  const { patients, selected } = props;
  return (
    <section aria-labelledby="handoff-patients-title" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="handoff-patients-title" className="font-semibold text-content">
          {t('docShiftHandoff.patientsCaredFor')}
          <span className="block text-xs font-normal text-content-muted">{t('docShiftHandoff.fromShiftRecords')}</span>
        </h2>
        {patients.length > 0 && (
          <button type="button" onClick={props.onSelectAll} className="min-h-[36px] text-sm font-semibold text-brand hover:underline">
            {t('docShiftHandoff.selectAll', { n: selected.size, total: patients.length })}
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {patients.map((p) => {
          const status = listStatus(p);
          const open = p.patientId === props.openId;
          return (
            <li key={p.patientId}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${open ? 'border-brand bg-selected' : 'border-border bg-surface'}`}>
              <input type="checkbox" checked={selected.has(p.patientId)} onChange={() => props.onToggle(p.patientId)}
                aria-label={t('docShiftHandoff.handOverPatient', { name: p.patientName })} className="h-4 w-4" />
              <button type="button" onClick={() => props.onOpen(p.patientId)} aria-current={open || undefined}
                className="min-h-[44px] min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <span className="block truncate font-semibold text-content">{p.patientName}</span>
                <span className="block text-xs text-content-muted">
                  {[p.room ? t('myWard.bed', { bed: p.room }) : null, (p.entries === 1 ? t('docShiftHandoff.entriesOne') : t('docShiftHandoff.entries', { n: p.entries }))].filter(Boolean).join(' · ')}
                </span>
              </button>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
                {t(`docShiftHandoff.listStatus_${status}`)}
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={props.onAddPatient}
        className="inline-flex min-h-[40px] items-center gap-1 text-sm font-semibold text-brand hover:underline">
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('docShiftHandoff.addAnotherPatient')}
      </button>
    </section>
  );
}
