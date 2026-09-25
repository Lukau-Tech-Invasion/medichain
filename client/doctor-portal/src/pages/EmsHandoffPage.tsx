import { useCallback, useEffect, useState } from 'react';
import {
  createEmsHandoff,
  formatTimestamp,
  getApiErrorMessage,
  listRecentEmsHandoffs,
  useTranslation,
} from '@medichain/shared';
import type { CreateEmsHandoffBody, EmsHandoff, EmsVitals } from '@medichain/shared';
import { Loader2, Plus, RefreshCw, Trash2, Truck } from 'lucide-react';
import PatientSelect from '../components/PatientSelect';

/**
 * Ambulance handover: the receiving clinician records what the crew reports.
 *
 * # Why this page exists
 *
 * `POST /api/emergency/ems-handoff` existed with no screen, took a 30-field
 * domain type on the wire (so nothing short of a complete ePCR could have
 * saved), and took the record id from the body. There was no list and no way
 * for the patient to read what the crew did. The form follows the order a
 * handover is spoken in -- who and when, what happened, what was found, what
 * was done -- and sends only what was entered (rule 9): a blank field is
 * absent, not "normal".
 */

/** The text inputs for one set of observations, as typed. */
type VitalsDraft = Record<'systolic_bp' | 'diastolic_bp' | 'heart_rate' | 'respiratory_rate' | 'spo2' | 'temperature_c' | 'glucose_mmol', string>;

const EMPTY_VITALS: VitalsDraft = {
  systolic_bp: '', diastolic_bp: '', heart_rate: '', respiratory_rate: '', spo2: '', temperature_c: '', glucose_mmol: '',
};

const SAMPLE_FIELDS = ['signs_symptoms', 'allergies', 'medications', 'past_history', 'last_intake', 'events'] as const;
type SampleDraft = Record<(typeof SAMPLE_FIELDS)[number], string>;
const EMPTY_SAMPLE: SampleDraft = {
  signs_symptoms: '', allergies: '', medications: '', past_history: '', last_intake: '', events: '',
};

const ALERTS = ['trauma_alert', 'stroke_alert', 'stemi_alert', 'sepsis_alert'] as const;

/** A number the clinician typed, or nothing. */
function numberOrAbsent(value: string): number | undefined {
  const parsed = Number(value);
  return value.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
}

/** A datetime-local value as an RFC 3339 instant, or nothing. */
function instantOrAbsent(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** The observations as the API takes them: only the readings that were taken. */
function vitalsBody(draft: VitalsDraft): EmsVitals {
  const out: EmsVitals = {};
  for (const [key, value] of Object.entries(draft) as [keyof VitalsDraft, string][]) {
    const n = numberOrAbsent(value);
    if (n !== undefined) (out as Record<string, number>)[key] = n;
  }
  return out;
}

function EmsHandoffPage() {
  const { t } = useTranslation();

  const [handoffs, setHandoffs] = useState<EmsHandoff[]>([]);
  const [loaded, setLoaded] = useState(false);
  // "No crew handed over today" and "the arrivals could not be read" differ.
  const [listUnknown, setListUnknown] = useState(false);

  const [patientId, setPatientId] = useState('');
  const [agency, setAgency] = useState('');
  const [unit, setUnit] = useState('');
  const [crew, setCrew] = useState('');
  const [incidentType, setIncidentType] = useState('');
  const [sceneAddress, setSceneAddress] = useState('');
  const [dispatchTime, setDispatchTime] = useState('');
  const [onSceneTime, setOnSceneTime] = useState('');
  const [departedTime, setDepartedTime] = useState('');
  const [complaint, setComplaint] = useState('');
  const [mechanism, setMechanism] = useState('');
  const [gcs, setGcs] = useState('');
  const [vitals, setVitals] = useState<VitalsDraft[]>([]);
  const [interventions, setInterventions] = useState('');
  const [sample, setSample] = useState<SampleDraft>(EMPTY_SAMPLE);
  const [alerts, setAlerts] = useState<Record<(typeof ALERTS)[number], boolean>>({
    trauma_alert: false, stroke_alert: false, stemi_alert: false, sepsis_alert: false,
  });
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const body = await listRecentEmsHandoffs();
      setHandoffs(body.handoffs ?? []);
      setListUnknown(false);
    } catch {
      setListUnknown(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setPatientId(''); setAgency(''); setUnit(''); setCrew(''); setIncidentType(''); setSceneAddress('');
    setDispatchTime(''); setOnSceneTime(''); setDepartedTime(''); setComplaint(''); setMechanism('');
    setGcs(''); setVitals([]); setInterventions(''); setSample(EMPTY_SAMPLE); setNotes('');
    setAlerts({ trauma_alert: false, stroke_alert: false, stemi_alert: false, sepsis_alert: false });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!agency.trim() || !complaint.trim()) {
      setError(t('docEms.required'));
      return;
    }
    const readings = vitals.map(vitalsBody);
    if (readings.some((reading) => Object.keys(reading).length === 0)) {
      setError(t('docEms.emptyVitals'));
      return;
    }
    const sampleBody = Object.fromEntries(
      SAMPLE_FIELDS.map((field) => [field, sample[field].trim()]).filter(([, value]) => value)
    );
    const list = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean);
    const body: CreateEmsHandoffBody = {
      ems_agency: agency.trim(),
      chief_complaint: complaint.trim(),
      ...(patientId ? { patient_id: patientId } : {}),
      ...(unit.trim() ? { unit_number: unit.trim() } : {}),
      ...(crew.trim() ? { crew: list(crew.replace(/,/g, '\n')) } : {}),
      ...(incidentType.trim() ? { incident_type: incidentType.trim() } : {}),
      ...(sceneAddress.trim() ? { scene_address: sceneAddress.trim() } : {}),
      ...(instantOrAbsent(dispatchTime) ? { dispatch_time: instantOrAbsent(dispatchTime) } : {}),
      ...(instantOrAbsent(onSceneTime) ? { on_scene_time: instantOrAbsent(onSceneTime) } : {}),
      ...(instantOrAbsent(departedTime) ? { departed_scene_time: instantOrAbsent(departedTime) } : {}),
      ...(mechanism.trim() ? { mechanism_of_injury: mechanism.trim() } : {}),
      ...(numberOrAbsent(gcs) !== undefined ? { gcs_on_scene: numberOrAbsent(gcs) } : {}),
      ...(readings.length ? { vital_signs: readings } : {}),
      ...(list(interventions).length ? { interventions: list(interventions) } : {}),
      ...(Object.keys(sampleBody).length ? { sample: sampleBody } : {}),
      ...Object.fromEntries(ALERTS.filter((a) => alerts[a]).map((a) => [a, true])),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    setSaving(true);
    try {
      const result = await createEmsHandoff(body);
      setNotice(t('docEms.recorded', { id: result.id }));
      reset();
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, t('docEms.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full px-3 py-2 border rounded-lg bg-surface text-content';
  const label = 'block text-sm font-medium text-content-secondary mb-1';

  return (
    <div className="p-6 space-y-6 bg-surface-sunken min-h-screen">
      <div className="flex items-center gap-3">
        <Truck className="w-7 h-7 text-critical" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-content">{t('docEms.title')}</h1>
          <p className="text-sm text-content-muted">{t('docEms.subtitle')}</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-critical-subtle border border-critical rounded-lg p-3">
          <p className="text-sm text-critical-subtle-fg">{error}</p>
        </div>
      )}
      {notice && (
        <div role="status" className="bg-ok-subtle border border-ok rounded-lg p-3">
          <p className="text-sm text-ok-subtle-fg">{notice}</p>
        </div>
      )}

      <form onSubmit={submit} className="bg-surface rounded-xl shadow p-6 space-y-6">
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <PatientSelect id="ems-patient" label={t('docEms.patientLabel')} value={patientId} onChange={setPatientId} />
            <p className="text-xs text-content-muted mt-1">{t('docEms.patientHint')}</p>
          </div>
          <div>
            <label htmlFor="ems-agency" className={label}>{t('docEms.agencyLabel')}</label>
            <input id="ems-agency" value={agency} onChange={(e) => setAgency(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="ems-unit" className={label}>{t('docEms.unitLabel')}</label>
            <input id="ems-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="ems-crew" className={label}>{t('docEms.crewLabel')}</label>
            <input id="ems-crew" value={crew} onChange={(e) => setCrew(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="ems-incident" className={label}>{t('docEms.incidentLabel')}</label>
            <input id="ems-incident" value={incidentType} onChange={(e) => setIncidentType(e.target.value)} className={field} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="ems-scene" className={label}>{t('docEms.sceneLabel')}</label>
            <input id="ems-scene" value={sceneAddress} onChange={(e) => setSceneAddress(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="ems-dispatch" className={label}>{t('docEms.dispatchLabel')}</label>
            <input id="ems-dispatch" type="datetime-local" value={dispatchTime} onChange={(e) => setDispatchTime(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="ems-onscene" className={label}>{t('docEms.onSceneLabel')}</label>
            <input id="ems-onscene" type="datetime-local" value={onSceneTime} onChange={(e) => setOnSceneTime(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="ems-departed" className={label}>{t('docEms.departedLabel')}</label>
            <input id="ems-departed" type="datetime-local" value={departedTime} onChange={(e) => setDepartedTime(e.target.value)} className={field} />
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label htmlFor="ems-complaint" className={label}>{t('docEms.complaintLabel')}</label>
            <input id="ems-complaint" value={complaint} onChange={(e) => setComplaint(e.target.value)} className={field} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="ems-mechanism" className={label}>{t('docEms.mechanismLabel')}</label>
            <textarea id="ems-mechanism" rows={2} value={mechanism} onChange={(e) => setMechanism(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="ems-gcs" className={label}>{t('docEms.gcsLabel')}</label>
            <input id="ems-gcs" type="number" min={3} max={15} value={gcs} onChange={(e) => setGcs(e.target.value)} className={field} />
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-content">{t('docEms.vitalsHeading')}</h2>
            <button
              type="button"
              onClick={() => setVitals((v) => [...v, EMPTY_VITALS])}
              className="flex items-center gap-1 px-3 py-1 text-sm rounded-lg border border-border-interactive text-content"
            >
              <Plus size={14} aria-hidden="true" /> {t('docEms.addVitals')}
            </button>
          </div>
          {vitals.length === 0 && <p className="text-sm text-content-muted">{t('docEms.noVitals')}</p>}
          {vitals.map((set, index) => (
            <fieldset key={index} className="grid grid-cols-2 md:grid-cols-8 gap-2 items-end mb-2" aria-label={t('docEms.vitalsSet', { n: index + 1 })}>
              {(Object.keys(EMPTY_VITALS) as (keyof VitalsDraft)[]).map((key) => (
                <div key={key}>
                  <label htmlFor={`ems-v${index}-${key}`} className="block text-xs text-content-secondary mb-1">{t(`docEms.vital_${key}`)}</label>
                  <input
                    id={`ems-v${index}-${key}`}
                    type="number"
                    value={set[key]}
                    onChange={(e) => setVitals((all) => all.map((s, i) => (i === index ? { ...s, [key]: e.target.value } : s)))}
                    className="w-full px-2 py-1 border rounded bg-surface text-content"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => setVitals((all) => all.filter((_, i) => i !== index))}
                aria-label={t('docEms.removeVitals', { n: index + 1 })}
                className="p-2 rounded border border-border-interactive text-content justify-self-start"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </fieldset>
          ))}
        </section>

        <section>
          <label htmlFor="ems-interventions" className={label}>{t('docEms.interventionsLabel')}</label>
          <textarea id="ems-interventions" rows={3} value={interventions} onChange={(e) => setInterventions(e.target.value)} className={field} />
        </section>

        <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <legend className="font-semibold text-content mb-2">{t('docEms.sampleHeading')}</legend>
          {SAMPLE_FIELDS.map((key) => (
            <div key={key}>
              <label htmlFor={`ems-sample-${key}`} className={label}>{t(`docEms.sample_${key}`)}</label>
              <input
                id={`ems-sample-${key}`}
                value={sample[key]}
                onChange={(e) => setSample((s) => ({ ...s, [key]: e.target.value }))}
                className={field}
              />
            </div>
          ))}
        </fieldset>

        <fieldset>
          <legend className="font-semibold text-content mb-2">{t('docEms.alertsHeading')}</legend>
          <div className="flex flex-wrap gap-4">
            {ALERTS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={alerts[key]}
                  onChange={(e) => setAlerts((a) => ({ ...a, [key]: e.target.checked }))}
                />
                {t(`docEms.alert_${key}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <section>
          <label htmlFor="ems-notes" className={label}>{t('docEms.notesLabel')}</label>
          <textarea id="ems-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
        </section>

        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg font-medium bg-brand text-brand-fg disabled:opacity-60"
        >
          {saving ? t('docEms.saving') : t('docEms.save')}
        </button>
      </form>

      <section className="bg-surface rounded-xl shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-content">{t('docEms.arrivalsHeading')}</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-2 px-3 py-1 text-sm rounded-lg border border-border-interactive text-content"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> {t('docEms.refresh')}
          </button>
        </div>
        {!loaded ? (
          <p className="text-sm text-content-muted flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> {t('docEms.loading')}
          </p>
        ) : listUnknown ? (
          <p className="text-sm text-content-muted">{t('docEms.arrivalsUnknown')}</p>
        ) : handoffs.length === 0 ? (
          <p className="text-sm text-content-muted">{t('docEms.noArrivals')}</p>
        ) : (
          <ul className="space-y-3" data-testid="ems-arrivals">
            {handoffs.map((handoff) => (
              <li key={handoff.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-content">{handoff.chief_complaint}</p>
                  <span className="text-xs text-content-muted">{formatTimestamp(handoff.received_at)}</span>
                </div>
                <p className="text-sm text-content-secondary">
                  {[handoff.ems_agency, handoff.unit_number, handoff.patient_id ?? t('docEms.unidentified')]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {ALERTS.some((a) => handoff[a]) && (
                  <p className="text-xs font-bold text-critical-subtle-fg mt-1">
                    {ALERTS.filter((a) => handoff[a]).map((a) => t(`docEms.alert_${a}`)).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default EmsHandoffPage;
