import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  verifyNationalId,
  registerPatient,
  getApiErrorMessage,
  useTranslation,
  Input,
  useValidatedForm,
  patientRegistrationSchema,
  generateWalletIdentity,
} from '@medichain/shared';
import { 
  UserPlus, 
  CheckCircle, 
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { RecoveryPhrasePanel } from '../components/RecoveryPhrasePanel';

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
  const [formData, setFormData] = useState<FormData>(initialFormData);
  // The recovery phrase for an identity generated here, shown ONCE.
  //
  // A patient being registered does not have a wallet yet -- that is what
  // registration is for -- so requiring the clerk to type a 48-character SS58
  // address made the form impossible to complete honestly. The only addresses
  // a clerk could produce are someone else's.
  const [newIdentity, setNewIdentity] = useState<{ mnemonic: string; address: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  // Registration waits on this while a generated phrase is showing: a record
  // bound to a wallet whose phrase nobody kept is one its patient can never
  // open.
  const [phraseAcknowledged, setPhraseAcknowledged] = useState(false);

  // --- Checking the ID against its issuing register ---------------------------
  //
  // `POST /api/national-id/verify` fronts five real registers -- Fayda,
  // Ghana Card, NIN, Smart ID, Huduma Namba -- and had no caller, so the one
  // field that ties a medical record to a real person was accepted entirely on
  // trust. A mistyped digit creates a record that can never be matched back to
  // the patient it belongs to, which is the failure a national health ID exists
  // to prevent.
  //
  // Verification is offered, not enforced: an emergency admission cannot wait
  // on a register being reachable, and refusing to register a patient because a
  // government API is down would be the worse failure. The result is shown so
  // the person registering can decide.
  const [idCountry, setIdCountry] = useState('');
  const [idChecking, setIdChecking] = useState(false);
  const [idResult, setIdResult] = useState<{ ok: boolean; message: string } | null>(null);

  const checkNationalId = async () => {
    if (!formData.nationalId.trim() || !idCountry) {
      setIdResult({ ok: false, message: t('docRegisterPatient.idVerifyNeedsBoth') });
      return;
    }
    setIdChecking(true);
    setIdResult(null);
    try {
      const body = await verifyNationalId({
        id_number: formData.nationalId.trim(),
        country: idCountry,
      });
      // `success` means the CALL worked. Whether the ID matched is
      // `result.verified`, and conflating the two would report every reachable
      // register as a match.
      const result = (body as { result?: Record<string, unknown> }).result ?? {};
      const verified = Boolean(result.verified);
      // `verification_method` is the part that must not be glossed over: the
      // stub answers `verified: true` for ANY non-empty string, so presenting
      // it as a match would manufacture confidence in an unchecked ID -- worse
      // than not offering the check at all.
      const stubbed = String(result.verification_method ?? '').toLowerCase() === 'stub';
      if (stubbed) {
        setIdResult({ ok: false, message: t('docRegisterPatient.idVerifyStub') });
        return;
      }
      setIdResult({
        ok: verified,
        message: verified
          ? t('docRegisterPatient.idVerifyMatched')
          : t('docRegisterPatient.idVerifyNoMatch'),
      });
    } catch (err) {
      setIdResult({
        ok: false,
        message: getApiErrorMessage(err, t('docRegisterPatient.idVerifyUnavailable')),
      });
    } finally {
      setIdChecking(false);
    }
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ patientId: string; nfcTagId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Schema-driven, per field. This page previously validated exactly one field
  // (the emergency phone) by hand; every other input reached the API unchecked,
  // so a date of birth in the future or a malformed wallet address was caught
  // only by a 400 with no indication of which field was wrong.
  const form = useValidatedForm(patientRegistrationSchema);

  /**
   * Mint the patient an identity.
   *
   * The keypair is generated in this browser and the server only ever sees
   * the public address. The recovery phrase is shown once, here, because it
   * is the patient's — storing it would make the clinic able to act as them,
   * which is the whole property the wallet model exists to prevent.
   */
  const handleGenerateIdentity = async () => {
    setGenerating(true);
    try {
      const identity = await generateWalletIdentity();
      setFormData((current) => ({ ...current, walletAddress: identity.address }));
      setNewIdentity({ mnemonic: identity.mnemonic, address: identity.address });
      setPhraseAcknowledged(false);
    } catch (err) {
      setError(getApiErrorMessage(err, t('docRegisterPatient.identityFailed')));
    } finally {
      setGenerating(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    // An address typed over a generated one is not the generated one, and its
    // phrase must stop being offered as the key to this record.
    if (name === 'walletAddress' && newIdentity && value !== newIdentity.address) {
      setNewIdentity(null);
    }
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate the whole form, not just the one field somebody remembered.
    // `validate` returns null and populates per-field messages, which the
    // inputs below render and associate via aria-describedby.
    if (!form.validate(formData)) {
      // Move focus to the first invalid control so a keyboard or screen-reader
      // user is taken to the problem rather than left at the submit button
      // wondering what happened.
      const firstInvalid = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }

    if (newIdentity && !phraseAcknowledged) {
      setError(t('docRegisterPatient.recoveryNotAcknowledged'));
      document.getElementById('recovery-phrase-acknowledged')?.focus();
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await registerPatient({
        full_name: formData.fullName,
        wallet_address: formData.walletAddress,
        date_of_birth: formData.dateOfBirth,
        national_id: formData.nationalId,
        // Omit rather than send '' so the server records "not stated" as absent.
        gender: formData.gender || undefined,
        // Absent, not empty. This form collects an EMERGENCY contact number
        // (sent below) and no personal one, so `''` asserted that the
        // clinician had been asked for the patient's own phone and left it
        // blank -- which the backend stores faithfully as a known-empty
        // value (CLAUDE.md rule 9).
        phone: undefined,
        blood_type: formData.bloodType || undefined,
        allergies: formData.allergies.split(',').map(s => s.trim()).filter(Boolean),
        current_medications: formData.currentMedications.split(',').map(s => s.trim()).filter(Boolean),
        chronic_conditions: formData.chronicConditions.split(',').map(s => s.trim()).filter(Boolean),
        emergency_contact_name: formData.emergencyContactName,
        emergency_contact_phone: formData.emergencyContactPhone,
        emergency_contact_relationship: formData.emergencyContactRelationship,
        organ_donor: formData.organDonor,
        dnr_status: formData.dnrStatus,
      });

      setSuccess({
        patientId: data.patient_id,
        nfcTagId: data.nfc_tag_id,
      });
    } catch (err) {
      setError(getApiErrorMessage(err, t('docRegisterPatient.regFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="p-8">
        <div className="max-w-lg mx-auto bg-surface rounded-xl shadow p-8 text-center">
          <div className="w-16 h-16 bg-ok-subtle rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="text-ok-subtle-fg" size={32} />
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

          {/* Still on screen after registering, because this is the moment
              the patient signs in for the first time. It is never fetched
              again: leaving this page is the end of it. */}
          {newIdentity && (
            <div className="mb-6 text-left">
              <RecoveryPhrasePanel mnemonic={newIdentity.mnemonic} />
              <p className="mt-2 text-sm text-content-muted">{t('docRegisterPatient.recoverySignInHint')}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                setSuccess(null);
                setFormData(initialFormData);
                setNewIdentity(null);
                setPhraseAcknowledged(false);
              }}
              className="flex-1 py-3 bg-surface-sunken text-content-secondary rounded-lg hover:bg-surface-sunken transition-colors"
            >
              {t('docRegisterPatient.registerAnother')}
            </button>
            <button
              onClick={() => navigate(`/patients/${success.patientId}`)}
              className="flex-1 py-3 bg-brand text-brand-fg rounded-lg hover:bg-brand transition-colors"
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
          <div className="w-10 h-10 bg-brand-subtle rounded-lg flex items-center justify-center">
            <UserPlus className="text-brand" size={24} />
          </div>
          <h1 className="text-2xl font-bold text-content">{t('docRegisterPatient.title')}</h1>
        </div>
        <p className="text-content-muted">
          {t('docRegisterPatient.subtitle')}
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-critical-subtle border border-critical-subtle-fg/20 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="text-critical-subtle-fg" size={20} />
          <p className="text-critical-subtle-fg">{error}</p>
        </div>
      )}

      {/*
        Error summary. Every field is schema-validated, but most inputs on this
        page are still hand-rolled markup with nowhere to show a message — so
        without this, a bad wallet address or a future date of birth would make
        submit do nothing at all, with no explanation. Converting the remaining
        fields to <Input> is tracked in docs/OUTSTANDING_WORK.md §2.1; until
        then this guarantees the failure is at least visible and actionable.

        A summary is good practice regardless: it gives one place to see
        everything wrong, and each entry moves focus to its field.
      */}
      {form.hasErrors && (
        <div
          role="alert"
          className="mb-6 p-4 bg-critical-subtle border border-critical rounded-lg"
        >
          <p className="font-medium text-critical-subtle-fg mb-2">
            {t('docRegisterPatient.fixBeforeSaving')}
          </p>
          <ul className="list-disc list-inside space-y-1">
            {Object.entries(form.errors).map(([field, message]) => (
              <li key={field} className="text-sm text-critical-subtle-fg">
                <button
                  type="button"
                  className="underline min-h-[24px] text-left"
                  onClick={() => {
                    document
                      .querySelector<HTMLElement>(`[name="${field}"]`)
                      ?.focus();
                  }}
                >
                  {message}
                </button>
              </li>
            ))}
          </ul>
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
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
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
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="register-wallet-address" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.walletAddress')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  id="register-wallet-address"
                  name="walletAddress"
                  value={formData.walletAddress}
                  onChange={handleChange}
                  required
                  className="flex-1 px-4 py-2 border border-border-interactive rounded-lg bg-surface text-content focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
                  placeholder={t('docRegisterPatient.walletAddressPlaceholder')}
                />
                {/* A patient being registered has no wallet yet — that is what
                    registration is for — so without this the only addresses a
                    clerk could enter are somebody else's. */}
                <button
                  type="button"
                  onClick={handleGenerateIdentity}
                  disabled={generating}
                  className="px-4 py-2 bg-brand text-brand-fg rounded-lg whitespace-nowrap disabled:bg-disabled disabled:text-disabled-fg"
                >
                  {generating ? t('docRegisterPatient.generating') : t('docRegisterPatient.generateIdentity')}
                </button>
              </div>

              {newIdentity && (
                <RecoveryPhrasePanel
                  mnemonic={newIdentity.mnemonic}
                  acknowledged={phraseAcknowledged}
                  onAcknowledgedChange={setPhraseAcknowledged}
                />
              )}
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
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
                placeholder={t('docRegisterPatient.nationalIdPlaceholder')}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor="register-id-country" className="sr-only">
                  {t('docRegisterPatient.idCountry')}
                </label>
                <select
                  id="register-id-country"
                  value={idCountry}
                  onChange={(e) => setIdCountry(e.target.value)}
                  className="px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
                >
                  <option value="">{t('docRegisterPatient.idCountryPrompt')}</option>
                  <option value="south_africa">{t('docRegisterPatient.idCountryZA')}</option>
                  <option value="kenya">{t('docRegisterPatient.idCountryKE')}</option>
                  <option value="nigeria">{t('docRegisterPatient.idCountryNG')}</option>
                  <option value="ghana">{t('docRegisterPatient.idCountryGH')}</option>
                  <option value="ethiopia">{t('docRegisterPatient.idCountryET')}</option>
                </select>
                <button
                  type="button"
                  onClick={() => void checkNationalId()}
                  disabled={idChecking}
                  className="px-4 py-2 rounded-lg border border-border-interactive text-content-secondary disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[44px]"
                >
                  {idChecking
                    ? t('docRegisterPatient.idVerifyChecking')
                    : t('docRegisterPatient.idVerify')}
                </button>
              </div>
              {idResult && (
                <p
                  role="status"
                  className={`mt-2 text-sm ${idResult.ok ? 'text-ok-subtle-fg' : 'text-caution-subtle-fg'}`}
                >
                  {idResult.message}
                </p>
              )}
              <p className="mt-1 text-xs text-content-muted">
                {t('docRegisterPatient.idVerifyOptional')}
              </p>
            </div>
            
            <div>
              <label htmlFor="register-blood-type" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.bloodType')}</label>
              <select
                id="register-blood-type"
                name="bloodType"
                value={formData.bloodType}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
              >
                <option value="">{t('docRegisterPatient.selectBloodType')}</option>
                {bloodTypes.map(bt => (
                  <option key={bt} value={bt}>{bt}</option>
                ))}
                {/* Chosen explicitly, never assumed: an untyped patient used to
                    force a guess, which the emergency card then showed as fact. */}
                <option value="Unknown">{t('docRegisterPatient.bloodTypeUnknown')}</option>
              </select>
            </div>

            <div>
              <label htmlFor="register-gender" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.gender')}</label>
              <select
                id="register-gender"
                name="gender"
                value={formData.gender}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
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
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
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
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none resize-none"
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
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
                placeholder={t('docRegisterPatient.chronicPlaceholder')}
              />
            </div>

            <div className="flex gap-6 pt-2">
              <label htmlFor="register-organ-donor" className="flex items-center gap-2 min-h-[24px] py-1 cursor-pointer">
                <input
                  type="checkbox"
                  id="register-organ-donor"
                  name="organDonor"
                  checked={formData.organDonor}
                  onChange={handleChange}
                  className="w-4 h-4 text-brand rounded focus:ring-primary-500"
                />
                <span className="text-sm text-content-secondary">{t('docRegisterPatient.organDonor')}</span>
              </label>
              
              <label htmlFor="register-dnr-status" className="flex items-center gap-2 min-h-[24px] py-1 cursor-pointer">
                <input
                  type="checkbox"
                  id="register-dnr-status"
                  name="dnrStatus"
                  checked={formData.dnrStatus}
                  onChange={handleChange}
                  className="w-4 h-4 text-critical-subtle-fg rounded focus:ring-emergency-500"
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
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
                placeholder={t('docRegisterPatient.contactNamePlaceholder')}
              />
            </div>
            
            {/*
              The shared control, which carries the label association,
              aria-invalid, aria-describedby, role="alert" and the error icon.
              This field used to hand-roll all of that and get half of it: the
              message was adjacent to the input but not associated with it, so a
              screen-reader user heard an error and could not tell which field
              it belonged to.
            */}
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              id="register-emergency-contact-phone"
              name="emergencyContactPhone"
              label={t('docRegisterPatient.phone')}
              value={formData.emergencyContactPhone}
              onChange={(e) => { form.clearField('emergencyContactPhone'); handleChange(e); }}
              onBlur={() => form.validateField('emergencyContactPhone', formData)}
              required
              error={form.errors.emergencyContactPhone}
              placeholder={t('docRegisterPatient.phonePlaceholder')}
            />
            
            <div>
              <label htmlFor="register-emergency-contact-relationship" className="block text-sm font-medium text-content-secondary mb-1">{t('docRegisterPatient.relationship')}</label>
              <input
                type="text"
                id="register-emergency-contact-relationship"
                name="emergencyContactRelationship"
                value={formData.emergencyContactRelationship}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
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
            className="px-6 py-3 bg-brand text-brand-fg rounded-lg hover:bg-brand transition-colors disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 flex items-center gap-2"
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
