import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { createTrauma, getPatients, getPatientTraumas, formatTimestamp, notifySuccess, useTranslation, type TraumaListRow, ChoiceChips, submitOnce, useSubmission, useLatestRequest } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import {
  AlertCircle,
  Save,
  Search,
  Activity,
  Shield,
  History
} from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import { useReturnAfterSave } from '../workspace/useReturnAfterSave';


export default function TraumaPage() {
  const { t } = useTranslation();
  const returnAfterSave = useReturnAfterSave();
  const { user } = useAuthStore();
  const { showError } = useToastActions();
  // The roster this page fetched existed only to fill a patient dropdown.
  // `PatientSelect` queries the server as the clinician types.
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  // The list endpoint returns summary rows keyed `id`. This panel read
  // `event_id`, `event_type` and `outcome` off them -- names from the
  // full-record shape -- so every row showed a blank ID and "N/A".
  const [emergencyHistory, setEmergencyHistory] = useState<TraumaListRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const submission = useSubmission('trauma');
  
  // Trauma Form State
  const [traumaType, setTraumaType] = useState('blunt');
  const [mechanism, setMechanism] = useState('');
  const [gcsScore, setGcsScore] = useState(15);
  const [issScore, setIssScore] = useState(0);
  
  // Primary Survey
  const [airway, setAirway] = useState('patent');
  const [breathing, setBreathing] = useState('spontaneous');
  const [circulation, setCirculation] = useState('stable');
  const [disability, setDisability] = useState('alert');
  const [exposure, setExposure] = useState('none');

  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    try {
      await getPatients();
    } catch (error) {
      // ux-allow(console-catch): a warm-up whose result is discarded; nothing on screen depends on it (debt register).
      console.error('Failed to load patients', error);
    }
  };

  const beginHistoryRead = useLatestRequest();
  const fetchEmergencyHistory = async (patientId: string) => {
    // Only the patient now selected may answer: an earlier patient's history
    // arriving late would otherwise be listed under this one.
    const current = beginHistoryRead();
    if (!user || !patientId) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const history = await getPatientTraumas(patientId);
      if (current()) setEmergencyHistory(history);
    } catch {
      if (!current()) return;
      // Not "no events": a history that could not be read is unknown.
      setEmergencyHistory([]);
      setHistoryError(t('docTrauma.errorLoadHistory'));
    } finally {
      if (current()) setHistoryLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Said in words; the button is no longer greyed out to mean "choose a patient".
    if (!selectedPatient) { showError(t('docTrauma.errorSelectPatient')); return; }

    try {
      const traumaData = {
        patient_id: selectedPatient,
        trauma_type: traumaType,
        injury_severity_score: issScore,
        gcs_score: gcsScore,
        mechanism_of_injury: mechanism,
        injuries: [], // Injuries added via injury documentation form
        interventions: [],
        // No `vital_signs`. This sent `{bp: "120/80", hr: 80, rr: 16, spo2: 98}`
        // under a comment reading "Default vitals - updated from patient
        // monitoring" — an update that does not happen. Every trauma assessment
        // on file therefore records textbook-normal observations for a trauma
        // patient, on someone who may be shocked.
        //
        // This page has no vital-signs inputs; observations are recorded on the
        // Vitals page against the same patient. Sending none is the truthful
        // answer, and an absent set reads as "not recorded here" rather than as
        // a stable patient.

        notes: `Primary Survey:\nA: ${airway}\nB: ${breathing}\nC: ${circulation}\nD: ${disability}\nE: ${exposure}\n\nNotes: ${notes}`,
        assessed_at: Math.floor(Date.now() / 1000)
      };

      // One record per event: a double click or a retry is the same submission.
      const saved = await submitOnce(submission, traumaData, () => createTrauma(traumaData));
      if (saved === 'busy') return;
      notifySuccess(t(saved === 'saved' ? 'forms.saved' : saved === 'duplicate' ? 'forms.alreadySaved' : 'forms.queued'));
      returnAfterSave();
    } catch (error) {
      console.error('Failed to save trauma assessment', error);
      showError(t('docTrauma.saveFailed'));
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-content flex items-center">
          <Shield className="h-8 w-8 text-critical-subtle-fg mr-3" />
          {t('docTrauma.title')}
        </h1>
        <p className="mt-2 text-content-muted">
          {t('docTrauma.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Patient Selection */}
        <div data-patient-picker-card className="bg-surface shadow rounded-lg p-6">
          <label htmlFor="trauma-patient" className="block text-sm font-medium text-content-secondary mb-2">
            {t('docTrauma.selectPatient')}
          </label>
          <div className="relative max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-content-muted" />
            </div>
            <PatientSelect
              id="trauma-patient"
              value={selectedPatient}
              onChange={(selectedPatientId) => { setSelectedPatient(selectedPatientId); fetchEmergencyHistory(selectedPatientId); }}
              required
            />
          </div>
        </div>

        {/* Emergency History */}
        {selectedPatient && (
          <div className="bg-surface shadow rounded-lg p-6">
            <h3 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
              <History className="h-5 w-5 text-critical" />
              {t('docTrauma.pastEvents')}
            </h3>
            {historyLoading ? (
              <p className="text-content-muted text-sm">{t('docTrauma.loadingHistory')}</p>
            ) : historyError ? (
              <p role="alert" className="text-sm text-critical-subtle-fg">{historyError}</p>
            ) : emergencyHistory.length === 0 ? (
              <p className="text-content-muted text-sm italic">{t('docTrauma.noEvents')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-content-muted">{t('docTrauma.colEventId')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-content-muted">{t('docTrauma.colMechanism')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-content-muted">{t('docTrauma.colTime')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-content-muted">{t('docTrauma.colGcs')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {emergencyHistory.map((ev) => (
                      <tr key={ev.id} className="hover:bg-surface-sunken">
                        <td className="px-4 py-2 font-mono text-xs">{ev.id}</td>
                        <td className="px-4 py-2">{ev.mechanism}</td>
                        <td className="px-4 py-2">{formatTimestamp(ev.assessed_at * 1000) || '-'}</td>
                        <td className="px-4 py-2">{ev.gcs ?? t('docTrauma.na')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Mechanism & Overview */}
        <div className="bg-surface shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-content mb-4 flex items-center">
            <AlertCircle className="h-5 w-5 mr-2 text-content-muted" />
            {t('docTrauma.injuryOverview')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <ChoiceChips
                id="trauma-type"
                label={t('docTrauma.traumaType')}
                value={traumaType}
                onChange={(next) => { if (next === undefined) return; setTraumaType(next); }}
                options={[
                  { value: 'blunt', label: t('docTrauma.typeBlunt') },
                  { value: 'penetrating', label: t('docTrauma.typePenetrating') },
                  { value: 'burn', label: t('docTrauma.typeBurn') },
                  { value: 'blast', label: t('docTrauma.typeBlast') },
                ]}
              />
            </div>
            <div>
              <label htmlFor="trauma-mechanism" className="block text-sm font-medium text-content-secondary">{t('docTrauma.mechanism')}</label>
              <input
                id="trauma-mechanism"
                type="text"
                className="mt-1 block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder={t('docTrauma.mechanismPlaceholder')}
                value={mechanism}
                onChange={(e) => setMechanism(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="trauma-gcs" className="block text-sm font-medium text-content-secondary">{t('docTrauma.gcsScore')}</label>
              <input
                id="trauma-gcs"
                type="number"
                min="3"
                max="15"
                className="mt-1 block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={gcsScore}
                onChange={(e) => setGcsScore(parseInt(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="trauma-iss" className="block text-sm font-medium text-content-secondary">{t('docTrauma.issScore')}</label>
              <input
                id="trauma-iss"
                type="number"
                min="0"
                max="75"
                className="mt-1 block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={issScore}
                onChange={(e) => setIssScore(parseInt(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Primary Survey (ABCDE) */}
        <div className="bg-surface shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-content mb-4 flex items-center">
            <Activity className="h-5 w-5 mr-2 text-content-muted" />
            {t('docTrauma.primarySurvey')}
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <ChoiceChips
                id="trauma-airway"
                label={t('docTrauma.airway')}
                value={airway}
                onChange={(next) => { if (next === undefined) return; setAirway(next); }}
                options={[
                  { value: 'patent', label: t('docTrauma.airwayPatent') },
                  { value: 'obstructed', label: t('docTrauma.airwayObstructed') },
                  { value: 'intubated', label: t('docTrauma.airwayIntubated') },
                  { value: 'c-spine', label: t('docTrauma.airwayCSpine') },
                ]}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <ChoiceChips
                id="trauma-breathing"
                label={t('docTrauma.breathing')}
                value={breathing}
                onChange={(next) => { if (next === undefined) return; setBreathing(next); }}
                options={[
                  { value: 'spontaneous', label: t('docTrauma.breathingSpontaneous') },
                  { value: 'labored', label: t('docTrauma.breathingLabored') },
                  { value: 'absent', label: t('docTrauma.breathingAbsent') },
                  { value: 'ventilated', label: t('docTrauma.breathingVentilated') },
                ]}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <ChoiceChips
                id="trauma-circulation"
                label={t('docTrauma.circulation')}
                value={circulation}
                onChange={(next) => { if (next === undefined) return; setCirculation(next); }}
                options={[
                  { value: 'stable', label: t('docTrauma.circStable') },
                  { value: 'tachycardic', label: t('docTrauma.circTachycardic') },
                  { value: 'weak', label: t('docTrauma.circWeak') },
                  { value: 'absent', label: t('docTrauma.circAbsent') },
                  { value: 'hemorrhage', label: t('docTrauma.circHemorrhage') },
                ]}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <ChoiceChips
                id="trauma-disability"
                label={t('docTrauma.disability')}
                value={disability}
                onChange={(next) => { if (next === undefined) return; setDisability(next); }}
                options={[
                  { value: 'alert', label: t('docTrauma.disAlert') },
                  { value: 'voice', label: t('docTrauma.disVoice') },
                  { value: 'pain', label: t('docTrauma.disPain') },
                  { value: 'unresponsive', label: t('docTrauma.disUnresponsive') },
                ]}
              />
            </div>
            {/* E — Exposure. A, B, C and D each had a control; this did not, so
                every primary survey narrative recorded "E: none" regardless of
                what was found. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <ChoiceChips
                id="trauma-exposure"
                label={t('docTrauma.exposure')}
                value={exposure}
                onChange={(next) => { if (next === undefined) return; setExposure(next); }}
                options={[
                  { value: 'none', label: t('docTrauma.expNone') },
                  { value: 'log-rolled', label: t('docTrauma.expLogRolled') },
                  { value: 'fully-exposed', label: t('docTrauma.expFullyExposed') },
                  { value: 'hypothermia-risk', label: t('docTrauma.expHypothermia') },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-surface shadow rounded-lg p-6">
          <label htmlFor="trauma-notes" className="block text-sm font-medium text-content-secondary mb-2">{t('docTrauma.additionalNotes')}</label>
          <textarea
            id="trauma-notes"
            rows={4}
            className="block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            aria-disabled={submission.status === 'saving' || undefined}
            className="aria-disabled:cursor-wait flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            <Save className="h-5 w-5 mr-2" />
            {t('docTrauma.saveAssessment')}
          </button>
        </div>
      </form>
    </div>
  );
}
