import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  getEmergencyCapsuleAccessLog,
  getPatientLatestVitals,
  getEmergencyCapsuleVersions,
  publishEmergencyCapsule,
  revokeEmergencyCapsule,
  apiUrl,
  getApiClient,
  getApiErrorMessage,
  updatePatient,
  getGuardiansForWard,
  revokeGuardian,
  verifyGuardian,
  useStepUp,
  StepUpDialog,
  useTranslation,
} from '@medichain/shared';
import type { EmergencyCapsuleAccess, EmergencyCapsuleVersion } from '@medichain/shared';
import type { GuardianRelationship } from '@medichain/shared';
import { useAuthStore } from '../store';
import { 
  ArrowLeft, 
  User, 
  Heart, 
  AlertTriangle, 
  Pill, 
  FileText, 
  Phone,
  Edit,
  Download,
  Activity,
  Clock
} from 'lucide-react';

interface PatientDetails {
  patientId: string;
  fullName: string;
  dateOfBirth: string;
  nationalHealthId: string;
  bloodType: string;
  allergies: string[];
  currentMedications: string[];
  chronicConditions: string[];
  emergencyContacts: Array<{
    name: string;
    phone: string;
    relationship: string;
  }>;
  organDonor: boolean;
  dnrStatus: boolean;
  lastUpdated: string;
  registeredBy: string;
}

interface ClinicalDetailsForm {
  allergies: string;
  currentMedications: string;
  chronicConditions: string;
  organDonor: boolean;
}

/** Turn one clinical item per line into the explicit list the update API accepts. */
function clinicalItems(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Create a portable copy of the clinical summary currently visible to the clinician. */
export function downloadPatientSummary(patient: PatientDetails): void {
  const body = JSON.stringify({
    exported_at: new Date().toISOString(),
    patient_id: patient.patientId,
    full_name: patient.fullName,
    date_of_birth: patient.dateOfBirth,
    national_health_id: patient.nationalHealthId,
    blood_type: patient.bloodType,
    allergies: patient.allergies,
    current_medications: patient.currentMedications,
    chronic_conditions: patient.chronicConditions,
    emergency_contacts: patient.emergencyContacts,
    organ_donor: patient.organDonor,
    dnr_status: patient.dnrStatus,
    record_last_updated: patient.lastUpdated,
    registered_by: patient.registeredBy,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `medichain-patient-summary-${patient.patientId}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function PatientDetailPage() {
  const { t } = useTranslation();
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [patient, setPatient] = useState<PatientDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'records' | 'access'>('overview');
  const [editingClinicalDetails, setEditingClinicalDetails] = useState(false);
  const [savingClinicalDetails, setSavingClinicalDetails] = useState(false);
  const [clinicalDetailsError, setClinicalDetailsError] = useState<string | null>(null);
  const [clinicalDetailsForm, setClinicalDetailsForm] = useState<ClinicalDetailsForm>({
    allergies: '',
    currentMedications: '',
    chronicConditions: '',
    organDonor: false,
  });

  const openClinicalDetailsEditor = () => {
    if (!patient) return;
    setClinicalDetailsForm({
      allergies: patient.allergies.join('\n'),
      currentMedications: patient.currentMedications.join('\n'),
      chronicConditions: patient.chronicConditions.join('\n'),
      organDonor: patient.organDonor,
    });
    setClinicalDetailsError(null);
    setEditingClinicalDetails(true);
  };

  const saveClinicalDetails = async () => {
    if (!patient) return;
    const updates = {
      allergies: clinicalItems(clinicalDetailsForm.allergies),
      current_medications: clinicalItems(clinicalDetailsForm.currentMedications),
      chronic_conditions: clinicalItems(clinicalDetailsForm.chronicConditions),
      organ_donor: clinicalDetailsForm.organDonor,
    };
    setSavingClinicalDetails(true);
    setClinicalDetailsError(null);
    try {
      await updatePatient(patient.patientId, updates);
      setPatient({
        ...patient,
        allergies: updates.allergies,
        currentMedications: updates.current_medications,
        chronicConditions: updates.chronic_conditions,
        organDonor: updates.organ_donor,
        lastUpdated: new Date().toISOString(),
      });
      setEditingClinicalDetails(false);
    } catch (saveError) {
      setClinicalDetailsError(
        saveError instanceof Error ? saveError.message : t('docPatientDetail.editSaveFailed')
      );
    } finally {
      setSavingClinicalDetails(false);
    }
  };

  // --- Who may act for this patient ------------------------------------------
  //
  // Three guardianship endpoints existed -- verify, amend permissions, revoke
  // -- and all three WRITE. Nothing could read: `get_by_ward` is documented in
  // the repository trait as backing exactly this view and had no HTTP route, so
  // delegated authority over a minor's records could be created and then never
  // shown. `GET /api/guardians/ward/{id}` is new; so is `/api/guardians/mine`.
  //
  // Relationships are listed whether active or not. A revoked or expired
  // guardianship is part of the answer to "who may act for this patient" --
  // leaving it out would hide that someone once could.
  const [guardians, setGuardians] = useState<GuardianRelationship[]>([]);
  const [guardiansLoaded, setGuardiansLoaded] = useState(false);
  const [guardianError, setGuardianError] = useState<string | null>(null);
  const [guardianBusy, setGuardianBusy] = useState(false);

  // --- Last recorded observations --------------------------------------------
  //
  // `GET /api/clinical/patient/{id}/vitals/latest` had no caller. The vitals
  // page derives its own "latest" from the flowsheet it loads anyway, so this
  // endpoint's real consumer is a screen that wants the last readings WITHOUT
  // pulling a whole flowsheet -- which is this one. Opening a patient record
  // showed a blood type and no observations at all.
  const [latestVitals, setLatestVitals] = useState<Record<string, unknown> | null>(null);
  const [vitalsLoaded, setVitalsLoaded] = useState(false);
  // "No vitals have been recorded" and "the reading could not be fetched" are
  // different statements, and only one of them is safe to act on.
  const [vitalsUnknown, setVitalsUnknown] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    getPatientLatestVitals(patientId)
      .then((body) => {
        if (cancelled) return;
        // `reading`, not `vitals`, and the names inside it are the
        // repository's own -- checked against a live response, because the
        // first cut of this read `vitals` / `blood_pressure_systolic` and
        // would have rendered a dash in every tile while looking fine.
        const reading = (body as { reading?: Record<string, unknown> }).reading ?? null;
        setLatestVitals(reading && Object.keys(reading).length > 0 ? reading : null);
        setVitalsUnknown(false);
      })
      .catch(() => {
        if (!cancelled) setVitalsUnknown(true);
      })
      .finally(() => {
        if (!cancelled) setVitalsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  /** A reading that was never taken is absent, never zero. */
  const vitalOrDash = (key: string, suffix = ''): string => {
    const value = latestVitals?.[key];
    if (value === null || value === undefined || value === '') return '—';
    return `${value}${suffix}`;
  };

  // Recording and ending a guardianship both run through
  // `require_privileged_assurance`, which outside demo mode refuses a session
  // that is not freshly MFA-verified. Without this the page showed the server's
  // "Call /api/auth/mfa/challenge" and there was nothing anyone could do with
  // it -- which is how delegated authority over a minor's records became
  // unmanageable in production while working perfectly in the demo.
  const stepUp = useStepUp();
  const [newGuardianWallet, setNewGuardianWallet] = useState('');
  const [newGuardianType, setNewGuardianType] = useState('parent_or_guardian');
  const [newGuardianPermissions, setNewGuardianPermissions] = useState<string[]>([]);

  const loadGuardians = useCallback(async () => {
    if (!patientId) return;
    try {
      const body = await getGuardiansForWard(patientId);
      setGuardians(body.relationships ?? []);
      setGuardianError(null);
    } catch (err) {
      // "Nobody may act for this patient" and "the list could not be loaded"
      // are opposite answers; an empty list must not stand in for a failure.
      setGuardianError(getApiErrorMessage(err, t('docPatientDetail.guardiansLoadFailed')));
    } finally {
      setGuardiansLoaded(true);
    }
  }, [patientId, t]);

  useEffect(() => {
    if (activeTab === 'access') void loadGuardians();
  }, [activeTab, loadGuardians]);

  // --- The emergency capsule -------------------------------------------------
  //
  // The capsule is the three-second NFC payload: blood type, allergies,
  // organ-donor status, DNR. Four endpoints implement the POPIA requirement
  // that it be versioned, revocable and access-logged, and not one had a client
  // function -- so a capsule could never be published from the product, and the
  // values a paramedic reads at a bedside were whatever a script last wrote.
  //
  // `GET /api/patients/{id}/emergency-capsule` is new. `current()` and
  // `history()` were on the repository from the start with no route, which left
  // revoke unreachable (it takes a version number nobody could read) and
  // publishing unverifiable.
  const [capsuleVersions, setCapsuleVersions] = useState<EmergencyCapsuleVersion[]>([]);
  const [capsuleCurrent, setCapsuleCurrent] = useState<EmergencyCapsuleVersion | null>(null);
  const [capsuleLoaded, setCapsuleLoaded] = useState(false);
  const [capsuleUnknown, setCapsuleUnknown] = useState(false);
  const [capsuleError, setCapsuleError] = useState<string | null>(null);
  const [capsuleNotice, setCapsuleNotice] = useState<string | null>(null);
  const [capsuleBusy, setCapsuleBusy] = useState(false);

  const [capsuleAccesses, setCapsuleAccesses] = useState<EmergencyCapsuleAccess[]>([]);
  const [accessLoaded, setAccessLoaded] = useState(false);
  const [accessUnknown, setAccessUnknown] = useState(false);

  const loadCapsule = useCallback(async () => {
    if (!patientId) return;
    try {
      const body = await getEmergencyCapsuleVersions(patientId);
      setCapsuleVersions(body.versions ?? []);
      setCapsuleCurrent(body.current ?? null);
      setCapsuleUnknown(false);
    } catch (err) {
      // "This patient has no emergency capsule" and "the capsule could not be
      // read" are opposite answers, and the first one tells a clinician the
      // card is blank when it may not be.
      setCapsuleUnknown(true);
      setCapsuleError(getApiErrorMessage(err, t('docPatientDetail.capsuleLoadFailed')));
    } finally {
      setCapsuleLoaded(true);
    }
  }, [patientId, t]);

  const loadCapsuleAccesses = useCallback(async () => {
    if (!patientId) return;
    try {
      const body = await getEmergencyCapsuleAccessLog(patientId);
      setCapsuleAccesses(body.accesses ?? []);
      setAccessUnknown(false);
    } catch (err) {
      setAccessUnknown(true);
      setCapsuleError(getApiErrorMessage(err, t('docPatientDetail.accessLoadFailed')));
    } finally {
      setAccessLoaded(true);
    }
  }, [patientId, t]);

  useEffect(() => {
    if (activeTab === 'access') {
      void loadCapsule();
      void loadCapsuleAccesses();
    }
  }, [activeTab, loadCapsule, loadCapsuleAccesses]);

  const publishCapsule = async () => {
    if (!patientId) return;
    setCapsuleError(null);
    setCapsuleNotice(null);
    setCapsuleBusy(true);
    try {
      const body = await publishEmergencyCapsule(patientId);
      // `anchoring` rather than the hash: a transaction hash with
      // `chain_finalized: false` is a placeholder, and reporting it as an
      // anchoring would claim something that did not happen.
      setCapsuleNotice(
        t('docPatientDetail.capsulePublished', {
          version: body.version,
          anchoring: body.anchoring,
        })
      );
      await loadCapsule();
    } catch (err) {
      setCapsuleError(getApiErrorMessage(err, t('docPatientDetail.capsulePublishFailed')));
    } finally {
      setCapsuleBusy(false);
    }
  };

  const revokeCapsuleVersion = async (version: number) => {
    if (!patientId) return;
    setCapsuleError(null);
    setCapsuleNotice(null);
    setCapsuleBusy(true);
    try {
      await revokeEmergencyCapsule(patientId, version, 'Revoked from the patient record');
      setCapsuleNotice(t('docPatientDetail.capsuleRevoked', { version }));
      await loadCapsule();
    } catch (err) {
      setCapsuleError(getApiErrorMessage(err, t('docPatientDetail.capsuleRevokeFailed')));
    } finally {
      setCapsuleBusy(false);
    }
  };

  const togglePermission = (permission: string) => {
    setNewGuardianPermissions((current) =>
      current.includes(permission)
        ? current.filter((p) => p !== permission)
        : [...current, permission]
    );
  };

  const recordGuardian = async () => {
    if (!patientId) return;
    setGuardianError(null);
    if (!newGuardianWallet.trim()) {
      setGuardianError(t('docPatientDetail.guardianWalletRequired'));
      return;
    }
    // Authority with no permissions is not authority. An empty set would record
    // a relationship that permits nothing while reading as though it does.
    if (newGuardianPermissions.length === 0) {
      setGuardianError(t('docPatientDetail.guardianPermissionsRequired'));
      return;
    }
    try {
      setGuardianBusy(true);
      await stepUp.run(() =>
        verifyGuardian({
          guardian_wallet: newGuardianWallet.trim(),
          ward_patient_id: patientId,
          relationship_type: newGuardianType,
          permissions: newGuardianPermissions,
        })
      );
      setNewGuardianWallet('');
      setNewGuardianPermissions([]);
      await loadGuardians();
    } catch (err) {
      setGuardianError(getApiErrorMessage(err, t('docPatientDetail.guardianRecordFailed')));
    } finally {
      setGuardianBusy(false);
    }
  };

  const endGuardianship = async (relationshipId: string) => {
    setGuardianError(null);
    try {
      setGuardianBusy(true);
      await stepUp.run(() => revokeGuardian(relationshipId));
      await loadGuardians();
    } catch (err) {
      setGuardianError(getApiErrorMessage(err, t('docPatientDetail.guardianRevokeFailed')));
    } finally {
      setGuardianBusy(false);
    }
  };

  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!user || !patientId) return;
    
    const fetchPatient = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(apiUrl(`/api/patients/${patientId}`), {
          headers: {
            ...getApiClient().getSessionHeaders(user.walletAddress),
            'X-Provider-Role': user.role,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            setPatient(null);
          } else {
            const errorData = await response.json().catch(() => ({}));
            setError(getApiErrorMessage(errorData, t('docPatientDetail.errorStatus', { status: response.status })));
          }
          setLoading(false);
          return;
        }

        const data = await response.json();
        
        // Map API response to PatientDetails interface
        setPatient({
          patientId: data.patient_id,
          fullName: data.full_name,
          dateOfBirth: data.date_of_birth,
          nationalHealthId: data.national_id || data.patient_id,
          bloodType: data.emergency_info?.blood_type || t('docPatientDetail.unknown'),
          allergies: data.emergency_info?.allergies?.map((a: { name: string }) => a.name) || [],
          currentMedications: data.emergency_info?.current_medications || [],
          chronicConditions: data.emergency_info?.chronic_conditions || [],
          emergencyContacts: data.emergency_info?.emergency_contacts || [],
          organDonor: data.emergency_info?.organ_donor || false,
          dnrStatus: data.emergency_info?.dnr_status || false,
          lastUpdated: data.last_updated || new Date().toISOString(),
          registeredBy: data.primary_doctor?.provider_id || t('docPatientDetail.unknown'),
        });
      } catch (err) {
        console.error('Failed to fetch patient:', err);
        setError(t('docPatientDetail.failConnect'));
      }
      setLoading(false);
    };

    fetchPatient();
  }, [patientId, user, t]);

  if (loading) {
    // role="status" + a text label: a bare spinner announces nothing to a
    // screen reader, so a clinician using assistive tech got silence while the
    // record loaded. The label is visually hidden; the spinner stays the visual
    // affordance.
    return (
      <div
        className="p-8 flex items-center justify-center min-h-[400px]"
        role="status"
        aria-live="polite"
      >
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-brand border-t-transparent"></div>
        <span className="sr-only">Loading patient information…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <AlertTriangle className="mx-auto mb-4 text-red-400" size={64} />
          <h2 className="text-xl font-semibold text-content-secondary">{t('docPatientDetail.errorLoading')}</h2>
          <p className="text-content-muted mt-2">{error}</p>
          <Link to="/patients" className="mt-4 inline-block text-brand hover:underline">
            {t('docPatientDetail.backToSearch')}
          </Link>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <User className="mx-auto mb-4 text-gray-300" size={64} />
          <h2 className="text-xl font-semibold text-content-secondary">{t('docPatientDetail.notFound')}</h2>
          <p className="text-content-muted mt-2">{t('docPatientDetail.notExist', { id: patientId ?? '' })}</p>
          <Link to="/patients" className="mt-4 inline-block text-brand hover:underline">
            {t('docPatientDetail.backToSearch')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Back Button */}
      <Link to="/patients" className="inline-flex items-center gap-2 text-content-muted hover:text-content-secondary mb-6">
        <ArrowLeft size={20} />
        {t('docPatientDetail.backToPatients')}
      </Link>

      {/* Patient Header */}
      <div className="bg-surface rounded-xl shadow p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-brand-subtle rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold text-brand">
                {patient.fullName.split(' ').map(n => n[0]).join('')}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-content">{patient.fullName}</h1>
              <p className="text-content-muted">{patient.nationalHealthId}</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-sm bg-surface-sunken px-2 py-1 rounded">
                  {t('docPatientDetail.dob', { date: patient.dateOfBirth })}
                </span>
                <span className="text-sm bg-critical-subtle text-critical-subtle-fg px-2 py-1 rounded font-medium">
                  {t('docPatientDetail.blood', { type: patient.bloodType })}
                </span>
                {patient.dnrStatus && (
                  <span className="text-sm bg-critical-subtle text-critical-subtle-fg px-2 py-1 rounded font-medium">
                    {t('docPatientDetail.dnr')}
                  </span>
                )}
                {patient.organDonor && (
                  <span className="text-sm bg-ok-subtle text-ok-subtle-fg px-2 py-1 rounded">
                    {t('docPatientDetail.organDonor')}
                  </span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => patient && downloadPatientSummary(patient)}
              className="px-4 py-2 border border-border rounded-lg hover:bg-surface-sunken flex items-center gap-2"
            >
              <Download size={18} />
              {t('docPatientDetail.export')}
            </button>
            <button
              type="button"
              onClick={openClinicalDetailsEditor}
              className="px-4 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand flex items-center gap-2"
            >
              <Edit size={18} />
              {t('docPatientDetail.edit')}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-sunken p-1 rounded-lg w-fit">
        {(['overview', 'records', 'access'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md transition-colors ${
              activeTab === tab
                ? 'bg-surface shadow text-content'
                : 'text-content-muted hover:text-content-secondary'
            }`}
          >
            {tab === 'access' ? t('docPatientDetail.tabAccess') : tab === 'records' ? t('docPatientDetail.tabRecords') : t('docPatientDetail.tabOverview')}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Allergies */}
          <div className="bg-surface rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="text-critical-subtle-fg" size={20} />
              <h3 className="font-semibold text-content">{t('docPatientDetail.allergies')}</h3>
            </div>
            {patient.allergies.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {patient.allergies.map((allergy, i) => (
                  <span key={i} className="bg-critical-subtle text-critical-subtle-fg px-3 py-1 rounded-full text-sm">
                    {allergy}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-content-muted">{t('docPatientDetail.noAllergies')}</p>
            )}
          </div>

          {/* Medications */}
          <div className="bg-surface rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Pill className="text-brand" size={20} />
              <h3 className="font-semibold text-content">{t('docPatientDetail.currentMeds')}</h3>
            </div>
            {patient.currentMedications.length > 0 ? (
              <ul className="space-y-2">
                {patient.currentMedications.map((med, i) => (
                  <li key={i} className="text-content-secondary flex items-start gap-2">
                    <span className="w-2 h-2 bg-primary-400 rounded-full mt-2"></span>
                    {med}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-content-muted">{t('docPatientDetail.noMeds')}</p>
            )}
          </div>

          {/* Chronic Conditions */}
          <div className="bg-surface rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Heart className="text-red-500" size={20} />
              <h3 className="font-semibold text-content">{t('docPatientDetail.chronicConditions')}</h3>
            </div>
            {patient.chronicConditions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {patient.chronicConditions.map((condition, i) => (
                  <span key={i} className="bg-caution-subtle text-caution-subtle-fg px-3 py-1 rounded-full text-sm">
                    {condition}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-content-muted">{t('docPatientDetail.noConditions')}</p>
            )}
          </div>

          {/* Last recorded observations */}
          <div className="bg-surface rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="text-content-muted" size={20} />
              <h3 className="font-semibold text-content">{t('docPatientDetail.latestVitalsHeading')}</h3>
            </div>
            {!vitalsLoaded ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.latestVitalsLoading')}</p>
            ) : vitalsUnknown ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.latestVitalsUnknown')}</p>
            ) : !latestVitals ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.latestVitalsNone')}</p>
            ) : (
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4" data-testid="latest-vitals">
                <div>
                  <dt className="text-xs text-content-muted">{t('docPatientDetail.vitalHeartRate')}</dt>
                  <dd className="text-content font-semibold">{vitalOrDash('heart_rate', ' bpm')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-content-muted">{t('docPatientDetail.vitalBloodPressure')}</dt>
                  <dd className="text-content font-semibold">
                    {latestVitals.systolic_bp && latestVitals.diastolic_bp
                      ? `${latestVitals.systolic_bp}/${latestVitals.diastolic_bp}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-content-muted">{t('docPatientDetail.vitalTemperature')}</dt>
                  <dd className="text-content font-semibold">{vitalOrDash('temperature_celsius', ' °C')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-content-muted">{t('docPatientDetail.vitalSpO2')}</dt>
                  <dd className="text-content font-semibold">{vitalOrDash('oxygen_saturation', '%')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-content-muted">{t('docPatientDetail.vitalRespiratory')}</dt>
                  <dd className="text-content font-semibold">{vitalOrDash('respiratory_rate')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-content-muted">{t('docPatientDetail.vitalRecorded')}</dt>
                  <dd className="text-content-secondary text-sm">
                    {/* Unix SECONDS, not milliseconds. Passing it straight to
                        `new Date` dated every reading to January 1970, which is
                        wrong in a way a clinician would notice and distrust. */}
                    {typeof latestVitals.timestamp === 'number'
                      ? new Date(latestVitals.timestamp * 1000).toLocaleString()
                      : '—'}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {/* Emergency Contacts */}
          <div className="bg-surface rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Phone className="text-success-600" size={20} />
              <h3 className="font-semibold text-content">{t('docPatientDetail.emergencyContacts')}</h3>
            </div>
            {patient.emergencyContacts.map((contact, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
                <div>
                  <p className="font-medium text-content">{contact.name}</p>
                  <p className="text-sm text-content-muted">{contact.relationship}</p>
                </div>
                <a href={`tel:${contact.phone}`} className="text-brand hover:underline">
                  {contact.phone}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'records' && (
        <div className="bg-surface rounded-xl shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="text-content-muted" size={20} />
            <h3 className="font-semibold text-content">{t('docPatientDetail.medicalRecords')}</h3>
          </div>
          <p className="text-content-muted text-center py-8">
            {t('docPatientDetail.recordsLine1')}<br />
            {t('docPatientDetail.recordsLine2')}
          </p>
        </div>
      )}

      {activeTab === 'access' && (
        <div className="space-y-6">
          <div className="bg-surface rounded-xl shadow p-6">
            <h3 className="font-semibold text-content mb-1">
              {t('docPatientDetail.capsuleHeading')}
            </h3>
            <p className="text-sm text-content-muted mb-4">
              {t('docPatientDetail.capsuleSubtitle')}
            </p>

            {capsuleError && (
              <div role="alert" className="mb-4 bg-critical-subtle border border-critical rounded-lg p-3">
                <p className="text-sm text-critical-subtle-fg">{capsuleError}</p>
              </div>
            )}
            {capsuleNotice && (
              <div role="status" className="mb-4 bg-ok-subtle border border-ok rounded-lg p-3">
                <p className="text-sm text-ok-subtle-fg">{capsuleNotice}</p>
              </div>
            )}

            {!capsuleLoaded ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.capsuleLoading')}</p>
            ) : capsuleUnknown ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.capsuleUnknown')}</p>
            ) : (
              <>
                <p className="text-sm text-content mb-4">
                  {capsuleCurrent
                    ? t('docPatientDetail.capsuleCurrent', {
                        version: capsuleCurrent.version,
                        date: new Date(capsuleCurrent.created_at).toLocaleDateString(),
                      })
                    : t('docPatientDetail.capsuleNone')}
                </p>

                <button
                  type="button"
                  onClick={() => void publishCapsule()}
                  disabled={capsuleBusy}
                  className="mb-4 px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:opacity-60 min-h-[44px]"
                >
                  {capsuleBusy
                    ? t('docPatientDetail.capsulePublishing')
                    : t('docPatientDetail.capsulePublish')}
                </button>

                {capsuleVersions.length > 0 && (
                  <ul className="space-y-2" data-testid="capsule-version-list">
                    {capsuleVersions.map((entry) => (
                      <li
                        key={entry.version}
                        className="flex items-start justify-between gap-3 border border-border rounded-lg p-3"
                      >
                        <div>
                          <p className="text-sm text-content">
                            {t('docPatientDetail.capsuleVersionLine', {
                              version: entry.version,
                              date: new Date(entry.created_at).toLocaleString(),
                            })}
                          </p>
                          <p className="text-xs text-content-muted break-all">
                            {/* A hash without `chain_finalized` is a
                                placeholder, not an anchoring. */}
                            {entry.chain_finalized && entry.chain_tx_hash
                              ? t('docPatientDetail.capsuleAnchored', { hash: entry.chain_tx_hash })
                              : t('docPatientDetail.capsuleNotAnchored')}
                          </p>
                          {entry.revoked_at && (
                            <p className="text-xs text-content-muted mt-1">
                              {t('docPatientDetail.capsuleRevokedOn', {
                                date: new Date(entry.revoked_at).toLocaleDateString(),
                              })}
                            </p>
                          )}
                        </div>
                        {!entry.revoked_at && (
                          <button
                            type="button"
                            onClick={() => void revokeCapsuleVersion(entry.version)}
                            disabled={capsuleBusy}
                            className="px-3 py-1 text-xs rounded-lg border border-critical text-critical-subtle-fg disabled:opacity-60 min-h-[28px] whitespace-nowrap"
                          >
                            {t('docPatientDetail.capsuleRevoke')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="bg-surface rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="text-content-muted" size={20} />
              <h3 className="font-semibold text-content">{t('docPatientDetail.accessHistory')}</h3>
            </div>
            {/* This used to be two sentences promising an audit trail, with no
                trail behind them: "View complete audit trail of who accessed
                this patient's records." The endpoint that answers it existed
                and had no caller. */}
            {!accessLoaded ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.accessLoading')}</p>
            ) : accessUnknown ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.accessUnknown')}</p>
            ) : capsuleAccesses.length === 0 ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.accessNone')}</p>
            ) : (
              <ul className="space-y-2" data-testid="capsule-access-list">
                {capsuleAccesses.map((entry) => (
                  <li key={entry.id} className="border border-border rounded-lg p-3">
                    <p className="text-sm text-content break-all">{entry.accessed_by}</p>
                    <p className="text-xs text-content-muted">
                      {new Date(entry.accessed_at).toLocaleString()} ·{' '}
                      {entry.reason_text || entry.reason_code}
                    </p>
                    {/* Which fields were actually revealed, not which were
                        requested -- that difference is the whole point of
                        logging a break-glass read. */}
                    {entry.fields_revealed.length > 0 && (
                      <p className="text-xs text-content-muted mt-1">
                        {t('docPatientDetail.accessFields', {
                          fields: entry.fields_revealed.join(', '),
                        })}
                      </p>
                    )}
                    {!entry.commitment_verified && (
                      <p className="text-xs text-critical-subtle-fg mt-1">
                        {t('docPatientDetail.accessCommitmentUnverified')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-surface rounded-xl shadow p-6">
            <h3 className="font-semibold text-content mb-1">{t('docPatientDetail.guardiansHeading')}</h3>
            <p className="text-sm text-content-muted mb-4">{t('docPatientDetail.guardiansSubtitle')}</p>

            {guardianError && (
              <div role="alert" className="mb-4 bg-critical-subtle border border-critical rounded-lg p-3">
                <p className="text-sm text-critical-subtle-fg">{guardianError}</p>
              </div>
            )}

            {!guardiansLoaded ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.guardiansLoading')}</p>
            ) : guardians.length === 0 ? (
              <p className="text-sm text-content-muted">{t('docPatientDetail.guardiansNone')}</p>
            ) : (
              <ul className="space-y-2 mb-6" data-testid="guardian-list">
                {guardians.map((relationship) => (
                  <li
                    key={relationship.id}
                    className="flex items-start justify-between gap-3 border border-border rounded-lg p-3"
                  >
                    <div>
                      <p className="font-medium text-content break-all">{relationship.guardian_wallet}</p>
                      <p className="text-sm text-content-muted">
                        {relationship.relationship_type} — {relationship.permissions.join(', ')}
                      </p>
                      {/* An ended relationship still shows, and says so. */}
                      {!relationship.active && (
                        <p className="text-xs text-content-muted mt-1">
                          {relationship.revoked_at
                            ? t('docPatientDetail.guardianRevoked')
                            : t('docPatientDetail.guardianInactive')}
                        </p>
                      )}
                    </div>
                    {relationship.active && (
                      <button
                        type="button"
                        onClick={() => void endGuardianship(relationship.id)}
                        disabled={guardianBusy}
                        className="px-3 py-1 text-xs rounded-lg border border-critical text-critical-subtle-fg disabled:opacity-60 min-h-[24px] whitespace-nowrap"
                      >
                        {t('docPatientDetail.guardianEnd')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-border pt-4 space-y-3">
              <h4 className="font-medium text-content">{t('docPatientDetail.guardianAddHeading')}</h4>
              <div>
                <label htmlFor="guardian-wallet" className="block text-sm font-medium mb-1">
                  {t('docPatientDetail.guardianWalletLabel')}
                </label>
                <input
                  id="guardian-wallet"
                  type="text"
                  value={newGuardianWallet}
                  onChange={(e) => setNewGuardianWallet(e.target.value)}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label htmlFor="guardian-type" className="block text-sm font-medium mb-1">
                  {t('docPatientDetail.guardianTypeLabel')}
                </label>
                <select
                  id="guardian-type"
                  value={newGuardianType}
                  onChange={(e) => setNewGuardianType(e.target.value)}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                >
                  <option value="parent_or_guardian">{t('docPatientDetail.guardianTypeParent')}</option>
                  <option value="legal_proxy">{t('docPatientDetail.guardianTypeProxy')}</option>
                  <option value="power_of_attorney">{t('docPatientDetail.guardianTypePoa')}</option>
                </select>
              </div>
              <fieldset>
                <legend className="block text-sm font-medium mb-1">
                  {t('docPatientDetail.guardianPermissionsLabel')}
                </legend>
                {/* Consenting to treatment and consenting to data processing are
                    separate decisions in South African law (Children's Act §129
                    vs POPIA §35) and the server keeps them apart, so this offers
                    them separately rather than as one "give consent" box. */}
                <div className="flex flex-wrap gap-3">
                  {[
                    ['view_records', t('docPatientDetail.permViewRecords')],
                    ['book_appointments', t('docPatientDetail.permBookAppointments')],
                    ['consent_to_treatment', t('docPatientDetail.permConsentTreatment')],
                    ['consent_to_data_processing', t('docPatientDetail.permConsentData')],
                    ['upload_vaccinations', t('docPatientDetail.permUploadVaccinations')],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm min-h-[24px]">
                      <input
                        type="checkbox"
                        checked={newGuardianPermissions.includes(value)}
                        onChange={() => togglePermission(value)}
                        className="w-4 h-4"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                type="button"
                onClick={recordGuardian}
                disabled={guardianBusy}
                className="px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:opacity-60 min-h-[24px]"
              >
                {guardianBusy ? t('docPatientDetail.guardianWorking') : t('docPatientDetail.guardianRecord')}
              </button>
            </div>
          </div>
        </div>
      )}

      <StepUpDialog state={stepUp} />

      {editingClinicalDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
          <section
            aria-modal="true"
            aria-labelledby="patient-clinical-details-title"
            className="w-full max-w-2xl rounded-xl bg-surface p-6 shadow-xl"
            role="dialog"
          >
            <h2 id="patient-clinical-details-title" className="text-xl font-semibold text-content">
              {t('docPatientDetail.editClinicalTitle')}
            </h2>
            <p className="mt-1 text-sm text-content-muted">{t('docPatientDetail.editClinicalSubtitle')}</p>
            <div className="mt-5 space-y-4">
              {([
                ['allergies', 'editAllergies'],
                ['currentMedications', 'editMedications'],
                ['chronicConditions', 'editConditions'],
              ] as const).map(([field, label]) => (
                <label key={field} className="block text-sm font-medium text-content">
                  {t(`docPatientDetail.${label}`)}
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-lg border border-border bg-surface px-3 py-2 font-normal text-content"
                    value={clinicalDetailsForm[field]}
                    onChange={(event) => setClinicalDetailsForm((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))}
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm font-medium text-content">
                <input
                  type="checkbox"
                  checked={clinicalDetailsForm.organDonor}
                  onChange={(event) => setClinicalDetailsForm((current) => ({
                    ...current,
                    organDonor: event.target.checked,
                  }))}
                />
                {t('docPatientDetail.editOrganDonor')}
              </label>
            </div>
            <p className="mt-4 text-sm text-content-muted">{t('docPatientDetail.editDnrNotice')}</p>
            {clinicalDetailsError && <p className="mt-4 text-sm text-critical" role="alert">{clinicalDetailsError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={savingClinicalDetails}
                onClick={() => setEditingClinicalDetails(false)}
                className="rounded-lg border border-border px-4 py-2 text-content hover:bg-surface-sunken disabled:opacity-50"
              >
                {t('docPatientDetail.editCancel')}
              </button>
              <button
                type="button"
                disabled={savingClinicalDetails}
                onClick={saveClinicalDetails}
                className="rounded-lg bg-brand px-4 py-2 text-brand-fg hover:bg-brand disabled:opacity-50"
              >
                {savingClinicalDetails ? t('docPatientDetail.editSaving') : t('docPatientDetail.editSave')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default PatientDetailPage;
