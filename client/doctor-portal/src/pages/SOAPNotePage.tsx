import { useState, useEffect } from 'react';
import { useAuthStore } from '../store';
import { apiUrl, getApiErrorMessage } from '@medichain/shared';
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
    symptom_duration?: string;
    review_of_systems?: string;
    modifying_factors?: string;
    previous_treatments?: string;
  };
  objective: {
    general_appearance?: string;
    physical_exam: PhysicalExamFinding[];
    lab_results: string[];
    imaging_results: string[];
  };
  assessment: {
    primary_diagnosis?: DiagnosisEntry;
    secondary_diagnoses: DiagnosisEntry[];
    clinical_summary: string;
    severity?: string;
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

const ENCOUNTER_TYPES = [
  { value: 'initial', label: 'Initial Visit' },
  { value: 'follow-up', label: 'Follow-up Visit' },
  { value: 'consultation', label: 'Consultation' },
  { value: 'procedure', label: 'Procedure Note' },
];

const PHYSICAL_EXAM_SYSTEMS = [
  'General', 'HEENT', 'Cardiovascular', 'Respiratory', 'Gastrointestinal',
  'Genitourinary', 'Musculoskeletal', 'Neurological', 'Psychiatric', 'Skin'
];

const DIAGNOSIS_STATUSES: Array<'confirmed' | 'provisional' | 'rule-out'> = ['confirmed', 'provisional', 'rule-out'];

const MEDICATION_ROUTES = ['PO', 'IV', 'IM', 'SubQ', 'Topical', 'Inhalation', 'Rectal', 'Transdermal'];

interface PatientOption {
  patient_id: string;
  full_name: string;
  health_id?: string;
}

/**
 * SOAPNotePage - Create comprehensive SOAP (Subjective/Objective/Assessment/Plan) clinical notes
 */
function SOAPNotePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const patientIdFromUrl = searchParams.get('patientId');
  
  const { user, isAuthenticated } = useAuthStore();
  
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
      setError('Authentication required');
      return;
    }
    
    if (!selectedPatientId) {
      setError('Please select a patient');
      return;
    }
    
    if (!chiefComplaint.trim()) {
      setError('Chief complaint is required');
      return;
    }

    if (!clinicalSummary.trim()) {
      setError('Clinical summary in Assessment is required');
      return;
    }

    if (!treatmentPlan.trim()) {
      setError('Treatment plan is required');
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
          symptom_duration: symptomDuration.trim() || undefined,
          review_of_systems: reviewOfSystems.trim() || undefined,
          modifying_factors: modifyingFactors.trim() || undefined,
          previous_treatments: previousTreatments.trim() || undefined,
        },
        objective: {
          general_appearance: generalAppearance.trim() || undefined,
          physical_exam: physicalExams.filter(pe => pe.findings.trim()),
          lab_results: labResultsList,
          imaging_results: imagingResultsList,
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
        const errorData = await response.json();
        throw new Error(getApiErrorMessage(errorData, 'Failed to create SOAP note'));
      }

      setSuccess(true);
      
      setTimeout(() => {
        navigate(`/patients/${selectedPatientId}`);
      }, 1500);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create SOAP note');
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
          Back
        </button>
        <div className="flex items-center gap-3">
          <FileText size={32} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">SOAP Note</h1>
            <p className="text-gray-500 mt-1">
              Subjective, Objective, Assessment, Plan - Comprehensive Clinical Documentation
            </p>
          </div>
        </div>
      </div>

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <Check className="text-green-600" size={24} />
          <div>
            <p className="font-medium text-green-900">SOAP note created successfully!</p>
            <p className="text-sm text-green-700">Redirecting to patient record...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="text-red-600" size={24} />
          <div>
            <p className="font-medium text-red-900">Error</p>
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
              Existing SOAP Notes ({existingNotes.length})
            </h2>
            <button
              type="button"
              onClick={() => setShowNotesList(!showNotesList)}
              className="text-sm text-blue-600 hover:underline"
            >
              {showNotesList ? 'Hide' : 'Show'}
            </button>
          </div>
          {showNotesList && (
            <div className="divide-y">
              {existingNotes.map((note) => (
                <div key={note.note_id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{note.subjective?.chief_complaint || 'No chief complaint'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {note.encounter_type} &bull; {note.created_at ? new Date(note.created_at * 1000).toLocaleDateString() : 'N/A'}
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
            <h2 className="text-lg font-semibold text-gray-900">Patient & Encounter</h2>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="soap-patient-id" className="block text-sm font-medium text-gray-700 mb-2">
                Patient ID *
              </label>
              <select
                id="soap-patient-id"
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
                disabled={loadingPatients}
              >
                <option value="">{loadingPatients ? 'Loading patients...' : 'Select a patient...'}</option>
                {patients.map((patient) => (
                  <option key={patient.patient_id} value={patient.patient_id}>
                    {patient.full_name} ({patient.patient_id})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="soap-encounter-type" className="block text-sm font-medium text-gray-700 mb-2">
                Encounter Type *
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
            <h2 className="text-lg font-semibold text-gray-900">S - Subjective</h2>
            <span className="text-sm text-gray-500">(Patient's Description)</span>
          </div>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="soap-chief-complaint" className="block text-sm font-medium text-gray-700 mb-2">
                Chief Complaint *
              </label>
              <input
                id="soap-chief-complaint"
                type="text"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
                placeholder="e.g., Chest pain, Headache, Fever"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <label htmlFor="soap-hpi" className="block text-sm font-medium text-gray-700 mb-2">
                History of Present Illness (HPI)
              </label>
              <textarea
                id="soap-hpi"
                value={hpi}
                onChange={(e) => setHpi(e.target.value)}
                placeholder="Detailed narrative of symptoms, onset, duration, severity, progression..."
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-symptoms" className="block text-sm font-medium text-gray-700 mb-2">
                  Symptoms (comma-separated)
                </label>
                <input
                  id="soap-symptoms"
                  type="text"
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  placeholder="e.g., Cough, Fever, Fatigue"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-symptom-duration" className="block text-sm font-medium text-gray-700 mb-2">
                  Symptom Duration
                </label>
                <input
                  id="soap-symptom-duration"
                  type="text"
                  value={symptomDuration}
                  onChange={(e) => setSymptomDuration(e.target.value)}
                  placeholder="e.g., 3 days, 2 weeks"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="soap-review-of-systems" className="block text-sm font-medium text-gray-700 mb-2">
                Review of Systems (ROS)
              </label>
              <textarea                id="soap-review-of-systems"                value={reviewOfSystems}
                onChange={(e) => setReviewOfSystems(e.target.value)}
                placeholder="Constitutional, Respiratory, Cardiovascular, GI, GU, Neuro, etc."
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-modifying-factors" className="block text-sm font-medium text-gray-700 mb-2">
                  Modifying Factors
                </label>
                <input
                  id="soap-modifying-factors"
                  type="text"
                  value={modifyingFactors}
                  onChange={(e) => setModifyingFactors(e.target.value)}
                  placeholder="What makes it better/worse?"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-previous-treatments" className="block text-sm font-medium text-gray-700 mb-2">
                  Previous Treatments
                </label>
                <input
                  id="soap-previous-treatments"
                  type="text"
                  value={previousTreatments}
                  onChange={(e) => setPreviousTreatments(e.target.value)}
                  placeholder="Treatments tried before this visit"
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
            <h2 className="text-lg font-semibold text-gray-900">O - Objective</h2>
            <span className="text-sm text-gray-500">(Measurable Data)</span>
          </div>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="soap-general-appearance" className="block text-sm font-medium text-gray-700 mb-2">
                General Appearance
              </label>
              <input
                id="soap-general-appearance"
                type="text"
                value={generalAppearance}
                onChange={(e) => setGeneralAppearance(e.target.value)}
                placeholder="e.g., Alert, well-appearing, in no acute distress"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="soap-physical-exam-system" className="text-sm font-medium text-gray-700">
                  Physical Examination
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
                    <option value="">Add System...</option>
                    {PHYSICAL_EXAM_SYSTEMS.map(system => (
                      <option key={system} value={system}>{system}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              {physicalExams.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">
                  No physical exam findings added yet
                </p>
              ) : (
                <div className="space-y-3">
                  {physicalExams.map((exam, index) => (
                    <div key={index} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1 space-y-2">
                        <div className="font-medium text-sm text-gray-700">{exam.system}</div>
                        <input
                          type="text"
                          value={exam.findings}
                          onChange={(e) => updatePhysicalExam(index, 'findings', e.target.value)}
                          placeholder="Findings..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={exam.is_normal}
                            onChange={(e) => updatePhysicalExam(index, 'is_normal', e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-sm text-gray-600">Normal findings</span>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePhysicalExam(index)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-lab-results" className="block text-sm font-medium text-gray-700 mb-2">
                  Lab Results (comma-separated)
                </label>
                <input
                  id="soap-lab-results"
                  type="text"
                  value={labResults}
                  onChange={(e) => setLabResults(e.target.value)}
                  placeholder="e.g., WBC 12.5, Hgb 14.2"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-imaging-results" className="block text-sm font-medium text-gray-700 mb-2">
                  Imaging Results (comma-separated)
                </label>
                <input
                  id="soap-imaging-results"
                  type="text"
                  value={imagingResults}
                  onChange={(e) => setImagingResults(e.target.value)}
                  placeholder="e.g., Chest X-ray: clear"
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
            <h2 className="text-lg font-semibold text-gray-900">A - Assessment</h2>
            <span className="text-sm text-gray-500">(Clinical Impression)</span>
          </div>
          
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label htmlFor="soap-primary-diagnosis" className="block text-sm font-medium text-gray-700 mb-2">
                  Primary Diagnosis
                </label>
                <input
                  id="soap-primary-diagnosis"
                  type="text"
                  value={primaryDiagnosis}
                  onChange={(e) => setPrimaryDiagnosis(e.target.value)}
                  placeholder="e.g., Acute Bronchitis"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-icd10-code" className="block text-sm font-medium text-gray-700 mb-2">
                  ICD-10 Code
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
                  Diagnosis Status
                </label>
                <select                  id="soap-diagnosis-status"                  value={primaryStatus}
                  onChange={(e) => setPrimaryStatus(e.target.value as typeof primaryStatus)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  {DIAGNOSIS_STATUSES.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="soap-severity" className="block text-sm font-medium text-gray-700 mb-2">
                  Severity
                </label>
                <input
                  id="soap-severity"
                  type="text"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  placeholder="e.g., Mild, Moderate, Severe"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="soap-clinical-summary" className="block text-sm font-medium text-gray-700 mb-2">
                Clinical Summary *
              </label>
              <textarea                id="soap-clinical-summary"                value={clinicalSummary}
                onChange={(e) => setClinicalSummary(e.target.value)}
                placeholder="Summary of findings, differential diagnoses, clinical reasoning..."
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
            <h2 className="text-lg font-semibold text-gray-900">P - Plan</h2>
            <span className="text-sm text-gray-500">(Treatment & Follow-up)</span>
          </div>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="soap-treatment-plan" className="block text-sm font-medium text-gray-700 mb-2">
                Treatment Plan *
              </label>
              <textarea
                id="soap-treatment-plan"
                value={treatmentPlan}
                onChange={(e) => setTreatmentPlan(e.target.value)}
                placeholder="Overall treatment strategy and goals..."
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="soap-add-medication" className="text-sm font-medium text-gray-700">
                  Medications/Prescriptions
                </label>
                <button
                  id="soap-add-medication"
                  type="button"
                  onClick={addMedication}
                  className="text-sm px-3 py-1 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  + Add Medication
                </button>
              </div>
              
              {medications.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">
                  No medications prescribed yet
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
                          placeholder="Medication name"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <input
                          type="text"
                          value={med.dosage}
                          onChange={(e) => updateMedication(index, 'dosage', e.target.value)}
                          placeholder="Dosage (e.g., 500mg)"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <select
                          value={med.route}
                          onChange={(e) => updateMedication(index, 'route', e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          {MEDICATION_ROUTES.map(route => (
                            <option key={route} value={route}>{route}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <input
                          type="text"
                          value={med.frequency}
                          onChange={(e) => updateMedication(index, 'frequency', e.target.value)}
                          placeholder="Frequency (e.g., BID, TID)"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <input
                          type="text"
                          value={med.duration}
                          onChange={(e) => updateMedication(index, 'duration', e.target.value)}
                          placeholder="Duration (e.g., 7 days)"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeMedication(index)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Remove
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
                  Procedures (comma-separated)
                </label>
                <input
                  id="soap-procedures"
                  type="text"
                  value={procedures}
                  onChange={(e) => setProcedures(e.target.value)}
                  placeholder="e.g., Suture laceration, IV placement"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-lab-orders" className="block text-sm font-medium text-gray-700 mb-2">
                  Lab Orders (comma-separated)
                </label>
                <input
                  id="soap-lab-orders"
                  type="text"
                  value={labOrders}
                  onChange={(e) => setLabOrders(e.target.value)}
                  placeholder="e.g., CBC, CMP, UA"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-imaging-orders" className="block text-sm font-medium text-gray-700 mb-2">
                  Imaging Orders (comma-separated)
                </label>
                <input                  id="soap-imaging-orders"                  type="text"
                  value={imagingOrders}
                  onChange={(e) => setImagingOrders(e.target.value)}
                  placeholder="e.g., Chest X-ray, CT abdomen"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-referrals" className="block text-sm font-medium text-gray-700 mb-2">
                  Referrals (comma-separated)
                </label>
                <input
                  id="soap-referrals"
                  type="text"
                  value={referrals}
                  onChange={(e) => setReferrals(e.target.value)}
                  placeholder="e.g., Cardiology, Orthopedics"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="soap-patient-education" className="block text-sm font-medium text-gray-700 mb-2">
                Patient Education (comma-separated)
              </label>
              <input                id="soap-patient-education"                type="text"
                value={patientEducation}
                onChange={(e) => setPatientEducation(e.target.value)}
                placeholder="e.g., Rest, Fluids, Wound care instructions"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="soap-follow-up" className="flex text-sm font-medium text-gray-700 mb-2 items-center gap-1">
                  <Calendar size={16} />
                  Follow-up Instructions
                </label>
                <input
                  id="soap-follow-up"
                  type="text"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder="e.g., Return in 1 week, Call if worsening"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="soap-activity-restrictions" className="block text-sm font-medium text-gray-700 mb-2">
                  Activity Restrictions
                </label>
                <input
                  id="soap-activity-restrictions"
                  type="text"
                  value={activityRestrictions}
                  onChange={(e) => setActivityRestrictions(e.target.value)}
                  placeholder="e.g., No heavy lifting, Light duty work"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="soap-return-precautions" className="block text-sm font-medium text-gray-700 mb-2">
                Return Precautions (Red Flags - comma-separated)
              </label>
              <input                id="soap-return-precautions"                type="text"
                value={returnPrecautions}
                onChange={(e) => setReturnPrecautions(e.target.value)}
                placeholder="e.g., Fever >38.5°C, Worsening pain, Shortness of breath"
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
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || success}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Creating SOAP Note...
              </>
            ) : success ? (
              <>
                <Check size={20} />
                Note Created
              </>
            ) : (
              'Create SOAP Note'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default SOAPNotePage;
