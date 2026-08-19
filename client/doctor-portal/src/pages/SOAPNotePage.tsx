import { useState, useEffect } from 'react';
import { useAuthStore } from '../store';
import { apiUrl, getApiErrorMessage, useTranslation } from '@medichain/shared';
import { 
  FileText, ArrowLeft, Check, Loader2, AlertCircle,
  User, Activity, Stethoscope, Pill, Calendar
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

interface PhysicalExamFinding {
  system: string;
  findings: string;
  is_normal: boolean;
}

interface DiagnosisEntry {
  description: string;
  icd10_code?: string;
  status: 'confirmed' | 'provisional' | 'rule-out';
}

interface PrescriptionEntry {
  medication: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity?: number;
  refills?: number;
  instructions?: string;
}

interface CreateSOAPNoteRequest {
  patient_id: string;
  encounter_type: string;
  subjective: {
    chief_complaint: string;
    history_of_present_illness: string;
    symptoms: string[];
    social_history?: string;
    family_history?: string;
    symptom_duration?: string;
    review_of_systems?: string;
    modifying_factors?: string;
    previous_treatments?: string;
  };
  objective: {
    vital_signs?: null;
    general_appearance?: string;
    physical_exam: PhysicalExamFinding[];
    lab_results: string[];
    imaging_results: string[];
    diagnostic_tests: string[];
  };
  assessment: {
    primary_diagnosis?: DiagnosisEntry;
    secondary_diagnoses: DiagnosisEntry[];
    clinical_summary: string;
    severity?: string;
    prognosis?: string;
  };
  plan: {
    treatment_plan: string;
    medications: PrescriptionEntry[];
    procedures: string[];
    lab_orders: string[];
    imaging_orders: string[];
    referrals: string[];
    patient_education: string[];
    follow_up?: string;
    return_precautions: string[];
    activity_restrictions?: string;
  };
}

const PHYSICAL_EXAM_SYSTEMS = [
  'General', 'HEENT', 'Cardiovascular', 'Respiratory', 'Gastrointestinal',
  'Genitourinary', 'Musculoskeletal', 'Neurological', 'Psychiatric', 'Skin'
];

const DIAGNOSIS_STATUSES: Array<'confirmed' | 'provisional' | 'rule-out'> = ['confirmed', 'provisional', 'rule-out'];

const MEDICATION_ROUTES = ['PO', 'IV', 'IM', 'SubQ', 'Topical', 'Inhalation', 'Rectal', 'Transdermal'];

const ROUTE_KEYS: Record<string, string> = {
  'PO': 'po',
  'IV': 'iv',
  'IM': 'im',
  'SubQ': 'subq',
  'Topical': 'topical',
  'Inhalation': 'inhalation',
  'Rectal': 'rectal',
  'Transdermal': 'transdermal',
};

interface PatientOption {
  patient_id: string;
  full_name: string;
  health_id?: string;
}

/**
 * SOAPNotePage - Create comprehensive SOAP (Subjective/Objective/Assessment/Plan) clinical notes
 */
function SOAPNotePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const patientIdFromUrl = searchParams.get('patientId');

  const { user, isAuthenticated } = useAuthStore();

  const ENCOUNTER_TYPES = [
    { value: 'initial', label: t('docSOAPNote.encounterType_initial') },
    { value: 'follow-up', label: t('docSOAPNote.encounterType_follow-up') },
    { value: 'consultation', label: t('docSOAPNote.encounterType_consultation') },
    { value: 'procedure', label: t('docSOAPNote.encounterType_procedure') },
  ];

  const translateSystem = (system: string) => t(`docSOAPNote.system_${system.toLowerCase()}`);
  
  // Patients fetched from API
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);

  // Existing SOAP notes
  const [existingNotes, setExistingNotes] = useState<Array<{note_id: string; encounter_type: string; created_at?: number; subjective?: {chief_complaint?: string}}>>([]);
  const [showNotesList, setShowNotesList] = useState(true);

  const [selectedPatientId, setSelectedPatientId] = useState(patientIdFromUrl || '');
  const [encounterType, setEncounterType] = useState('initial');
  
  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);
  
  // Fetch patients from API
  useEffect(() => {
    if (!user) return;

    const fetchPatients = async () => {
      setLoadingPatients(true);
      try {
        const response = await fetch(apiUrl('/api/patients'), {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
        });
        if (response.ok) {
          const data = await response.json();
          const patientArray = Array.isArray(data) ? data : (data.data || []);
          setPatients(patientArray);
        }
      } catch (err) {
        console.error('Failed to fetch patients:', err);
      } finally {
        setLoadingPatients(false);
      }
    };

    fetchPatients();
  }, [user]);

  // Fetch existing SOAP notes when patient is selected
  useEffect(() => {
    if (!user || !selectedPatientId) return;
    const fetchNotes = async () => {
      try {
        const response = await fetch(apiUrl(`/api/clinical/patient/${selectedPatientId}/soap`), {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setExistingNotes(Array.isArray(data) ? data : (data.notes || data.soap_notes || []));
        }
      } catch (err) {
        console.error('Failed to fetch SOAP notes:', err);
      }
    };
    fetchNotes();
  }, [selectedPatientId, user]);
  
  // SUBJECTIVE
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [hpi, setHpi] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [symptomDuration, setSymptomDuration] = useState('');
  const [reviewOfSystems, setReviewOfSystems] = useState('');
  const [modifyingFactors, setModifyingFactors] = useState('');
  const [previousTreatments, setPreviousTreatments] = useState('');
  
  // OBJECTIVE
  const [generalAppearance, setGeneralAppearance] = useState('');
  const [physicalExams, setPhysicalExams] = useState<PhysicalExamFinding[]>([]);
  const [labResults, setLabResults] = useState('');
  const [imagingResults, setImagingResults] = useState('');
  
  // ASSESSMENT
  const [primaryDiagnosis, setPrimaryDiagnosis] = useState('');
  const [primaryICD10, setPrimaryICD10] = useState('');
  const [primaryStatus, setPrimaryStatus] = useState<'confirmed' | 'provisional' | 'rule-out'>('confirmed');
  const [clinicalSummary, setClinicalSummary] = useState('');
  const [severity, setSeverity] = useState('');
  
  // PLAN
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [medications, setMedications] = useState<PrescriptionEntry[]>([]);
  const [procedures, setProcedures] = useState('');
  const [labOrders, setLabOrders] = useState('');
  const [imagingOrders, setImagingOrders] = useState('');
  const [referrals, setReferrals] = useState('');
  const [patientEducation, setPatientEducation] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [returnPrecautions, setReturnPrecautions] = useState('');
  const [activityRestrictions, setActivityRestrictions] = useState('');
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (patientIdFromUrl) {
      setSelectedPatientId(patientIdFromUrl);
    }
  }, [patientIdFromUrl]);

  const addPhysicalExam = (system: string) => {
    setPhysicalExams([...physicalExams, { system, findings: '', is_normal: true }]);
  };

  const updatePhysicalExam = (index: number, field: keyof PhysicalExamFinding, value: string | boolean) => {
    const updated = [...physicalExams];
    updated[index] = { ...updated[index], [field]: value };
    setPhysicalExams(updated);
  };

  const removePhysicalExam = (index: number) => {
    setPhysicalExams(physicalExams.filter((_, i) => i !== index));
  };

  const addMedication = () => {
    setMedications([...medications, {
      medication: '',
      dosage: '',
      route: 'PO',
      frequency: '',
      duration: '',
    }]);
  };

  const updateMedication = (index: number, field: keyof PrescriptionEntry, value: string | number) => {
    const updated = [...medications];
    updated[index] = { ...updated[index], [field]: value };
    setMedications(updated);
  };

  const removeMedication = (index: number) => {
    setMedications(medications.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      setError(t('docSOAPNote.errorAuthRequired'));
      return;
    }

    if (!selectedPatientId) {
      setError(t('docSOAPNote.errorSelectPatient'));
      return;
    }

    if (!chiefComplaint.trim()) {
      setError(t('docSOAPNote.errorChiefComplaintRequired'));
      return;
    }

    if (!clinicalSummary.trim()) {
      setError(t('docSOAPNote.errorClinicalSummaryRequired'));
      return;
    }

    if (!treatmentPlan.trim()) {
      setError(t('docSOAPNote.errorTreatmentPlanRequired'));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const symptomsList = symptoms.split(',').map(s => s.trim()).filter(s => s);
      const labResultsList = labResults.split(',').map(s => s.trim()).filter(s => s);
      const imagingResultsList = imagingResults.split(',').map(s => s.trim()).filter(s => s);
      const proceduresList = procedures.split(',').map(s => s.trim()).filter(s => s);
      const labOrdersList = labOrders.split(',').map(s => s.trim()).filter(s => s);
      const imagingOrdersList = imagingOrders.split(',').map(s => s.trim()).filter(s => s);
      const referralsList = referrals.split(',').map(s => s.trim()).filter(s => s);
      const patientEducationList = patientEducation.split(',').map(s => s.trim()).filter(s => s);
      const returnPrecautionsList = returnPrecautions.split(',').map(s => s.trim()).filter(s => s);

      const requestBody: CreateSOAPNoteRequest = {
        patient_id: selectedPatientId,
        encounter_type: encounterType,
        subjective: {
          chief_complaint: chiefComplaint.trim(),
          history_of_present_illness: hpi.trim(),
          symptoms: symptomsList,
          social_history: undefined,
          family_history: undefined,
          symptom_duration: symptomDuration.trim() || undefined,
          review_of_systems: reviewOfSystems.trim() || undefined,
          modifying_factors: modifyingFactors.trim() || undefined,
          previous_treatments: previousTreatments.trim() || undefined,
        },
        objective: {
          vital_signs: null,
          general_appearance: generalAppearance.trim() || undefined,
          physical_exam: physicalExams.filter(pe => pe.findings.trim()),
          lab_results: labResultsList,
          imaging_results: imagingResultsList,
          diagnostic_tests: [],
        },
        assessment: {
          primary_diagnosis: primaryDiagnosis.trim() ? {
            description: primaryDiagnosis.trim(),
            icd10_code: primaryICD10.trim() || undefined,
            status: primaryStatus,
          } : undefined,
          secondary_diagnoses: [],
          clinical_summary: clinicalSummary.trim(),
          severity: severity.trim() || undefined,
          prognosis: undefined,
        },
        plan: {
          treatment_plan: treatmentPlan.trim(),
          medications: medications.filter(m => m.medication.trim()),
          procedures: proceduresList,
          lab_orders: labOrdersList,
          imaging_orders: imagingOrdersList,
          referrals: referralsList,
          patient_education: patientEducationList,
          follow_up: followUp.trim() || undefined,
          return_precautions: returnPrecautionsList,
          activity_restrictions: activityRestrictions.trim() || undefined,
        },
      };

      const response = await fetch(apiUrl('/api/clinical/soap'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorText) as unknown;
        } catch {
          throw new Error(errorText || t('docSOAPNote.errorCreateFailed'));
        }
        throw new Error(getApiErrorMessage(errorData, t('docSOAPNote.errorCreateFailed')));
      }

      setSuccess(true);
      
      setTimeout(() => {
        navigate(`/patients/${selectedPatientId}`);
      }, 1500);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : t('docSOAPNote.errorCreateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-3 transition-colors"
        >
          <ArrowLeft size={20} />
          {t('docSOAPNote.backButton')}
        </button>
        <div className="flex items-center gap-3">
          <FileText size={32} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('docSOAPNote.title')}</h1>
            <p className="text-gray-500 mt-1">
              {t('docSOAPNote.subtitle')}
            </p>
          </div>
        </div>
      </div>

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <Check className="text-green-600" size={24} />
          <div>
            <p className="font-medium text-green-900">{t('docSOAPNote.createdSuccess')}</p>
            <p className="text-sm text-green-700">{t('docSOAPNote.redirecting')}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="text-red-600" size={24} />
          <div>
            <p className="font-medium text-red-900">{t('docSOAPNote.errorHeading')}</p>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Existing SOAP Notes */}
      {existingNotes.length > 0 && (
        <div className="bg-white rounded-xl shadow mb-6">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText size={18} className="text-primary-600" />
              {t('docSOAPNote.existingNotesHeading', { count: existingNotes.length })}
            </h2>
            <button
              type="button"
              onClick={() => setShowNotesList(!showNotesList)}
              className="text-sm text-blue-600 hover:underline"
            >
              {showNotesList ? t('docSOAPNote.hideButton') : t('docSOAPNote.showButton')}
            </button>
          </div>
          {showNotesList && (
            <div className="divide-y">
              {existingNotes.map((note) => (
                <div key={note.note_id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{note.subjective?.chief_complaint || t('docSOAPNote.noChiefComplaint')}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {note.encounter_type} &bull; {note.created_at ? new Date(note.created_at * 1000).toLocaleDateString() : t('docSOAPNote.notAvailable')}
                      </p>
                    </div>
                    <span className="text-xs font-mono text-gray-400">{note.note_id}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Patient & Encounter Info */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <User size={20} className="text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">{t('docSOAPNote.patientEncounterHeading')}</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="soap-patient-id" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.patientIdRequired')} *
              </label>
              <select
                id="soap-patient-id"
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
                disabled={loadingPatients}
              >
                <option value="">{loadingPatients ? t('docSOAPNote.loadingPatients') : t('docSOAPNote.selectPatientPh')}</option>
                {patients.map((patient) => (
                  <option key={patient.patient_id} value={patient.patient_id}>
                    {patient.full_name} ({patient.patient_id})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="soap-encounter-type" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.encounterTypeRequired')} *
              </label>
              <select
                id="soap-encounter-type"
                value={encounterType}
                onChange={(e) => setEncounterType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              >
                {ENCOUNTER_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* SUBJECTIVE Section */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <User size={20} className="text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">{t('docSOAPNote.subjectiveHeading')}</h2>
            <span className="text-sm text-gray-500">{t('docSOAPNote.subjectiveSubtitle')}</span>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="soap-chief-complaint" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.chiefComplaintRequired')} *
              </label>
              <input
                id="soap-chief-complaint"
                type="text"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
                placeholder={t('docSOAPNote.chiefComplaintPh')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <label htmlFor="soap-hpi" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.hpiLabel')}
              </label>
              <textarea
                id="soap-hpi"
                value={hpi}
                onChange={(e) => setHpi(e.target.value)}
                placeholder={t('docSOAPNote.hpiPh')}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-symptoms" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.symptomsLabel')}
                </label>
                <input
                  id="soap-symptoms"
                  type="text"
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  placeholder={t('docSOAPNote.symptomsPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-symptom-duration" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.symptomDurationLabel')}
                </label>
                <input
                  id="soap-symptom-duration"
                  type="text"
                  value={symptomDuration}
                  onChange={(e) => setSymptomDuration(e.target.value)}
                  placeholder={t('docSOAPNote.symptomDurationPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="soap-review-of-systems" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.reviewOfSystemsLabel')}
              </label>
              <textarea                id="soap-review-of-systems"                value={reviewOfSystems}
                onChange={(e) => setReviewOfSystems(e.target.value)}
                placeholder={t('docSOAPNote.reviewOfSystemsPh')}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-modifying-factors" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.modifyingFactorsLabel')}
                </label>
                <input
                  id="soap-modifying-factors"
                  type="text"
                  value={modifyingFactors}
                  onChange={(e) => setModifyingFactors(e.target.value)}
                  placeholder={t('docSOAPNote.modifyingFactorsPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-previous-treatments" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.previousTreatmentsLabel')}
                </label>
                <input
                  id="soap-previous-treatments"
                  type="text"
                  value={previousTreatments}
                  onChange={(e) => setPreviousTreatments(e.target.value)}
                  placeholder={t('docSOAPNote.previousTreatmentsPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* OBJECTIVE Section */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={20} className="text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900">{t('docSOAPNote.objectiveHeading')}</h2>
            <span className="text-sm text-gray-500">{t('docSOAPNote.objectiveSubtitle')}</span>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="soap-general-appearance" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.generalAppearanceLabel')}
              </label>
              <input
                id="soap-general-appearance"
                type="text"
                value={generalAppearance}
                onChange={(e) => setGeneralAppearance(e.target.value)}
                placeholder={t('docSOAPNote.generalAppearancePh')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="soap-physical-exam-system" className="text-sm font-medium text-gray-700">
                  {t('docSOAPNote.physicalExaminationLabel')}
                </label>
                <div className="flex gap-2">
                  <select
                    id="soap-physical-exam-system"
                    onChange={(e) => {
                      if (e.target.value) {
                        addPhysicalExam(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="text-sm px-3 py-1 border border-gray-300 rounded-lg"
                  >
                    <option value="">{t('docSOAPNote.addSystemPh')}</option>
                    {PHYSICAL_EXAM_SYSTEMS.map(system => (
                      <option key={system} value={system}>{translateSystem(system)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {physicalExams.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">
                  {t('docSOAPNote.noPhysicalExamFindings')}
                </p>
              ) : (
                <div className="space-y-3">
                  {physicalExams.map((exam, index) => (
                    <div key={index} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1 space-y-2">
                        <div className="font-medium text-sm text-gray-700">{translateSystem(exam.system)}</div>
                        <input
                          type="text"
                          value={exam.findings}
                          onChange={(e) => updatePhysicalExam(index, 'findings', e.target.value)}
                          placeholder={t('docSOAPNote.findingsPh')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={exam.is_normal}
                            onChange={(e) => updatePhysicalExam(index, 'is_normal', e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-sm text-gray-600">{t('docSOAPNote.normalFindingsCheckbox')}</span>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePhysicalExam(index)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        {t('docSOAPNote.removeButton')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-lab-results" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.labResultsLabel')}
                </label>
                <input
                  id="soap-lab-results"
                  type="text"
                  value={labResults}
                  onChange={(e) => setLabResults(e.target.value)}
                  placeholder={t('docSOAPNote.labResultsPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-imaging-results" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.imagingResultsLabel')}
                </label>
                <input
                  id="soap-imaging-results"
                  type="text"
                  value={imagingResults}
                  onChange={(e) => setImagingResults(e.target.value)}
                  placeholder={t('docSOAPNote.imagingResultsPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ASSESSMENT Section */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <Stethoscope size={20} className="text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">{t('docSOAPNote.assessmentHeading')}</h2>
            <span className="text-sm text-gray-500">{t('docSOAPNote.assessmentSubtitle')}</span>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label htmlFor="soap-primary-diagnosis" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.primaryDiagnosisLabel')}
                </label>
                <input
                  id="soap-primary-diagnosis"
                  type="text"
                  value={primaryDiagnosis}
                  onChange={(e) => setPrimaryDiagnosis(e.target.value)}
                  placeholder={t('docSOAPNote.primaryDiagnosisPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-icd10-code" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.icd10CodeLabel')}
                </label>
                <input
                  id="soap-icd10-code"
                  type="text"
                  value={primaryICD10}
                  onChange={(e) => setPrimaryICD10(e.target.value)}
                  placeholder="J20.9"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-diagnosis-status" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.diagnosisStatusLabel')}
                </label>
                <select                  id="soap-diagnosis-status"                  value={primaryStatus}
                  onChange={(e) => setPrimaryStatus(e.target.value as typeof primaryStatus)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  {DIAGNOSIS_STATUSES.map(status => (
                    <option key={status} value={status}>{t(`docSOAPNote.diagnosisStatus_${status}`)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="soap-severity" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.severityLabel')}
                </label>
                <input
                  id="soap-severity"
                  type="text"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  placeholder={t('docSOAPNote.severityPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="soap-clinical-summary" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.clinicalSummaryRequired')} *
              </label>
              <textarea                id="soap-clinical-summary"                value={clinicalSummary}
                onChange={(e) => setClinicalSummary(e.target.value)}
                placeholder={t('docSOAPNote.clinicalSummaryPh')}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
          </div>
        </div>

        {/* PLAN Section */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <Pill size={20} className="text-orange-600" />
            <h2 className="text-lg font-semibold text-gray-900">{t('docSOAPNote.planHeading')}</h2>
            <span className="text-sm text-gray-500">{t('docSOAPNote.planSubtitle')}</span>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="soap-treatment-plan" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.treatmentPlanRequired')} *
              </label>
              <textarea
                id="soap-treatment-plan"
                value={treatmentPlan}
                onChange={(e) => setTreatmentPlan(e.target.value)}
                placeholder={t('docSOAPNote.treatmentPlanPh')}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="soap-add-medication" className="text-sm font-medium text-gray-700">
                  {t('docSOAPNote.medicationsLabel')}
                </label>
                <button
                  id="soap-add-medication"
                  type="button"
                  onClick={addMedication}
                  className="text-sm px-3 py-1 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  {t('docSOAPNote.addMedicationButton')}
                </button>
              </div>

              {medications.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">
                  {t('docSOAPNote.noMedicationsYet')}
                </p>
              ) : (
                <div className="space-y-3">
                  {medications.map((med, index) => (
                    <div key={index} className="p-4 bg-gray-50 rounded-lg space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <input
                          type="text"
                          value={med.medication}
                          onChange={(e) => updateMedication(index, 'medication', e.target.value)}
                          placeholder={t('docSOAPNote.medicationNamePh')}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <input
                          type="text"
                          value={med.dosage}
                          onChange={(e) => updateMedication(index, 'dosage', e.target.value)}
                          placeholder={t('docSOAPNote.dosagePh')}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <select
                          value={med.route}
                          onChange={(e) => updateMedication(index, 'route', e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          {MEDICATION_ROUTES.map(route => (
                            <option key={route} value={route}>{t(`docSOAPNote.route_${ROUTE_KEYS[route]}`)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <input
                          type="text"
                          value={med.frequency}
                          onChange={(e) => updateMedication(index, 'frequency', e.target.value)}
                          placeholder={t('docSOAPNote.frequencyPh')}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <input
                          type="text"
                          value={med.duration}
                          onChange={(e) => updateMedication(index, 'duration', e.target.value)}
                          placeholder={t('docSOAPNote.durationPh')}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeMedication(index)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          {t('docSOAPNote.removeButton')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-procedures" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.proceduresLabel')}
                </label>
                <input
                  id="soap-procedures"
                  type="text"
                  value={procedures}
                  onChange={(e) => setProcedures(e.target.value)}
                  placeholder={t('docSOAPNote.proceduresPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-lab-orders" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.labOrdersLabel')}
                </label>
                <input
                  id="soap-lab-orders"
                  type="text"
                  value={labOrders}
                  onChange={(e) => setLabOrders(e.target.value)}
                  placeholder={t('docSOAPNote.labOrdersPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-imaging-orders" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.imagingOrdersLabel')}
                </label>
                <input                  id="soap-imaging-orders"                  type="text"
                  value={imagingOrders}
                  onChange={(e) => setImagingOrders(e.target.value)}
                  placeholder={t('docSOAPNote.imagingOrdersPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-referrals" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.referralsLabel')}
                </label>
                <input
                  id="soap-referrals"
                  type="text"
                  value={referrals}
                  onChange={(e) => setReferrals(e.target.value)}
                  placeholder={t('docSOAPNote.referralsPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="soap-patient-education" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.patientEducationLabel')}
              </label>
              <input                id="soap-patient-education"                type="text"
                value={patientEducation}
                onChange={(e) => setPatientEducation(e.target.value)}
                placeholder={t('docSOAPNote.patientEducationPh')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-follow-up" className="flex text-sm font-medium text-gray-700 mb-2 items-center gap-1">
                  <Calendar size={16} />
                  {t('docSOAPNote.followUpLabel')}
                </label>
                <input
                  id="soap-follow-up"
                  type="text"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder={t('docSOAPNote.followUpPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-activity-restrictions" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('docSOAPNote.activityRestrictionsLabel')}
                </label>
                <input
                  id="soap-activity-restrictions"
                  type="text"
                  value={activityRestrictions}
                  onChange={(e) => setActivityRestrictions(e.target.value)}
                  placeholder={t('docSOAPNote.activityRestrictionsPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="soap-return-precautions" className="block text-sm font-medium text-gray-700 mb-2">
                {t('docSOAPNote.returnPrecautionsLabel')}
              </label>
              <input                id="soap-return-precautions"                type="text"
                value={returnPrecautions}
                onChange={(e) => setReturnPrecautions(e.target.value)}
                placeholder={t('docSOAPNote.returnPrecautionsPh')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            disabled={submitting}
          >
            {t('docSOAPNote.cancelButton')}
          </button>
          <button
            type="submit"
            disabled={submitting || success}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                {t('docSOAPNote.creatingNote')}
              </>
            ) : success ? (
              <>
                <Check size={20} />
                {t('docSOAPNote.noteCreated')}
              </>
            ) : (
              t('docSOAPNote.createSoapNoteButton')
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default SOAPNotePage;
