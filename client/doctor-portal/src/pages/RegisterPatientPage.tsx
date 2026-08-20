import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { apiUrl, getApiErrorMessage, isValidPhoneNumber, useTranslation } from '@medichain/shared';
import { 
  UserPlus, 
  CheckCircle, 
  AlertTriangle,
  Loader2
} from 'lucide-react';

interface FormData {
  fullName: string;
  walletAddress: string;
  dateOfBirth: string;
  nationalId: string;
  /** Optional: blank means "not recorded", which the patient list renders by omission. */
  gender: string;
  bloodType: string;
  allergies: string;
  currentMedications: string;
  chronicConditions: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  organDonor: boolean;
  dnrStatus: boolean;
}

const initialFormData: FormData = {
  fullName: '',
  walletAddress: '',
  dateOfBirth: '',
  nationalId: '',
  gender: '',
  bloodType: '',
  allergies: '',
  currentMedications: '',
  chronicConditions: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',
  organDonor: false,
  dnrStatus: false,
};

const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Values the API's `normalized_gender` accepts; blank submits as absent. */
const genders = ['male', 'female', 'other', 'unknown'] as const;

function RegisterPatientPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ patientId: string; nfcTagId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPhoneError(null);

    // Reject blank or malformed emergency-contact numbers before submit — a
    // broken number is worse than none in an emergency. `required` on the
    // input covers native browser submission, but this still runs for
    // whitespace-only input or a programmatic submit, so distinguish the two
    // messages rather than showing "invalid" for a simply-empty field.
    if (!formData.emergencyContactPhone.trim()) {
      setPhoneError(t('docRegisterPatient.requiredPhone'));
      return;
    }
    if (!isValidPhoneNumber(formData.emergencyContactPhone)) {
      setPhoneError(t('docRegisterPatient.invalidPhone'));
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(apiUrl('/api/register'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user?.userId || '',
        },
        body: JSON.stringify({
          full_name: formData.fullName,
          wallet_address: formData.walletAddress,
          date_of_birth: formData.dateOfBirth,
          national_id: formData.nationalId,
          // Omit rather than send '' so the server records "not stated" as absent.
          gender: formData.gender || undefined,
          phone: '',
          blood_type: formData.bloodType,
          allergies: formData.allergies.split(',').map(s => s.trim()).filter(Boolean),
          current_medications: formData.currentMedications.split(',').map(s => s.trim()).filter(Boolean),
          chronic_conditions: formData.chronicConditions.split(',').map(s => s.trim()).filter(Boolean),
          emergency_contact_name: formData.emergencyContactName,
          emergency_contact_phone: formData.emergencyContactPhone,
          emergency_contact_relationship: formData.emergencyContactRelationship,
          organ_donor: formData.organDonor,
          dnr_status: formData.dnrStatus,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      const responseText = contentType.includes('application/json')
        ? JSON.stringify(await response.json())
        : await response.text();
      let data: { patient_id?: string; nfc_tag_id?: string };
      try {
        data = JSON.parse(responseText) as { patient_id?: string; nfc_tag_id?: string };
      } catch {
        throw new Error(responseText || t('docRegisterPatient.regFailed'));
      }

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, t('docRegisterPatient.regFailed')));
      }

      setSuccess({
        patientId: data.patient_id ?? '',
        nfcTagId: data.nfc_tag_id ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('docRegisterPatient.regFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="p-8">
        <div className="max-w-lg mx-auto bg-surface rounded-xl shadow p-8 text-center">
          <div className="w-16 h-16 bg-success-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="text-success-600" size={32} />
          </div>
          <h2 className="text-2xl font-bold text-content mb-2">{t('docRegisterPatient.registered')}</h2>
          <p className="text-content-muted mb-6">
            {t('docRegisterPatient.registeredBody')}
          </p>
          
          <div className="bg-surface-sunken rounded-lg p-4 mb-6 text-left">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-content-muted">{t('docRegisterPatient.patientId')}</p>
                <p className="font-mono font-medium">{success.patientId}</p>
              </div>
              <div>
                <p className="text-sm text-content-muted">{t('docRegisterPatient.nfcTagId')}</p>
                <p className="font-mono font-medium">{success.nfcTagId}</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setSuccess(null);
                setFormData(initialFormData);
              }}
              className="flex-1 py-3 bg-surface-sunken text-content-secondary rounded-lg hover:bg-surface-sunken transition-colors"
            >
              {t('docRegisterPatient.registerAnother')}
            </button>
            <button
              onClick={() => navigate(`/patients/${success.patientId}`)}
              className="flex-1 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              {t('docRegisterPatient.viewPatient')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
            <UserPlus className="text-primary-600" size={24} />
          </div>
          <h1 className="text-2xl font-bold text-content">{t('docRegisterPatient.title')}</h1>
        </div>
        <p className="text-content-muted">
          {t('docRegisterPatient.subtitle')}
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-emergency-50 border border-emergency-200 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="text-emergency-600" size={20} />
          <p className="text-emergency-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-3xl">
        <div className="bg-surface rounded-xl shadow p-6 mb-6">
          <h3 className="font-semibold text-content mb-4">{t('docRegisterPatient.personalInfo')}</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="register-full-name" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.fullName')}</label>
              <input
                type="text"
                id="register-full-name"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder={t('docRegisterPatient.fullNamePlaceholder')}
              />
            </div>
            
            <div>
              <label htmlFor="register-date-of-birth" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.dob')}</label>
              <input
                type="date"
                id="register-date-of-birth"
                name="dateOfBirth"
                value={formData.dateOfBirth}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="register-wallet-address" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.walletAddress')}</label>
              <input
                type="text"
                id="register-wallet-address"
                name="walletAddress"
                value={formData.walletAddress}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder={t('docRegisterPatient.walletAddressPlaceholder')}
              />
            </div>
            
            <div>
              <label htmlFor="register-national-id" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.nationalId')}</label>
              <input
                type="text"
                id="register-national-id"
                name="nationalId"
                value={formData.nationalId}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder={t('docRegisterPatient.nationalIdPlaceholder')}
              />
            </div>
            
            <div>
              <label htmlFor="register-blood-type" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.bloodType')}</label>
              <select
                id="register-blood-type"
                name="bloodType"
                value={formData.bloodType}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                <option value="">{t('docRegisterPatient.selectBloodType')}</option>
                {bloodTypes.map(bt => (
                  <option key={bt} value={bt}>{bt}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="register-gender" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.gender')}</label>
              <select
                id="register-gender"
                name="gender"
                value={formData.gender}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                <option value="">{t('docRegisterPatient.selectGender')}</option>
                {genders.map(g => (
                  <option key={g} value={g}>{t(`docRegisterPatient.gender_${g}`)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-xl shadow p-6 mb-6">
          <h3 className="font-semibold text-content mb-4">{t('docRegisterPatient.medicalInfo')}</h3>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="register-allergies" className="block text-sm font-medium text-content-secondary mb-1">
                {t('docRegisterPatient.allergies')} <span className="text-content-muted">{t('docRegisterPatient.commaSeparated')}</span>
              </label>
              <input
                type="text"
                id="register-allergies"
                name="allergies"
                value={formData.allergies}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder={t('docRegisterPatient.allergiesPlaceholder')}
              />
            </div>
            
            <div>
              <label htmlFor="register-current-medications" className="block text-sm font-medium text-content-secondary mb-1">
                {t('docRegisterPatient.currentMeds')} <span className="text-content-muted">{t('docRegisterPatient.commaSeparated')}</span>
              </label>
              <textarea
                id="register-current-medications"
                name="currentMedications"
                value={formData.currentMedications}
                onChange={handleChange}
                rows={2}
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
                placeholder={t('docRegisterPatient.currentMedsPlaceholder')}
              />
            </div>
            
            <div>
              <label htmlFor="register-chronic-conditions" className="block text-sm font-medium text-content-secondary mb-1">
                {t('docRegisterPatient.chronicConditions')} <span className="text-content-muted">{t('docRegisterPatient.commaSeparated')}</span>
              </label>
              <input
                type="text"
                id="register-chronic-conditions"
                name="chronicConditions"
                value={formData.chronicConditions}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder={t('docRegisterPatient.chronicPlaceholder')}
              />
            </div>

            <div className="flex gap-6 pt-2">
              <label htmlFor="register-organ-donor" className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="register-organ-donor"
                  name="organDonor"
                  checked={formData.organDonor}
                  onChange={handleChange}
                  className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                />
                <span className="text-sm text-content-secondary">{t('docRegisterPatient.organDonor')}</span>
              </label>
              
              <label htmlFor="register-dnr-status" className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="register-dnr-status"
                  name="dnrStatus"
                  checked={formData.dnrStatus}
                  onChange={handleChange}
                  className="w-4 h-4 text-emergency-600 rounded focus:ring-emergency-500"
                />
                <span className="text-sm text-content-secondary">{t('docRegisterPatient.dnr')}</span>
              </label>
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-xl shadow p-6 mb-6">
          <h3 className="font-semibold text-content mb-4">{t('docRegisterPatient.emergencyContact')}</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="register-emergency-contact-name" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.contactName')}</label>
              <input
                type="text"
                id="register-emergency-contact-name"
                name="emergencyContactName"
                value={formData.emergencyContactName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder={t('docRegisterPatient.contactNamePlaceholder')}
              />
            </div>
            
            <div>
              <label htmlFor="register-emergency-contact-phone" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.phone')}</label>
              <input
                type="tel"
                id="register-emergency-contact-phone"
                name="emergencyContactPhone"
                value={formData.emergencyContactPhone}
                onChange={(e) => { setPhoneError(null); handleChange(e); }}
                required
                aria-invalid={phoneError ? true : undefined}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none ${
                  phoneError ? 'border-critical' : 'border-border'
                }`}
                placeholder={t('docRegisterPatient.phonePlaceholder')}
              />
              {phoneError && (
                <p className="mt-1 text-sm text-critical-subtle-fg">{phoneError}</p>
              )}
            </div>
            
            <div>
              <label htmlFor="register-emergency-contact-relationship" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.relationship')}</label>
              <input
                type="text"
                id="register-emergency-contact-relationship"
                name="emergencyContactRelationship"
                value={formData.emergencyContactRelationship}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder={t('docRegisterPatient.relationshipPlaceholder')}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-6 py-3 bg-surface-sunken text-content-secondary rounded-lg hover:bg-surface-sunken transition-colors"
          >
            {t('docRegisterPatient.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                {t('docRegisterPatient.registering')}
              </>
            ) : (
              <>
                <UserPlus size={20} />
                {t('docRegisterPatient.registerPatient')}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default RegisterPatientPage;
