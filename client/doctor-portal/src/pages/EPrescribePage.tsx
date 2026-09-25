import React, { useState } from 'react';
import {
  createEPrescription,
  signEPrescription,
  transmitEPrescription,
  exportDocumentToPdf,
  useTranslation,
  Input,
  useValidatedForm,
  prescriptionSchema,
} from '@medichain/shared';
import { FileText, Send, AlertCircle, Download } from 'lucide-react';
import { useToastActions } from '../components/Toast';
import PatientSelect from '../components/PatientSelect';
import { useAuthStore } from '../store/authStore';

export default function EPrescribePage() {
  const { t } = useTranslation();
  const { showError } = useToastActions();
  const { user } = useAuthStore();
  // The API restricts prescribing to physicians (`Only physicians can create
  // prescriptions`). Without this, a nurse could open the page, fill in every
  // field and only discover the restriction as a generic failure on submit.
  const mayPrescribe = user?.role === 'Doctor';
  const [formData, setFormData] = useState({
    patient_id: '',
    medication_name: '',
    strength: '',
    form: 'tablet',
    quantity: 30,
    days_supply: 30,
    directions: '',
    refills_allowed: 0,
    is_controlled: false,
    pharmacy_ncpdp: '1234567',
    pharmacy_name: 'Main Street Pharmacy',
    diagnosis_codes: [] as string[],
    patient_instructions: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [lastPrescription, setLastPrescription] = useState<typeof formData | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Validation lives in `@medichain/shared/validation`, not in this page: the
  // same prescription rules have to hold wherever a prescription is written,
  // and a rule spelled out in JSX is a rule that exists once.
  //
  // Client-side validation is a usability feature and provides no security
  // whatsoever -- the server validates independently. What it buys is the
  // clinician learning about a mistyped dose beside the field, before the
  // prescription is signed and transmitted, rather than from a generic 400.
  const { errors, validate, validateField, clearField } = useValidatedForm(prescriptionSchema);

  /**
   * Validate on blur, per the sound default: check a field when the user leaves
   * it, and clear its error as soon as they start correcting it. Validating on
   * every keystroke scolds someone mid-word; validating only on submit hides
   * the problem until the end.
   */
  const handleBlur = (field: Parameters<typeof validateField>[0]) => () =>
    validateField(field, formData);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Every field on submit, because blur never fires on a control the user
    // skipped entirely.
    if (!validate(formData)) {
      return;
    }
    setIsSubmitting(true);
    try {
      // "Send Prescription" has to actually send it. Creating alone leaves the
      // prescription in Draft, which is why every prescription in the system sat
      // unsigned and untransmitted and no pharmacy would ever have received one.
      const created = await createEPrescription(formData);
      const prescriptionId = created?.prescription_id;
      if (prescriptionId) {
        await signEPrescription(prescriptionId, {
          signature_method: 'wallet',
          attestation:
            'I certify that this prescription is issued for a legitimate medical purpose in the usual course of my professional practice.',
        });
        await transmitEPrescription(prescriptionId);
      }
      setSuccess(true);
      setLastPrescription(formData);
      setTimeout(() => setSuccess(false), 3000);
      // Reset form
      setFormData({
        ...formData,
        medication_name: '',
        strength: '',
        directions: '',
        patient_instructions: '',
      });
    } catch (err) {
      console.error(err);
      showError(t('docEPrescribe.errorCreating'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!lastPrescription) return;
    setIsExportingPdf(true);
    try {
      await exportDocumentToPdf({
        title: t('docEPrescribe.title'),
        subtitle: `${lastPrescription.medication_name} ${lastPrescription.strength} — ${lastPrescription.patient_id}`,
        filename: `prescription-${lastPrescription.patient_id}-${lastPrescription.medication_name}.pdf`,
        sections: [
          {
            heading: t('docEPrescribe.medicationDetails'),
            lines: [
              `${t('docEPrescribe.medicationName')}: ${lastPrescription.medication_name}`,
              `${t('docEPrescribe.strength')}: ${lastPrescription.strength}`,
              `${t('docEPrescribe.form')}: ${lastPrescription.form}`,
              `${t('docEPrescribe.quantity')}: ${lastPrescription.quantity}`,
              `${t('docEPrescribe.daysSupply')}: ${lastPrescription.days_supply}`,
              `${t('docEPrescribe.refillsAllowed')}: ${lastPrescription.refills_allowed}`,
              `${t('docEPrescribe.directions')}: ${lastPrescription.directions}`,
            ],
          },
          {
            heading: t('docEPrescribe.patientPharmacy'),
            lines: [
              `${t('docEPrescribe.patient')}: ${lastPrescription.patient_id}`,
              `${t('docEPrescribe.pharmacy')}: ${lastPrescription.pharmacy_name}`,
            ],
          },
          ...(lastPrescription.patient_instructions
            ? [{ heading: t('docEPrescribe.patientInstructions'), lines: [lastPrescription.patient_instructions] }]
            : []),
        ],
      });
    } catch (err) {
      console.error('Failed to export prescription PDF:', err);
      showError(t('docEPrescribe.errorCreating'));
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const numericFields = new Set(['quantity', 'days_supply', 'refills_allowed']);
    clearField(name as Parameters<typeof clearField>[0]);
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : numericFields.has(name)
          ? Number(value)
          : value
    }));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-content flex items-center">
          <FileText className="h-8 w-8 text-notice-subtle-fg mr-3" />
          {t('docEPrescribe.title')}
        </h1>
        <p className="mt-2 text-content-muted">
          {t('docEPrescribe.subtitle')}
        </p>
      </div>

      {success && (
        <div className="mb-6 bg-ok-subtle border border-ok rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center">
            <Send className="h-5 w-5 text-ok-subtle-fg mr-2" />
            <span className="text-ok-subtle-fg">{t('docEPrescribe.sentSuccess')}</span>
          </div>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-ok-subtle-fg border border-ok rounded-md hover:bg-ok-subtle disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
          >
            <Download className="h-4 w-4" />
            {isExportingPdf ? t('docEPrescribe.exportingPdf') : t('docEPrescribe.exportPdf')}
          </button>
        </div>
      )}

      {!mayPrescribe && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-lg border border-caution bg-caution-subtle p-4 dark:border-amber-700 dark:bg-amber-950"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-caution-subtle-fg dark:text-amber-400" />
          <div>
            <p className="font-medium text-caution-subtle-fg dark:text-amber-100">
              {t('docEPrescribe.physiciansOnlyTitle')}
            </p>
            <p className="text-sm text-caution-subtle-fg dark:text-amber-200">
              {t('docEPrescribe.physiciansOnlyBody')}
            </p>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Patient & Pharmacy */}
        <div className="bg-surface shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-content mb-4">{t('docEPrescribe.patientPharmacy')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PatientSelect
              id="patient_id"
              label={t('docEPrescribe.patient')}
              value={formData.patient_id}
              onChange={(patientId) => setFormData(prev => ({...prev, patient_id: patientId}))}
              placeholder={t('docEPrescribe.patientPlaceholder')}
              required
            />
            <div>
              <label htmlFor="pharmacy_name" className="block text-sm font-medium text-content-secondary">{t('docEPrescribe.pharmacy')}</label>
              <select 
                id="pharmacy_name"
                name="pharmacy_name" 
                value={formData.pharmacy_name} 
                onChange={handleChange} 
                className="mt-1 w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="Main Street Pharmacy">Main Street Pharmacy</option>
                <option value="Central Hospital Pharmacy">Central Hospital Pharmacy</option>
                <option value="Community Drugstore">Community Drugstore</option>
              </select>
            </div>
          </div>
        </div>

        {/* Medication Details */}
        <div className="bg-surface shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-content mb-4">{t('docEPrescribe.medicationDetails')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="medication_name"
              name="medication_name"
              placeholder={t('docEPrescribe.medicationNamePh')}
              label={t('docEPrescribe.medicationName')}
              value={formData.medication_name}
              onChange={handleChange}
              onBlur={handleBlur('medication_name')}
              error={errors.medication_name}
              required
            />
            <Input
              id="strength"
              name="strength"
              placeholder={t('docEPrescribe.strengthPh')}
              label={t('docEPrescribe.strength')}
              value={formData.strength}
              onChange={handleChange}
              onBlur={handleBlur('strength')}
              error={errors.strength}
              required
            />
            <div>
              <label htmlFor="form" className="block text-sm font-medium text-content-secondary">{t('docEPrescribe.form')}</label>
              <select
                id="form"
                name="form"
                value={formData.form}
                onChange={handleChange}
                className="mt-1 w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="tablet">{t('docEPrescribe.formTablet')}</option>
                <option value="capsule">{t('docEPrescribe.formCapsule')}</option>
                <option value="liquid">{t('docEPrescribe.formLiquid')}</option>
                <option value="injection">{t('docEPrescribe.formInjection')}</option>
                <option value="cream">{t('docEPrescribe.formCream')}</option>
                <option value="inhaler">{t('docEPrescribe.formInhaler')}</option>
              </select>
            </div>
            <Input
              id="quantity"
              name="quantity"
              type="number"
              label={t('docEPrescribe.quantity')}
              value={formData.quantity}
              onChange={handleChange}
              onBlur={handleBlur('quantity')}
              error={errors.quantity}
              required
            />
            <Input
              id="days_supply"
              name="days_supply"
              type="number"
              label={t('docEPrescribe.daysSupply')}
              value={formData.days_supply}
              onChange={handleChange}
              onBlur={handleBlur('days_supply')}
              error={errors.days_supply}
              required
            />
            <Input
              id="refills_allowed"
              name="refills_allowed"
              type="number"
              min="0"
              max="12"
              label={t('docEPrescribe.refillsAllowed')}
              value={formData.refills_allowed}
              onChange={handleChange}
              onBlur={handleBlur('refills_allowed')}
              error={errors.refills_allowed}
              required
            />
          </div>

          <div className="mt-4">
            <label htmlFor="directions" className="block text-sm font-medium text-content-secondary">{t('docEPrescribe.directions')}</label>
            <textarea
              id="directions"
              name="directions"
              value={formData.directions}
              onChange={handleChange}
              className="mt-1 w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              rows={2}
              placeholder={t('docEPrescribe.directionsPlaceholder')}
              required
            />
          </div>

          <div className="mt-4">
            <label htmlFor="patient_instructions" className="block text-sm font-medium text-content-secondary">{t('docEPrescribe.patientInstructions')}</label>
            <textarea
              id="patient_instructions"
              name="patient_instructions"
              value={formData.patient_instructions}
              onChange={handleChange}
              className="mt-1 w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              rows={2}
              placeholder={t('docEPrescribe.patientInstructionsPlaceholder')}
            />
          </div>

          <div className="mt-4 flex items-center">
            <input
              id="is_controlled"
              type="checkbox"
              name="is_controlled"
              checked={formData.is_controlled}
              onChange={handleChange}
              className="h-4 w-4 text-notice-subtle-fg focus:ring-blue-500 border-border-interactive rounded"
            />
            <label htmlFor="is_controlled" className="ml-2 flex items-center min-h-[24px] py-1 text-sm text-content-secondary">
              {t('docEPrescribe.controlled')}
            </label>
          </div>

          {formData.is_controlled && (
            <div className="mt-3 bg-caution-subtle border border-caution rounded-lg p-3 flex items-start">
              <AlertCircle className="h-5 w-5 text-caution-subtle-fg mr-2 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-caution-subtle-fg">
                {t('docEPrescribe.controlledWarning')}
              </span>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <button 
            type="submit" 
            disabled={isSubmitting || !mayPrescribe}
            className="flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-disabled disabled:text-disabled-fg disabled:cursor-not-allowed"
          >
            <Send className="h-5 w-5 mr-2" />
            {isSubmitting ? t('docEPrescribe.sending') : t('docEPrescribe.send')}
          </button>
        </div>
      </form>
    </div>
  );
}
