import { useState, useEffect } from 'react';
import {
  apiUrl,
  isValidPhoneNumber,
  useTranslation,
  updateDemographics,
  replaceEmergencyContacts,
} from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  User,
  Heart,
  AlertTriangle,
  Pill,
  Phone,
  Calendar,
  Droplets,
  Activity,
  Shield,
  CheckCircle,
  Plus,
  X,
  Save,
  Info,
  MapPin,
  CreditCard,
  Pencil,
  Trash2,
  Globe,
} from 'lucide-react';

interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
  canMakeMedicalDecisions?: boolean;
}

interface PatientAddress {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

interface PatientInsurance {
  provider: string;
  policyNumber: string;
  groupNumber: string;
  validFrom: string;
  validTo: string;
  coverageType: 'Public' | 'Private' | 'Employer' | 'NHIS' | 'Community' | 'None';
  isActive: boolean;
}

const EMPTY_ADDRESS: PatientAddress = {
  street: '',
  city: '',
  state: '',
  country: '',
  postalCode: '',
};

const EMPTY_INSURANCE: PatientInsurance = {
  provider: '',
  policyNumber: '',
  groupNumber: '',
  validFrom: '',
  validTo: '',
  coverageType: 'Private',
  isActive: true,
};

/** Server-side cap; mirrored here so the Add button disables at the same point. */
const MAX_EMERGENCY_CONTACTS = 10;

interface PatientProfile {
  patientId: string;
  fullName: string;
  dateOfBirth: string;
  nationalHealthId: string;
  bloodType: string;
  allergies: string[];
  currentMedications: string[];
  chronicConditions: string[];
  emergencyContacts: EmergencyContact[];
  organDonor: boolean;
  dnrStatus: boolean;
  phone: string;
  gender: string;
  languages: string[];
  address: PatientAddress | null;
  insurance: PatientInsurance | null;
  lastUpdated: string;
}

/**
 * My Profile Page
 * 
 * Displays the patient's personal and medical information.
 *
 * The split of what is editable here is deliberate, not incidental: demographic
 * and administrative facts (contact details, address, insurance, emergency
 * contacts) are the patient's own to maintain, while clinical facts (blood type,
 * allergies, conditions, DNR) stay read-only because a self-declared blood type
 * must never be mistaken for a verified clinical record.
 * 
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function MyProfilePage() {
  const { t } = useTranslation();
  const patient = usePatientAuthStore(state => state.patient);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContact, setNewContact] = useState<EmergencyContact>({ name: '', phone: '', relationship: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Each editable section keeps its own draft so opening one does not discard
  // unsaved edits in another, and cancelling reverts only that section.
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({ phone: '', gender: '', languages: '' });
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState<PatientAddress>(EMPTY_ADDRESS);
  const [editingInsurance, setEditingInsurance] = useState(false);
  const [insuranceDraft, setInsuranceDraft] = useState<PatientInsurance>(EMPTY_INSURANCE);

  useEffect(() => {
    loadProfile();
  }, [patient?.healthId]);

  const loadProfile = async () => {
    setIsLoading(true);
    
    try {
      if (!patient) {
        setProfile(null);
        setIsLoading(false);
        return;
      }

      const response = await fetch(apiUrl(`/api/patients/${patient.healthId}`), {
        headers: {
          'X-User-Id': patient.walletAddress,
          'X-Health-Id': patient.healthId,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const emergencyInfo = data.emergency_info || {};

        setProfile({
          patientId: data.patient_id,
          fullName: data.full_name,
          dateOfBirth: data.date_of_birth,
          nationalHealthId: data.national_id || data.patient_id,
          bloodType: emergencyInfo.blood_type || 'Unknown',
          allergies: emergencyInfo.allergies?.map((a: { name: string }) => a.name) || [],
          currentMedications: emergencyInfo.current_medications || [],
          chronicConditions: emergencyInfo.chronic_conditions || [],
          emergencyContacts: (emergencyInfo.emergency_contacts || []).map(
            (c: { name: string; phone: string; relationship: string; can_make_medical_decisions?: boolean }) => ({
              name: c.name,
              phone: c.phone,
              relationship: c.relationship,
              canMakeMedicalDecisions: c.can_make_medical_decisions ?? false,
            })
          ),
          organDonor: emergencyInfo.organ_donor || false,
          dnrStatus: emergencyInfo.dnr_status || false,
          phone: data.phone || '',
          gender: data.gender || '',
          languages: emergencyInfo.languages || [],
          address: data.address
            ? {
                street: data.address.street || '',
                city: data.address.city || '',
                state: data.address.state || '',
                country: data.address.country || '',
                postalCode: data.address.postal_code || '',
              }
            : null,
          insurance: data.insurance
            ? {
                provider: data.insurance.provider || '',
                policyNumber: data.insurance.policy_number || '',
                groupNumber: data.insurance.group_number || '',
                validFrom: data.insurance.valid_from || '',
                validTo: data.insurance.valid_to || '',
                coverageType: data.insurance.coverage_type || 'Private',
                isActive: data.insurance.is_active ?? true,
              }
            : null,
          lastUpdated: data.last_updated || new Date().toISOString(),
        });
      } else {
        setProfile(null);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
      setProfile(null);
    }
    
    setIsLoading(false);
  };

  /** Show a message for a few seconds, then clear it. */
  const flash = (message: string) => {
    setSaveSuccess(message);
    setTimeout(() => setSaveSuccess(null), 3000);
  };

  /**
   * Persist the whole contact list.
   *
   * Add, edit and remove all funnel through here because the endpoint replaces
   * the list wholesale — which keeps the server the single source of truth for
   * priority ordering instead of the client guessing at it.
   */
  const persistContacts = async (contacts: EmergencyContact[]) => {
    if (!profile) return false;
    setIsSaving(true);
    setError(null);
    try {
      const response = await replaceEmergencyContacts(
        profile.patientId,
        contacts.map(c => ({
          name: c.name,
          phone: c.phone,
          relationship: c.relationship,
          can_make_medical_decisions: c.canMakeMedicalDecisions ?? false,
        }))
      );
      if (!response.success) {
        setError(response.message || t('profile.saveFailed'));
        return false;
      }
      setProfile({ ...profile, emergencyContacts: contacts, lastUpdated: new Date().toISOString() });
      return true;
    } catch (err) {
      console.error('Failed to save contacts:', err);
      setError(t('profile.saveFailedRetry'));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddContact = async () => {
    if (!profile || !newContact.name || !newContact.phone || !newContact.relationship) {
      return;
    }
    // Reject malformed numbers before submit so we never save a broken contact.
    if (!isValidPhoneNumber(newContact.phone)) {
      setError(t('profile.invalidPhone'));
      return;
    }
    const ok = await persistContacts([...profile.emergencyContacts, newContact]);
    if (ok) {
      flash(t('profile.contactAdded'));
      setIsAddingContact(false);
      setNewContact({ name: '', phone: '', relationship: '' });
    }
  };

  const handleRemoveContact = async (index: number) => {
    if (!profile) return;
    const remaining = profile.emergencyContacts.filter((_, i) => i !== index);
    if (await persistContacts(remaining)) {
      flash(t('profile.contactsSaved'));
    }
  };

  const cancelAddContact = () => {
    setIsAddingContact(false);
    setNewContact({ name: '', phone: '', relationship: '' });
  };

  const beginEditDetails = () => {
    if (!profile) return;
    setDetailsDraft({
      phone: profile.phone,
      gender: profile.gender,
      languages: profile.languages.join(', '),
    });
    setEditingDetails(true);
  };

  const handleSaveDetails = async () => {
    if (!profile) return;
    if (detailsDraft.phone.trim() && !isValidPhoneNumber(detailsDraft.phone)) {
      setError(t('profile.invalidPhone'));
      return;
    }
    const languages = detailsDraft.languages
      .split(',')
      .map(l => l.trim())
      .filter(Boolean);
    setIsSaving(true);
    setError(null);
    try {
      await updateDemographics(profile.patientId, {
        phone: detailsDraft.phone.trim(),
        gender: detailsDraft.gender,
        languages,
      });
      setProfile({
        ...profile,
        phone: detailsDraft.phone.trim(),
        gender: detailsDraft.gender,
        languages,
        lastUpdated: new Date().toISOString(),
      });
      setEditingDetails(false);
      flash(t('profile.detailsSaved'));
    } catch (err) {
      console.error('Failed to save details:', err);
      setError(t('profile.saveFailedRetry'));
    } finally {
      setIsSaving(false);
    }
  };

  const beginEditAddress = () => {
    setAddressDraft(profile?.address ?? EMPTY_ADDRESS);
    setEditingAddress(true);
  };

  const handleSaveAddress = async () => {
    if (!profile) return;
    if (!addressDraft.city.trim() || !addressDraft.country.trim()) {
      setError(t('profile.addressIncomplete'));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateDemographics(profile.patientId, {
        address: {
          street: addressDraft.street.trim() || null,
          city: addressDraft.city.trim(),
          state: addressDraft.state.trim() || null,
          country: addressDraft.country.trim(),
          postal_code: addressDraft.postalCode.trim() || null,
          coordinates: null,
        },
      });
      setProfile({ ...profile, address: addressDraft, lastUpdated: new Date().toISOString() });
      setEditingAddress(false);
      flash(t('profile.detailsSaved'));
    } catch (err) {
      console.error('Failed to save address:', err);
      setError(t('profile.saveFailedRetry'));
    } finally {
      setIsSaving(false);
    }
  };

  const beginEditInsurance = () => {
    setInsuranceDraft(profile?.insurance ?? EMPTY_INSURANCE);
    setEditingInsurance(true);
  };

  const handleSaveInsurance = async () => {
    if (!profile) return;
    if (!insuranceDraft.provider.trim() || !insuranceDraft.policyNumber.trim()) {
      setError(t('profile.insuranceIncomplete'));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateDemographics(profile.patientId, {
        insurance: {
          provider: insuranceDraft.provider.trim(),
          policy_number: insuranceDraft.policyNumber.trim(),
          group_number: insuranceDraft.groupNumber.trim() || null,
          valid_from: insuranceDraft.validFrom,
          valid_to: insuranceDraft.validTo,
          coverage_type: insuranceDraft.coverageType,
          is_active: insuranceDraft.isActive,
        },
      });
      setProfile({ ...profile, insurance: insuranceDraft, lastUpdated: new Date().toISOString() });
      setEditingInsurance(false);
      flash(t('profile.detailsSaved'));
    } catch (err) {
      console.error('Failed to save insurance:', err);
      setError(t('profile.saveFailedRetry'));
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const calculateAge = (dob: string) => {
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  // Sanitize phone number for tel: links - only allow digits, +, -, (, ), spaces
  const sanitizePhoneForTel = (phone: string): string => {
    return phone.replace(/[^\d+\-() ]/g, '');
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-8 bg-neutral-200 rounded w-48" />
        <div className="h-32 bg-neutral-200 rounded-xl" />
        <div className="h-48 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900">{t('profile.title')}</h1>
      </div>

      {/* Read-only notice */}
      <div className="flex items-start gap-3 p-4 bg-info-light rounded-xl border border-info/20">
        <Info className="w-5 h-5 text-info mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-info-dark">{t('profile.viewOnly')}</p>
          <p className="text-sm text-info-dark/80">
            {t('profile.viewOnlyNote')}
          </p>
        </div>
      </div>

      {/* Success Message */}
      {saveSuccess && (
        <div className="success-card flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-success-500" />
          <span>{saveSuccess}</span>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="error-card flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-danger-500" />
          <span>{error}</span>
          <button 
            onClick={() => setError(null)}
            className="ml-auto text-danger-500 hover:text-danger-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Personal Info Card */}
      <div className="patient-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
            <User className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h2 className="font-semibold text-lg text-neutral-900">{t('profile.personalInfo')}</h2>
            <p className="text-sm text-neutral-500">{t('profile.personalInfoSub')}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-neutral-500">{t('profile.fullName')}</label>
              <p className="font-medium text-neutral-900">{profile?.fullName}</p>
            </div>
            <div>
              <label className="text-sm text-neutral-500">{t('profile.dateOfBirth')}</label>
              <p className="font-medium text-neutral-900">
                {profile && formatDate(profile.dateOfBirth)} ({profile && calculateAge(profile.dateOfBirth)} {t('profile.years')})
              </p>
            </div>
          </div>

          <div className="border-t pt-4">
            <label className="text-sm text-neutral-500 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              {t('profile.nationalHealthId')}
            </label>
            <p className="font-mono text-lg font-semibold text-primary-600 mt-1">
              {profile?.nationalHealthId}
            </p>
          </div>
        </div>
      </div>

      {/* Medical Info Card */}
      <div className="patient-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-emergency-50 rounded-xl flex items-center justify-center">
            <Heart className="w-6 h-6 text-emergency-500" />
          </div>
          <div>
            <h2 className="font-semibold text-lg text-neutral-900">{t('profile.medicalInfo')}</h2>
            <p className="text-sm text-neutral-500">{t('profile.medicalInfoSub')}</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Blood Type */}
          <div className="flex items-center justify-between p-4 bg-emergency-50 rounded-xl">
            <div className="flex items-center gap-3">
              <Droplets className="w-6 h-6 text-emergency-500" />
              <span className="font-medium text-neutral-900">{t('profile.bloodType')}</span>
            </div>
            <span className="text-2xl font-bold text-emergency-600">{profile?.bloodType}</span>
          </div>

          {/* Allergies */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-emergency-500" />
              <span className="font-medium text-neutral-900">{t('profile.allergies')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile?.allergies.map((allergy, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1.5 bg-emergency-100 text-emergency-700 rounded-full text-sm font-medium"
                >
                  {allergy}
                </span>
              ))}
              {profile?.allergies.length === 0 && (
                <span className="text-neutral-500">{t('profile.noAllergies')}</span>
              )}
            </div>
          </div>

          {/* Medications */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Pill className="w-5 h-5 text-info" />
              <span className="font-medium text-neutral-900">{t('profile.currentMedications')}</span>
            </div>
            <div className="space-y-2">
              {profile?.currentMedications.map((med, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-info-light rounded-xl text-info-dark flex items-center gap-2"
                >
                  <div className="w-2 h-2 bg-info rounded-full" />
                  {med}
                </div>
              ))}
              {profile?.currentMedications.length === 0 && (
                <span className="text-neutral-500">{t('profile.noMedications')}</span>
              )}
            </div>
          </div>

          {/* Chronic Conditions */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-5 h-5 text-warning-500" />
              <span className="font-medium text-neutral-900">{t('profile.chronicConditions')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile?.chronicConditions.map((condition, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1.5 bg-warning-50 text-warning-700 rounded-full text-sm font-medium"
                >
                  {condition}
                </span>
              ))}
              {profile?.chronicConditions.length === 0 && (
                <span className="text-neutral-500">{t('profile.noConditions')}</span>
              )}
            </div>
          </div>

          {/* Organ Donor / DNR */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div className="flex items-center justify-between p-3 bg-neutral-50 rounded-xl">
              <span className="text-sm font-medium text-neutral-700">{t('profile.organDonor')}</span>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                profile?.organDonor ? 'bg-success-100 text-success-700' : 'bg-neutral-200 text-neutral-600'
              }`}>
                {profile?.organDonor ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-neutral-50 rounded-xl">
              <span className="text-sm font-medium text-neutral-700">{t('profile.dnrStatus')}</span>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                profile?.dnrStatus ? 'bg-emergency-100 text-emergency-700' : 'bg-neutral-200 text-neutral-600'
              }`}>
                {profile?.dnrStatus ? t('common.yes') : t('common.no')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Details Card - patient-editable */}
      <div className="patient-card">
        <div className="flex items-center justify-between mb-6 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Phone className="w-6 h-6 text-primary-600" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-lg text-neutral-900">{t('profile.contactDetails')}</h2>
              <p className="text-sm text-neutral-500">{t('profile.contactDetailsSub')}</p>
            </div>
          </div>
          {!editingDetails && (
            <button
              onClick={beginEditDetails}
              className="flex items-center gap-2 px-4 py-2 text-primary-600 hover:bg-primary-50 rounded-xl transition-colors flex-shrink-0"
            >
              <Pencil className="w-4 h-4" />
              {t('profile.edit')}
            </button>
          )}
        </div>

        {editingDetails ? (
          <div className="space-y-4">
              <div>
                <label htmlFor="profile-phone" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.phoneNumber')}
                </label>
                <input
                  type="tel"
                  id="profile-phone"
                  value={detailsDraft.phone}
                  onChange={(e) => setDetailsDraft({ ...detailsDraft, phone: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder={t('profile.phonePlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="profile-gender" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.gender')}
                </label>
                <select
                  id="profile-gender"
                  value={detailsDraft.gender}
                  onChange={(e) => setDetailsDraft({ ...detailsDraft, gender: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">{t('profile.genderUnspecified')}</option>
                  <option value="female">{t('profile.genderFemale')}</option>
                  <option value="male">{t('profile.genderMale')}</option>
                  <option value="other">{t('profile.genderOther')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="profile-languages" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.spokenLanguages')}
                </label>
                <input
                  type="text"
                  id="profile-languages"
                  value={detailsDraft.languages}
                  onChange={(e) => setDetailsDraft({ ...detailsDraft, languages: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder={t('profile.spokenLanguagesHint')}
                />
              </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditingDetails(false)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-neutral-600 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-50 transition-colors"
              >
                <X className="w-4 h-4" />
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveDetails}
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {t('profile.saveChanges')}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-neutral-500">{t('profile.phoneNumber')}</label>
              <p className="font-medium text-neutral-900">
                {profile?.phone || t('profile.notRecorded')}
              </p>
            </div>
            <div>
              <label className="text-sm text-neutral-500">{t('profile.gender')}</label>
              <p className="font-medium text-neutral-900 capitalize">
                {profile?.gender || t('profile.notRecorded')}
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm text-neutral-500 flex items-center gap-2">
                <Globe className="w-4 h-4" />
                {t('profile.spokenLanguages')}
              </label>
              <p className="font-medium text-neutral-900">
                {profile && profile.languages.length > 0
                  ? profile.languages.join(', ')
                  : t('profile.notRecorded')}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Home Address Card - patient-editable */}
      <div className="patient-card">
        <div className="flex items-center justify-between mb-6 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <MapPin className="w-6 h-6 text-primary-600" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-lg text-neutral-900">{t('profile.addressTitle')}</h2>
              <p className="text-sm text-neutral-500">{t('profile.addressSub')}</p>
            </div>
          </div>
          {!editingAddress && (
            <button
              onClick={beginEditAddress}
              className="flex items-center gap-2 px-4 py-2 text-primary-600 hover:bg-primary-50 rounded-xl transition-colors flex-shrink-0"
            >
              <Pencil className="w-4 h-4" />
              {t('profile.edit')}
            </button>
          )}
        </div>

        {editingAddress ? (
          <div className="space-y-4">
              <div>
                <label htmlFor="address-street" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.addressStreet')}
                </label>
                <input
                  type="text"
                  id="address-street"
                  value={addressDraft.street}
                  onChange={(e) => setAddressDraft({ ...addressDraft, street: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="address-city" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.addressCity')}
                </label>
                <input
                  type="text"
                  id="address-city"
                  value={addressDraft.city}
                  onChange={(e) => setAddressDraft({ ...addressDraft, city: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="address-state" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.addressState')}
                </label>
                <input
                  type="text"
                  id="address-state"
                  value={addressDraft.state}
                  onChange={(e) => setAddressDraft({ ...addressDraft, state: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="address-country" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.addressCountry')}
                </label>
                <input
                  type="text"
                  id="address-country"
                  value={addressDraft.country}
                  onChange={(e) => setAddressDraft({ ...addressDraft, country: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="ZA"
                />
              </div>
              <div>
                <label htmlFor="address-postal" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.addressPostalCode')}
                </label>
                <input
                  type="text"
                  id="address-postal"
                  value={addressDraft.postalCode}
                  onChange={(e) => setAddressDraft({ ...addressDraft, postalCode: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditingAddress(false)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-neutral-600 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-50 transition-colors"
              >
                <X className="w-4 h-4" />
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveAddress}
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {t('profile.saveChanges')}
              </button>
            </div>
          </div>
        ) : profile?.address ? (
          <div className="text-neutral-900 space-y-1">
            {profile.address.street && <p className="font-medium">{profile.address.street}</p>}
            <p className="font-medium">
              {[profile.address.city, profile.address.state, profile.address.postalCode]
                .filter(Boolean)
                .join(', ')}
            </p>
            <p className="font-medium">{profile.address.country}</p>
          </div>
        ) : (
          <p className="text-neutral-500">{t('profile.noAddress')}</p>
        )}
      </div>

      {/* Insurance Card - patient-editable */}
      <div className="patient-card">
        <div className="flex items-center justify-between mb-6 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-6 h-6 text-primary-600" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-lg text-neutral-900">{t('profile.insuranceTitle')}</h2>
              <p className="text-sm text-neutral-500">{t('profile.insuranceSub')}</p>
            </div>
          </div>
          {!editingInsurance && (
            <button
              onClick={beginEditInsurance}
              className="flex items-center gap-2 px-4 py-2 text-primary-600 hover:bg-primary-50 rounded-xl transition-colors flex-shrink-0"
            >
              <Pencil className="w-4 h-4" />
              {t('profile.edit')}
            </button>
          )}
        </div>

        {editingInsurance ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="insurance-provider" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.insuranceProvider')}
                </label>
                <input
                  type="text"
                  id="insurance-provider"
                  value={insuranceDraft.provider}
                  onChange={(e) => setInsuranceDraft({ ...insuranceDraft, provider: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="insurance-policy" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.insurancePolicyNumber')}
                </label>
                <input
                  type="text"
                  id="insurance-policy"
                  value={insuranceDraft.policyNumber}
                  onChange={(e) => setInsuranceDraft({ ...insuranceDraft, policyNumber: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="insurance-group" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.insuranceGroupNumber')}
                </label>
                <input
                  type="text"
                  id="insurance-group"
                  value={insuranceDraft.groupNumber}
                  onChange={(e) => setInsuranceDraft({ ...insuranceDraft, groupNumber: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="insurance-type" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.insuranceCoverageType')}
                </label>
                <select
                  id="insurance-type"
                  value={insuranceDraft.coverageType}
                  onChange={(e) =>
                    setInsuranceDraft({
                      ...insuranceDraft,
                      coverageType: e.target.value as PatientInsurance['coverageType'],
                    })
                  }
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="Public">{t('profile.coveragePublic')}</option>
                  <option value="Private">{t('profile.coveragePrivate')}</option>
                  <option value="Employer">{t('profile.coverageEmployer')}</option>
                  <option value="NHIS">{t('profile.coverageNHIS')}</option>
                  <option value="Community">{t('profile.coverageCommunity')}</option>
                  <option value="None">{t('profile.coverageNone')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="insurance-from" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.insuranceValidFrom')}
                </label>
                <input
                  type="date"
                  id="insurance-from"
                  value={insuranceDraft.validFrom}
                  onChange={(e) => setInsuranceDraft({ ...insuranceDraft, validFrom: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="insurance-to" className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('profile.insuranceValidTo')}
                </label>
                <input
                  type="date"
                  id="insurance-to"
                  value={insuranceDraft.validTo}
                  onChange={(e) => setInsuranceDraft({ ...insuranceDraft, validTo: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>
            <label className="flex items-center gap-3 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={insuranceDraft.isActive}
                onChange={(e) => setInsuranceDraft({ ...insuranceDraft, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
              />
              {t('profile.insuranceActive')}
            </label>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditingInsurance(false)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-neutral-600 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-50 transition-colors"
              >
                <X className="w-4 h-4" />
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveInsurance}
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {t('profile.saveChanges')}
              </button>
            </div>
          </div>
        ) : profile?.insurance ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-neutral-500">{t('profile.insuranceProviderLabel')}</label>
              <p className="font-medium text-neutral-900">{profile.insurance.provider}</p>
            </div>
            <div>
              <label className="text-sm text-neutral-500">{t('profile.insurancePolicyLabel')}</label>
              <p className="font-medium text-neutral-900 font-mono">{profile.insurance.policyNumber}</p>
            </div>
            <div>
              <label className="text-sm text-neutral-500">{t('profile.insuranceCoverageType')}</label>
              <p className="font-medium text-neutral-900">{profile.insurance.coverageType}</p>
            </div>
            <div>
              <label className="text-sm text-neutral-500">{t('profile.insuranceValidTo')}</label>
              <p className="font-medium text-neutral-900">{profile.insurance.validTo || '-'}</p>
            </div>
          </div>
        ) : (
          <p className="text-neutral-500">{t('profile.noInsurance')}</p>
        )}
      </div>

      {/* Emergency Contacts Card */}
      <div className="patient-card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-success-50 rounded-xl flex items-center justify-center">
              <Phone className="w-6 h-6 text-success-500" />
            </div>
            <div>
              <h2 className="font-semibold text-lg text-neutral-900">{t('profile.emergencyContacts')}</h2>
              <p className="text-sm text-neutral-500">{t('profile.emergencyContactsSub')}</p>
            </div>
          </div>
          {!isAddingContact && profile !== null && profile.emergencyContacts.length < MAX_EMERGENCY_CONTACTS && (
            <button
              onClick={() => setIsAddingContact(true)}
              className="flex items-center gap-2 px-4 py-2 text-success-600 hover:bg-success-50 rounded-xl transition-colors"
            >
              <Plus className="w-5 h-5" />
              {t('common.add')}
            </button>
          )}
        </div>

        {/* Add New Contact Form */}
        {isAddingContact && (
          <div className="mb-6 p-4 bg-success-50 rounded-xl border border-success-200">
            <h3 className="font-medium text-neutral-900 mb-4">{t('profile.addEmergencyContact')}</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="emergency-contact-name" className="block text-sm font-medium text-neutral-700 mb-1">{t('profile.fullNameRequired')}</label>
                <input
                  type="text"
                  id="emergency-contact-name"
                  value={newContact.name}
                  onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-success-500 focus:border-transparent"
                  placeholder={t('profile.namePlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="emergency-contact-phone" className="block text-sm font-medium text-neutral-700 mb-1">{t('profile.phoneRequired')}</label>
                <input
                  type="tel"
                  id="emergency-contact-phone"
                  value={newContact.phone}
                  onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-success-500 focus:border-transparent"
                  placeholder={t('profile.phonePlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="emergency-contact-relationship" className="block text-sm font-medium text-neutral-700 mb-1">{t('profile.relationshipRequired')}</label>
                <select
                  id="emergency-contact-relationship"
                  value={newContact.relationship}
                  onChange={(e) => setNewContact({ ...newContact, relationship: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-success-500 focus:border-transparent"
                >
                  <option value="">{t('profile.selectRelationship')}</option>
                  <option value="Spouse">{t('profile.relSpouse')}</option>
                  <option value="Parent">{t('profile.relParent')}</option>
                  <option value="Child">{t('profile.relChild')}</option>
                  <option value="Sibling">{t('profile.relSibling')}</option>
                  <option value="Friend">{t('profile.relFriend')}</option>
                  <option value="Other">{t('profile.relOther')}</option>
                </select>
              </div>
              <label className="flex items-center gap-3 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={newContact.canMakeMedicalDecisions ?? false}
                  onChange={(e) =>
                    setNewContact({ ...newContact, canMakeMedicalDecisions: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-neutral-300 text-success-600 focus:ring-success-500"
                />
                {t('profile.canMakeDecisions')}
              </label>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={cancelAddContact}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-neutral-600 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-50 transition-colors"
                >
                  <X className="w-4 h-4" />
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleAddContact}
                  disabled={isSaving || !newContact.name || !newContact.phone || !newContact.relationship}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-success-500 text-white rounded-xl hover:bg-success-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {t('profile.saveContact')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {profile?.emergencyContacts.map((contact, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-4 bg-neutral-50 rounded-xl"
            >
              <div className="min-w-0">
                <p className="font-medium text-neutral-900 truncate">
                  <span className="text-neutral-400 mr-2">{idx + 1}.</span>
                  {contact.name}
                </p>
                <p className="text-sm text-neutral-500 truncate">
                  {contact.relationship} · {contact.phone}
                </p>
                {contact.canMakeMedicalDecisions && (
                  <p className="text-xs text-primary-600 mt-1">{t('profile.canMakeDecisions')}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={`tel:${sanitizePhoneForTel(contact.phone)}`}
                  className="flex items-center gap-2 px-4 py-2 bg-success-500 text-white rounded-xl hover:bg-success-600 transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  {t('profile.call')}
                </a>
                <button
                  onClick={() => handleRemoveContact(idx)}
                  disabled={isSaving}
                  aria-label={`${t('profile.removeContact')} ${contact.name}`}
                  className="p-2 text-danger-500 hover:bg-danger-50 rounded-xl transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {profile?.emergencyContacts.length === 0 && (
            <p className="text-center text-neutral-500 py-4">
              {t('profile.noContacts')}
            </p>
          )}
        </div>
      </div>

      {/* Last Updated */}
      <div className="text-center text-sm text-neutral-500 flex items-center justify-center gap-2">
        <Calendar className="w-4 h-4" />
        {t('profile.lastUpdatedLabel')} {profile && formatDate(profile.lastUpdated)}
      </div>
    </div>
  );
}
