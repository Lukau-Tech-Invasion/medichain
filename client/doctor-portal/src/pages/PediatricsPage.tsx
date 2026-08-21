import React, { useState, useEffect } from 'react';
import {
  Baby,
  Search,
  Plus,
  TrendingUp,
  Ruler,
  Scale,
  Activity,
  AlertTriangle,
  CheckCircle,
  Heart,
  FileSignature
} from 'lucide-react';
import { createPeds, listPedsForPatient } from '../../../shared/src/api/endpoints';
import { getPatients, useTranslation } from '@medichain/shared';

/**
 * PediatricsPage
 * 
 * Page for pediatric assessment and documentation.
 * Implements pediatric assessment form, growth chart, and risk screening.
 */

type AgeGroup = 'newborn' | 'infant' | 'toddler' | 'preschool' | 'school-age' | 'adolescent';
type DevelopmentStatus = 'on-track' | 'monitor' | 'concern';

interface GrowthData {
  date: Date;
  weight: number;
  height: number;
  headCircumference?: number;
  bmi?: number;
  weightPercentile: number;
  heightPercentile: number;
}

interface PediatricPatient {
  id: string;
  name: string;
  mrn: string;
  dob: Date;
  ageMonths: number;
  ageGroup: AgeGroup;
  gender: 'male' | 'female';
  growthData: GrowthData[];
  vaccinesUpToDate: boolean;
  developmentStatus: DevelopmentStatus;
  alerts: string[];
}

/**
 * The child's most recent growth point, or `undefined` when none is recorded.
 *
 * Returning `undefined` rather than indexing blindly is the point: a newly
 * registered child has no assessment yet, and every caller here renders a dash
 * instead of crashing the page.
 */
const latestGrowthOf = (patient: PediatricPatient): GrowthData | undefined =>
  patient.growthData.length > 0 ? patient.growthData[patient.growthData.length - 1] : undefined;

const PediatricsPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'patients' | 'assessment' | 'growth'>('patients');
  const [patients, setPatients] = useState<PediatricPatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PediatricPatient | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [assessmentForm, setAssessmentForm] = useState({
    patientId: '',
    weightKg: '',
    heightCm: '',
    heartRate: '',
    respiratoryRate: '',
    temperature: '',
    patAppearance: 'normal',
    patWorkOfBreathing: 'normal',
    patCirculation: 'normal',
    developmentalStatus: 'on-track',
    notes: ''
  });

  /**
   * Load the paediatric caseload from the patient register.
   *
   * This effect used to `setPatients([...])` with two invented children and
   * four hand-written growth points each. The page therefore charted the same
   * fictional growth curves in every deployment, and no real child ever
   * appeared on it.
   *
   * Patients now come from the register and are filtered to under-18s by date
   * of birth; each child's growth series is loaded from their own pediatric
   * assessments on selection, so nothing is charted that was not recorded.
   */
  useEffect(() => {
    const ageGroupFor = (months: number): AgeGroup => {
      if (months < 1) return 'newborn';
      if (months < 12) return 'infant';
      if (months < 36) return 'toddler';
      if (months < 60) return 'preschool';
      if (months < 144) return 'school-age';
      return 'adolescent';
    };

    const monthsBetween = (dob: Date, now: Date) =>
      Math.max(0, (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth()));

    const loadPatients = async () => {
      try {
        const register = await getPatients();
        const now = new Date();
        const children = (register || [])
          .map((entry) => {
            const raw = entry as unknown as Record<string, unknown>;
            const dobRaw = (raw.date_of_birth ?? raw.dob ?? raw.dateOfBirth) as string | undefined;
            if (!dobRaw) return null;
            const dob = new Date(dobRaw);
            if (Number.isNaN(dob.getTime())) return null;
            const ageMonths = monthsBetween(dob, now);
            // Paediatrics covers birth to the 18th birthday.
            if (ageMonths >= 216) return null;
            return {
              id: String(raw.patient_id ?? ''),
              name: String(raw.full_name ?? ''),
              mrn: String(raw.mrn ?? raw.health_id ?? raw.patient_id ?? ''),
              dob,
              ageMonths,
              ageGroup: ageGroupFor(ageMonths),
              gender: String(raw.gender ?? '').toLowerCase() === 'female' ? 'female' : 'male',
              // Filled in from the child's own assessments on selection.
              growthData: [],
              vaccinesUpToDate: Boolean(raw.vaccines_up_to_date ?? false),
              developmentStatus: 'on-track',
              alerts: [],
            } as PediatricPatient;
          })
          .filter((entry): entry is PediatricPatient => entry !== null);
        setPatients(children);
      } catch (err) {
        console.error('Failed to load pediatric patients:', err);
        setPatients([]);
      }
    };
    loadPatients();
  }, []);

  /** Load the selected child's recorded growth points. */
  useEffect(() => {
    if (!selectedPatient || selectedPatient.growthData.length > 0) return;
    let cancelled = false;
    const loadGrowth = async () => {
      try {
        const response = await listPedsForPatient(selectedPatient.id);
        if (cancelled) return;
        const points: GrowthData[] = (response.items || [])
          .map((item) => {
            const wrapper = item as { data?: Record<string, unknown>; created_at?: string };
            const record = wrapper.data ?? (item as Record<string, unknown>);
            const weight = Number(record.weight_kg ?? 0);
            const height = Number(record.height_cm ?? 0);
            if (!weight && !height) return null;
            return {
              date: new Date(wrapper.created_at ?? Date.now()),
              weight,
              height,
              headCircumference: record.head_circumference_cm
                ? Number(record.head_circumference_cm)
                : undefined,
              weightPercentile: Number(record.weight_percentile ?? 0),
              heightPercentile: Number(record.height_percentile ?? 0),
            } as GrowthData;
          })
          .filter((point): point is GrowthData => point !== null)
          .sort((a, b) => a.date.getTime() - b.date.getTime());
        if (points.length > 0) {
          setSelectedPatient((current) =>
            current && current.id === selectedPatient.id
              ? { ...current, growthData: points }
              : current,
          );
        }
      } catch (err) {
        console.error('Failed to load growth history:', err);
      }
    };
    loadGrowth();
    return () => {
      cancelled = true;
    };
  }, [selectedPatient]);

  const getAgeDisplay = (months: number): string => {
    if (months < 1) return 'Newborn';
    if (months < 12) return `${months} months`;
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return remainingMonths > 0 ? `${years} yr ${remainingMonths} mo` : `${years} years`;
  };

  const getAgeGroupColor = (group: AgeGroup): string => {
    const colors: Record<AgeGroup, string> = {
      'newborn': 'bg-surface-sunken text-content-secondary',
      'infant': 'bg-surface-sunken text-content-secondary',
      'toddler': 'bg-notice-subtle text-notice-subtle-fg',
      'preschool': 'bg-ok-subtle text-ok-subtle-fg',
      'school-age': 'bg-surface-sunken text-content-secondary',
      'adolescent': 'bg-surface-sunken text-content-secondary'
    };
    return colors[group];
  };

  const getDevelopmentBadge = (status: DevelopmentStatus) => {
    const styles: Record<DevelopmentStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'on-track': { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg', icon: <CheckCircle className="w-3 h-3" /> },
      'monitor': { bg: 'bg-caution-subtle', text: 'text-caution-subtle-fg', icon: <Activity className="w-3 h-3" /> },
      'concern': { bg: 'bg-critical-subtle', text: 'text-critical-subtle-fg', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const s = styles[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {t(`docPediatrics.devStatus_${status}`)}
      </span>
    );
  };

  const filteredPatients = patients.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.mrn.includes(searchQuery)
  );

  const handleSubmitAssessment = async () => {
    if (!assessmentForm.patientId || !assessmentForm.weightKg || !assessmentForm.heartRate) {
      alert(t('docPediatrics.warningRequiredFields'));
      return;
    }

    try {
      // Mapping to the backend PediatricAssessment structure
      const assessmentData = {
        assessment_id: `PEDS-${Date.now()}`,
        patient_id: selectedPatient?.id || assessmentForm.patientId,
        age: {
          years: Math.floor((selectedPatient?.ageMonths || 0) / 12),
          months: (selectedPatient?.ageMonths || 0) % 12,
          category: (selectedPatient?.ageGroup || 'infant').charAt(0).toUpperCase() + (selectedPatient?.ageGroup || 'infant').slice(1)
        },
        weight_kg: parseFloat(assessmentForm.weightKg) || 0,
        // Collected by the form but previously never sent, so a child's
        // height and the clinician's notes were discarded on save.
        length_cm: parseFloat(assessmentForm.heightCm) || null,
        notes: assessmentForm.notes,
        weight_method: 'Measured',
        vital_signs: {
          heart_rate: parseInt(assessmentForm.heartRate) || 0,
          hr_interpretation: 'Normal',
          respiratory_rate: parseInt(assessmentForm.respiratoryRate) || 0,
          rr_interpretation: 'Normal',
          temperature_celsius: parseFloat(assessmentForm.temperature) || 37.0,
          temp_interpretation: 'Normal'
        },
        pat: {
          appearance: assessmentForm.patAppearance === 'normal' ? 'Normal' : 'Abnormal',
          work_of_breathing: assessmentForm.patWorkOfBreathing === 'normal' ? 'Normal' : 'Abnormal',
          circulation: assessmentForm.patCirculation === 'normal' ? 'Normal' : 'Abnormal'
        },
        pain: {
          score: 0,
          scale_used: 'FLACC'
        },
        development: assessmentForm.developmentalStatus,
        history: {
          symptoms: '',
          allergies: '',
          medications: '',
          past_history: '',
          last_meal: '',
          events: ''
        },
        immunizations: 'Up to date',
        abuse_screening: {
          concerns: false,
          notes: ''
        },
        guardian_present: true,
        assessed_at: Date.now()
      };

      await createPeds(assessmentData);
      alert(t('docPediatrics.submittedSuccess'));
      setActiveTab('patients');
      // Reset form
      setAssessmentForm({
        patientId: '', weightKg: '', heightCm: '', heartRate: '', respiratoryRate: '', temperature: '',
        patAppearance: 'normal', patWorkOfBreathing: 'normal', patCirculation: 'normal',
        developmentalStatus: 'on-track', notes: ''
      });
    } catch (error) {
      console.error('Failed to submit pediatric assessment:', error);
      alert(t('docPediatrics.submitError'));
    }
  };

  const developmentalMilestones: Record<AgeGroup, string[]> = {
    'newborn': ['Startles to loud sounds', 'Focuses on faces', 'Moves arms and legs equally'],
    'infant': ['Sits without support', 'Responds to name', 'Babbles', 'Transfers objects hand to hand'],
    'toddler': ['Walks independently', 'Says 2-word phrases', 'Follows simple instructions', 'Points to show interest'],
    'preschool': ['Hops on one foot', 'Speaks in sentences', 'Plays with other children', 'Can tell stories'],
    'school-age': ['Rides bicycle', 'Reads independently', 'Understands time concepts', 'Shows empathy'],
    'adolescent': ['Abstract thinking', 'Identity formation', 'Peer relationships', 'Future planning']
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-sky-500 to-blue-400 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Baby className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docPediatrics.title')}</h1>
        </div>
        <p className="text-sky-100">{t('docPediatrics.subtitle')}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
        <div className="bg-surface rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-content-secondary">{patients.length}</p>
          <p className="text-xs text-content-muted">{t('docPediatrics.statPatients')}</p>
        </div>
        <div className="bg-surface rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-caution-subtle-fg">{patients.filter(p => p.alerts.length > 0).length}</p>
          <p className="text-xs text-content-muted">{t('docPediatrics.statNeedsAttention')}</p>
        </div>
        <div className="bg-surface rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-ok-subtle-fg">{patients.filter(p => p.vaccinesUpToDate).length}</p>
          <p className="text-xs text-content-muted">{t('docPediatrics.statVaccinesCurrent')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {(['patients', 'assessment', 'growth'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium capitalize ${
                activeTab === tab ? 'text-notice-subtle-fg border-b-2 border-sky-700' : 'text-content-muted'
              }`}
            >
              {tab === 'patients' ? t('docPediatrics.tabAllPatients') : tab === 'assessment' ? t('docPediatrics.tabAssessment') : t('docPediatrics.tabGrowthCharts')}
            </button>
          ))}
        </div>
      </div>

      {/* Patients Tab */}
      {activeTab === 'patients' && (
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('docPediatrics.searchPh')}
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>

          <div className="space-y-3">
            {filteredPatients.map(patient => {
              const latestGrowth = latestGrowthOf(patient);
              return (
                <div
                  key={patient.id}
                  onClick={() => setSelectedPatient(patient)}
                  className={`bg-surface rounded-lg shadow border p-4 cursor-pointer hover:shadow-md ${
                    patient.alerts.length > 0 ? 'border-l-4 border-l-yellow-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{patient.name}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs ${getAgeGroupColor(patient.ageGroup)}`}>
                          {t(`docPediatrics.ageGroup_${patient.ageGroup}`)}
                        </span>
                      </div>
                      <p className="text-sm text-content-muted">
                        {t('docPediatrics.ageMrnLine', { age: getAgeDisplay(patient.ageMonths), mrn: patient.mrn })}
                      </p>
                    </div>
                    {getDevelopmentBadge(patient.developmentStatus)}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-surface-sunken rounded p-2 text-center">
                      <Scale className="w-4 h-4 mx-auto text-content-muted mb-1" />
                      <p className="text-sm font-semibold">{latestGrowth?.weight ?? '-'} kg</p>
                      <p className="text-xs text-content-muted">{latestGrowth?.weightPercentile ?? '-'}%ile</p>
                    </div>
                    <div className="bg-surface-sunken rounded p-2 text-center">
                      <Ruler className="w-4 h-4 mx-auto text-content-muted mb-1" />
                      <p className="text-sm font-semibold">{latestGrowth?.height ?? '-'} cm</p>
                      <p className="text-xs text-content-muted">{latestGrowth?.heightPercentile ?? '-'}%ile</p>
                    </div>
                    <div className="bg-surface-sunken rounded p-2 text-center">
                      <Heart className="w-4 h-4 mx-auto text-content-muted mb-1" />
                      <p className="text-sm font-semibold">{patient.vaccinesUpToDate ? '✓' : '!'}</p>
                      <p className="text-xs text-content-muted">{t('docPediatrics.vaccinesLabel')}</p>
                    </div>
                  </div>

                  {patient.alerts.length > 0 && (
                    <div className="bg-caution-subtle border border-caution rounded p-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-caution-subtle-fg flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-caution-subtle-fg">
                          {patient.alerts.map((alert, idx) => (
                            <p key={idx}>{alert}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Assessment Tab */}
      {activeTab === 'assessment' && (
        <div className="p-4">
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docPediatrics.newAssessmentHeading')}</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="peds-patient" className="block text-sm font-medium mb-1">{t('docPediatrics.patientRequired')} *</label>
                <select
                  id="peds-patient"
                  value={assessmentForm.patientId}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, patientId: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">{t('docPediatrics.selectPatientPh')}</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.name} - {getAgeDisplay(p.ageMonths)}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="peds-weight" className="block text-sm font-medium mb-1">{t('docPediatrics.weightKgRequired')} *</label>
                  <input
                    id="peds-weight"
                    type="number"
                    step="0.1"
                    value={assessmentForm.weightKg}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, weightKg: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="0.0"
                  />
                </div>
                <div>
                  <label htmlFor="peds-height" className="block text-sm font-medium mb-1">{t('docPediatrics.heightCmRequired')} *</label>
                  <input
                    id="peds-height"
                    type="number"
                    step="0.1"
                    value={assessmentForm.heightCm}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, heightCm: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="0.0"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="peds-hr" className="block text-sm font-medium mb-1">{t('docPediatrics.heartRateRequired')} *</label>
                  <input
                    id="peds-hr"
                    type="number"
                    value={assessmentForm.heartRate}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, heartRate: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder={t('docPediatrics.heartRatePh')}
                  />
                </div>
                <div>
                  <label htmlFor="peds-rr" className="block text-sm font-medium mb-1">{t('docPediatrics.respRateLabel')}</label>
                  <input
                    id="peds-rr"
                    type="number"
                    value={assessmentForm.respiratoryRate}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, respiratoryRate: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder={t('docPediatrics.respRatePh')}
                  />
                </div>
                <div>
                  <label htmlFor="peds-temperature" className="block text-sm font-medium mb-1">{t('docPediatrics.temperatureLabel')}</label>
                  <input
                    id="peds-temperature"
                    type="number"
                    step="0.1"
                    value={assessmentForm.temperature}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, temperature: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="36.5"
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-3">{t('docPediatrics.patHeading')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-content-muted mb-1">{t('docPediatrics.appearanceLabel')}</label>
                    <select
                      value={assessmentForm.patAppearance}
                      onChange={(e) => setAssessmentForm({ ...assessmentForm, patAppearance: e.target.value })}
                      className="w-full border rounded-lg px-2 py-1 text-sm"
                    >
                      <option value="normal">{t('docPediatrics.normalOption')}</option>
                      <option value="abnormal">{t('docPediatrics.abnormalOption')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-content-muted mb-1">{t('docPediatrics.workOfBreathingLabel')}</label>
                    <select
                      value={assessmentForm.patWorkOfBreathing}
                      onChange={(e) => setAssessmentForm({ ...assessmentForm, patWorkOfBreathing: e.target.value })}
                      className="w-full border rounded-lg px-2 py-1 text-sm"
                    >
                      <option value="normal">{t('docPediatrics.normalOption')}</option>
                      <option value="abnormal">{t('docPediatrics.abnormalOption')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-content-muted mb-1">{t('docPediatrics.circulationLabel')}</label>
                    <select
                      value={assessmentForm.patCirculation}
                      onChange={(e) => setAssessmentForm({ ...assessmentForm, patCirculation: e.target.value })}
                      className="w-full border rounded-lg px-2 py-1 text-sm"
                    >
                      <option value="normal">{t('docPediatrics.normalOption')}</option>
                      <option value="abnormal">{t('docPediatrics.abnormalOption')}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t('docPediatrics.developmentalStatusLabel')}</label>
                <div className="flex gap-4">
                  {(['on-track', 'monitor', 'concern'] as const).map(status => (
                    <label key={status} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="dev-status"
                        checked={assessmentForm.developmentalStatus === status}
                        onChange={() => setAssessmentForm({ ...assessmentForm, developmentalStatus: status })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{t(`docPediatrics.devStatus_${status}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="peds-notes" className="block text-sm font-medium mb-1">{t('docPediatrics.notesLabel')}</label>
                <textarea
                  id="peds-notes"
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  value={assessmentForm.notes}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, notes: e.target.value })}
                  placeholder={t('docPediatrics.notesPh')}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setActiveTab('patients')}
                  className="flex-1 py-3 border border-border-strong rounded-lg font-medium"
                >
                  {t('docPediatrics.cancelButton')}
                </button>
                <button
                  onClick={handleSubmitAssessment}
                  className="flex-[2] py-3 bg-slate-800 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-slate-900"
                >
                  <FileSignature className="w-5 h-5" /> {t('docPediatrics.signSubmitButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Growth Charts Tab */}
      {activeTab === 'growth' && (
        <div className="p-4">
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docPediatrics.growthChartTrackingHeading')}</h2>
            <div className="space-y-4">
              {patients.map(patient => (
                <div key={patient.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">{patient.name}</h3>
                      <p className="text-sm text-content-muted">{getAgeDisplay(patient.ageMonths)}</p>
                    </div>
                    <TrendingUp className="w-5 h-5 text-green-500" />
                  </div>
                  <div className="h-24 bg-gradient-to-r from-sky-100 to-blue-100 rounded flex items-center justify-center text-content-muted">
                    <span className="text-sm">{t('docPediatrics.growthCurveVisualization')}</span>
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-content-muted">
                    <span>{t('docPediatrics.weightPercentileLine', { pct: latestGrowthOf(patient)?.weightPercentile ?? '-' })}</span>
                    <span>{t('docPediatrics.heightPercentileLine', { pct: latestGrowthOf(patient)?.heightPercentile ?? '-' })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Patient Detail Modal */}
      {selectedPatient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedPatient.name}</h2>
                <p className="text-sm text-content-muted">{getAgeDisplay(selectedPatient.ageMonths)} • {selectedPatient.gender}</p>
              </div>
              <button onClick={() => setSelectedPatient(null)} className="text-content-muted hover:text-content-muted text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-notice-subtle rounded-lg p-4 text-center">
                  <Scale className="w-6 h-6 mx-auto text-notice-subtle-fg mb-1" />
                  <p className="text-xl font-bold">{latestGrowthOf(selectedPatient)?.weight ?? '-'} kg</p>
                  <p className="text-sm text-notice-subtle-fg">{t('docPediatrics.percentileLine', { pct: latestGrowthOf(selectedPatient)?.weightPercentile ?? '-' })}</p>
                </div>
                <div className="bg-surface-sunken rounded-lg p-4 text-center">
                  <Ruler className="w-6 h-6 mx-auto text-content-secondary mb-1" />
                  <p className="text-xl font-bold">{latestGrowthOf(selectedPatient)?.height ?? '-'} cm</p>
                  <p className="text-sm text-content-secondary">{t('docPediatrics.percentileLine', { pct: latestGrowthOf(selectedPatient)?.heightPercentile ?? '-' })}</p>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">{t('docPediatrics.growthHistoryHeading')}</h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-sunken">
                      <tr>
                        <th className="p-2 text-left">{t('docPediatrics.tableDate')}</th>
                        <th className="p-2 text-right">{t('docPediatrics.tableWeight')}</th>
                        <th className="p-2 text-right">{t('docPediatrics.tableHeight')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPatient.growthData.slice().reverse().map((g, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{g.date.toLocaleDateString()}</td>
                          <td className="p-2 text-right">{g.weight} kg</td>
                          <td className="p-2 text-right">{g.height} cm</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2">
                <span className={`flex-1 text-center py-2 rounded-lg text-sm ${selectedPatient.vaccinesUpToDate ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-critical-subtle text-critical-subtle-fg'}`}>
                  {t('docPediatrics.vaccinesStatusLine', { status: selectedPatient.vaccinesUpToDate ? t('docPediatrics.upToDate') : t('docPediatrics.overdue') })}
                </span>
                {getDevelopmentBadge(selectedPatient.developmentStatus)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PediatricsPage;
