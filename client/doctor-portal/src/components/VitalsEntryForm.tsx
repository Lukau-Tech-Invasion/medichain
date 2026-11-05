/**
 * Recording a set of vital signs (mockup c3): the readings most visits take in
 * one row, the rarer ones folded under "More details", and the half-filled
 * form kept for this tab if the clinician is called away.
 *
 * Nothing is pre-filled. A field nobody entered is sent as null (rule 9), and
 * nothing here flags or scores a value (rule 8): the server answers with its
 * critical alerts, and the page around this shows the server's bands.
 */
import { useId, useState } from 'react';
import { CheckCircle, ChevronDown, Loader2, Save } from 'lucide-react';
import {
  addVitalSigns,
  bloodPressureSchema,
  getApiErrorMessage,
  submitOnce,
  useFormDraft,
  useSubmission,
  useTranslation,
  useUnsavedChanges,
} from '@medichain/shared';

export interface VitalsDraft {
  heart_rate: string;
  respiratory_rate: string;
  bp_systolic: string;
  bp_diastolic: string;
  temperature: string;
  oxygen_saturation: string;
  pain_scale: string;
  gcs_total: string;
  blood_glucose: string;
  weight_kg: string;
  notes: string;
}

const EMPTY: VitalsDraft = {
  heart_rate: '', respiratory_rate: '', bp_systolic: '', bp_diastolic: '', temperature: '',
  oxygen_saturation: '', pain_scale: '', gcs_total: '', blood_glucose: '', weight_kg: '', notes: '',
};

/** Each field as the API names it: a number when entered, null when not. */
export function vitalsPayload(patientId: string, v: VitalsDraft) {
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  return {
    patient_id: patientId,
    heart_rate: num(v.heart_rate),
    respiratory_rate: num(v.respiratory_rate),
    systolic_bp: num(v.bp_systolic),
    diastolic_bp: num(v.bp_diastolic),
    temperature_celsius: num(v.temperature),
    oxygen_saturation: num(v.oxygen_saturation),
    pain_scale: num(v.pain_scale),
    gcs_total: num(v.gcs_total),
    blood_glucose: num(v.blood_glucose),
    weight_kg: num(v.weight_kg),
    notes: v.notes.trim() || null,
  };
}

const inputClass = 'w-full min-h-[48px] rounded-lg border border-border-interactive bg-surface px-3 text-right text-lg text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

function Field({ id, label, unit, value, onChange, step }: {
  id: string; label: string; unit?: string; value: string; onChange: (v: string) => void; step?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-content-secondary">{label}</label>
      <div className="flex items-center gap-2">
        <input id={id} type="number" inputMode="decimal" step={step} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
        {unit && <span className="shrink-0 text-sm text-content-muted">{unit}</span>}
      </div>
    </div>
  );
}

export function VitalsEntryForm({ patientId, onSaved, onCancel }: {
  patientId: string;
  /** Called after a save, with whether it waits on this device for a signal. */
  onSaved: (queued: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const submission = useSubmission('vitals');
  const id = useId();
  const [v, setV] = useState<VitalsDraft>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = Object.values(v).some((s) => s.trim() !== '');
  // Kept in memory for this tab only (no PHI in browser storage), and named to
  // "Close patient" and to the leave-page warning while it holds anything.
  useFormDraft('vitals', patientId, v, dirty, setV);
  useUnsavedChanges(dirty, t('docVitalSigns.formLabel'));
  const set = (key: keyof VitalsDraft) => (value: string) => setV((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!Object.entries(v).some(([field, value]) => field !== 'notes' && value.trim() !== '')) {
      setError(t('docVitalSigns.errorMeasurementRequired'));
      return;
    }
    // A pair entered the wrong way round reads as profound hypotension; the
    // server refuses it too, this says so before the round trip.
    if (v.bp_systolic && v.bp_diastolic) {
      const bp = bloodPressureSchema.safeParse({ systolic: Number(v.bp_systolic), diastolic: Number(v.bp_diastolic) });
      if (!bp.success) {
        setError(bp.error.issues[0]?.message ?? t('docVitalSigns.errorRecordVitalsGeneric'));
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = vitalsPayload(patientId, v);
      // One key per submission: a double tap, or a retry after a timeout that
      // had in fact saved, is answered "already saved" instead of writing twice.
      const outcome = await submitOnce(submission, payload, () => addVitalSigns(payload));
      if (outcome === 'busy') return;
      setV(EMPTY);
      onSaved(outcome === 'queued');
    } catch (refused) {
      setError(getApiErrorMessage(refused, t('docVitalSigns.errorRecordVitals')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-6 space-y-5 rounded-xl border border-border bg-surface p-6 shadow-sm" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-content">{t('docVitalSigns.recordNewVitalsTitle')}</h2>
        {dirty && (
          <span role="status" className="flex items-center gap-1.5 text-sm text-content-muted">
            <Save className="h-4 w-4" aria-hidden="true" />{t('docVitalSigns.draftKept')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-content-secondary">{t('docVitalSigns.bloodPressureShort')}</legend>
          <div className="flex items-center gap-2">
            <label htmlFor={`${id}-sys`} className="sr-only">{t('docVitalSigns.bpSystolicLabel')}</label>
            <input id={`${id}-sys`} type="number" inputMode="numeric" value={v.bp_systolic} onChange={(e) => set('bp_systolic')(e.target.value)} className={inputClass} />
            <span aria-hidden="true" className="text-content-muted">/</span>
            <label htmlFor={`${id}-dia`} className="sr-only">{t('docVitalSigns.bpDiastolicLabel')}</label>
            <input id={`${id}-dia`} type="number" inputMode="numeric" value={v.bp_diastolic} onChange={(e) => set('bp_diastolic')(e.target.value)} className={inputClass} />
            <span className="shrink-0 text-sm text-content-muted">mmHg</span>
          </div>
        </fieldset>
        <Field id={`${id}-hr`} label={t('docVitalSigns.heartRateLabel')} unit="/min" value={v.heart_rate} onChange={set('heart_rate')} />
        <Field id={`${id}-rr`} label={t('docVitalSigns.respRateLabel')} unit="/min" value={v.respiratory_rate} onChange={set('respiratory_rate')} />
        <Field id={`${id}-temp`} label={t('docVitalSigns.temperatureLabel')} unit="°C" step="0.1" value={v.temperature} onChange={set('temperature')} />
        <Field id={`${id}-spo2`} label={t('docVitalSigns.spo2Label')} unit="%" value={v.oxygen_saturation} onChange={set('oxygen_saturation')} />
      </div>

      <details className="group rounded-xl border border-border px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-content">
          {t('docVitalSigns.moreDetails')}
          <ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field id={`${id}-pain`} label={t('docVitalSigns.painScaleLabel')} unit="/10" value={v.pain_scale} onChange={set('pain_scale')} />
          <Field id={`${id}-glucose`} label={t('docVitalSigns.bloodGlucoseLabel')} step="0.1" value={v.blood_glucose} onChange={set('blood_glucose')} />
          <Field id={`${id}-weight`} label={t('docVitalSigns.weightLabel')} unit="kg" step="0.1" value={v.weight_kg} onChange={set('weight_kg')} />
          <Field id={`${id}-gcs`} label={t('docVitalSigns.gcsScoreLabel')} value={v.gcs_total} onChange={set('gcs_total')} />
        </div>
        <div className="mt-4">
          <label htmlFor={`${id}-notes`} className="mb-1 block text-sm font-medium text-content-secondary">{t('docVitalSigns.notesLabel')}</label>
          <textarea id={`${id}-notes`} value={v.notes} onChange={(e) => set('notes')(e.target.value)} rows={2}
            className="w-full rounded-lg border border-border-interactive bg-surface px-3 py-2 text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
        </div>
      </details>

      {error && <p role="alert" className="rounded-lg border border-critical bg-critical-subtle p-3 text-sm text-critical-subtle-fg">{error}</p>}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel}
          className="min-h-[48px] rounded-lg border border-border-interactive px-6 font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {t('docVitalSigns.cancelButton')}
        </button>
        <button type="submit" aria-disabled={submitting || undefined}
          className="flex min-h-[48px] items-center gap-2 rounded-lg bg-brand px-6 font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-disabled:cursor-wait">
          {submitting ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <CheckCircle size={18} aria-hidden="true" />}
          {t('docVitalSigns.saveVitalsButton')}
        </button>
      </div>
    </form>
  );
}
