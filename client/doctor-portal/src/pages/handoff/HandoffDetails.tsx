/**
 * The rest of a patient's handoff, folded under the SBAR lines: everything the
 * handoff form has always carried (bed, diagnosis, priority, code status,
 * lines and drains, diet, activity, pending work, medications, safety risks,
 * family updates, notes). Kept whole so no field the record stores goes
 * missing from the new layout; folded so the drafted lines come first.
 */
// ux-allow(no-form): rendered inside the shift handoff page form, where a nested <form> is invalid.
import { ChoiceChips, useTranslation } from '@medichain/shared';
import type { PatientHandoff, Priority } from './handoffModel';

const CODE_STATUS_KEYS: Record<string, string> = {
  'Not recorded': 'not-recorded',
  'Full Code': 'full-code',
  'DNR': 'dnr',
  'DNR/DNI': 'dnr-dni',
  'Comfort Measures Only': 'comfort-measures-only',
  'Limited Code': 'limited-code',
};

const SAFETY_RISK_KEYS: Record<string, string> = {
  'Fall Risk': 'fall-risk',
  'Aspiration Risk': 'aspiration-risk',
  'Elopement Risk': 'elopement-risk',
  'Pressure Injury Risk': 'pressure-injury-risk',
  'Suicide Precautions': 'suicide-precautions',
  'Seizure Precautions': 'seizure-precautions',
  'Bleeding Precautions': 'bleeding-precautions',
  'DVT Risk': 'dvt-risk',
  'MRSA': 'mrsa',
  'C. Diff': 'c-diff',
  'Contact Isolation': 'contact-isolation',
  'Droplet Isolation': 'droplet-isolation',
};

type TextField = 'room' | 'diagnosis' | 'ivAccess' | 'diet' | 'activity' | 'pendingLabs' | 'pendingTests' | 'pendingOrders' | 'familyUpdates';

const TEXT_FIELDS: Array<{ field: TextField; id: string }> = [
  { field: 'room', id: 'room' },
  { field: 'diagnosis', id: 'diagnosis' },
  { field: 'ivAccess', id: 'iv-access' },
  { field: 'diet', id: 'diet' },
  { field: 'activity', id: 'activity' },
  { field: 'pendingLabs', id: 'pending-labs' },
  { field: 'pendingTests', id: 'pending-tests' },
  { field: 'pendingOrders', id: 'pending-orders' },
  { field: 'familyUpdates', id: 'family-updates' },
];

const input = 'w-full rounded-lg border border-border-interactive bg-surface p-2 text-sm text-content';

export function HandoffDetails({ patient, onChange }: { patient: PatientHandoff; onChange: (updates: Partial<PatientHandoff>) => void }) {
  const { t } = useTranslation();
  const pid = patient.patientId;
  const toggleRisk = (risk: string) => onChange({
    safetyRisks: patient.safetyRisks.includes(risk) ? patient.safetyRisks.filter((r) => r !== risk) : [...patient.safetyRisks, risk],
  });

  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-content-secondary">{t('docShiftHandoff.moreDetails')}</summary>
      <div className="space-y-3 border-t border-border p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TEXT_FIELDS.map(({ field, id }) => (
            <div key={field}>
              <label htmlFor={`handoff-${id}-${pid}`} className="block text-xs font-medium text-content-muted">{t(`docShiftHandoff.${field}Label`)}</label>
              <input id={`handoff-${id}-${pid}`} type="text" value={patient[field]} className={input}
                onChange={(e) => onChange({ [field]: e.target.value })} />
            </div>
          ))}
          <div>
            <label htmlFor={`handoff-code-status-${pid}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.codeStatusLabel')}</label>
            <select id={`handoff-code-status-${pid}`} value={patient.codeStatus} className={input}
              onChange={(e) => onChange({ codeStatus: e.target.value })}>
              {Object.keys(CODE_STATUS_KEYS).map((s) => (
                <option key={s} value={s}>{t(`docShiftHandoff.codeStatus_${CODE_STATUS_KEYS[s]}`)}</option>
              ))}
            </select>
          </div>
        </div>
        <ChoiceChips<Priority>
          id={`handoff-priority-${pid}`}
          label={t('docShiftHandoff.priorityLabel')}
          value={patient.priority}
          onChange={(priority) => priority && onChange({ priority })}
          options={[
            { value: 'routine', label: t('docShiftHandoff.priority_routine') },
            { value: 'urgent', label: t('docShiftHandoff.priority_urgent') },
            { value: 'critical', label: t('docShiftHandoff.priority_critical') },
          ]}
        />
        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <legend className="mb-1 text-xs font-semibold text-content-secondary">{t('docShiftHandoff.medicationsTitle')}</legend>
          {(['scheduled', 'prn', 'drips'] as const).map((field) => (
            <div key={field}>
              <label htmlFor={`handoff-meds-${field}-${pid}`} className="block text-xs text-content-muted">{t(`docShiftHandoff.${field}Label`)}</label>
              <input id={`handoff-meds-${field}-${pid}`} type="text" value={patient.medications[field]} className={input}
                onChange={(e) => onChange({ medications: { ...patient.medications, [field]: e.target.value } })} />
            </div>
          ))}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-content-secondary">{t('docShiftHandoff.safetyRisksTitle')}</legend>
          <div className="flex flex-wrap gap-2">
            {Object.keys(SAFETY_RISK_KEYS).map((risk) => (
              <button key={risk} type="button" aria-pressed={patient.safetyRisks.includes(risk)} onClick={() => toggleRisk(risk)}
                className="min-h-[32px] rounded-full border border-border-interactive px-3 text-xs text-content aria-pressed:border-brand aria-pressed:bg-selected aria-pressed:font-semibold">
                {t(`docShiftHandoff.risk_${SAFETY_RISK_KEYS[risk]}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor={`handoff-additional-notes-${pid}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.additionalNotesLabel')}</label>
          <textarea id={`handoff-additional-notes-${pid}`} rows={2} value={patient.additionalNotes} className={input}
            onChange={(e) => onChange({ additionalNotes: e.target.value })} />
        </div>
      </div>
    </details>
  );
}
