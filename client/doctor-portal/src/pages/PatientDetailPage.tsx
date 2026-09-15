import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  apiUrl,
  getApiClient,
  getApiErrorMessage,
  getGuardiansForWard,
  revokeGuardian,
  verifyGuardian,
  useTranslation,
} from '@medichain/shared';
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

function PatientDetailPage() {
  const { t } = useTranslation();
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [patient, setPatient] = useState<PatientDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'records' | 'access'>('overview');

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
      await verifyGuardian({
        guardian_wallet: newGuardianWallet.trim(),
        ward_patient_id: patientId,
        relationship_type: newGuardianType,
        permissions: newGuardianPermissions,
      });
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
      await revokeGuardian(relationshipId);
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
                <span className="text-sm bg-emergency-100 text-critical-subtle-fg px-2 py-1 rounded font-medium">
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
            <button className="px-4 py-2 border border-border rounded-lg hover:bg-surface-sunken flex items-center gap-2">
              <Download size={18} />
              {t('docPatientDetail.export')}
            </button>
            <button className="px-4 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand flex items-center gap-2">
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
                  <span key={i} className="bg-emergency-100 text-critical-subtle-fg px-3 py-1 rounded-full text-sm">
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
            <div className="flex items-center gap-2 mb-4">
              <Clock className="text-content-muted" size={20} />
              <h3 className="font-semibold text-content">{t('docPatientDetail.accessHistory')}</h3>
            </div>
            <p className="text-content-muted text-center py-8">
              {t('docPatientDetail.accessLine1')}<br />
              {t('docPatientDetail.accessLine2')}
            </p>
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
    </div>
  );
}

export default PatientDetailPage;
