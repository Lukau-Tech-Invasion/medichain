import React, { useState } from 'react';
import {
  createEPrescription,
  signEPrescription,
  transmitEPrescription,
  exportDocumentToPdf,
  useTranslation,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <FileText className="h-8 w-8 text-blue-600 mr-3" />
          {t('docEPrescribe.title')}
        </h1>
        <p className="mt-2 text-gray-600">
          {t('docEPrescribe.subtitle')}
        </p>
      </div>

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center">
            <Send className="h-5 w-5 text-green-600 mr-2" />
            <span className="text-green-800">{t('docEPrescribe.sentSuccess')}</span>
          </div>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-800 border border-green-300 rounded-md hover:bg-green-100 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {isExportingPdf ? t('docEPrescribe.exportingPdf') : t('docEPrescribe.exportPdf')}
          </button>
        </div>
      )}

      {!mayPrescribe && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-100">
              {t('docEPrescribe.physiciansOnlyTitle')}
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {t('docEPrescribe.physiciansOnlyBody')}
            </p>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Patient & Pharmacy */}
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">{t('docEPrescribe.patientPharmacy')}</h3>
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
              <label htmlFor="pharmacy_name" className="block text-sm font-medium text-gray-700">{t('docEPrescribe.pharmacy')}</label>
              <select 
                id="pharmacy_name"
                name="pharmacy_name" 
                value={formData.pharmacy_name} 
                onChange={handleChange} 
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="Main Street Pharmacy">Main Street Pharmacy</option>
                <option value="Central Hospital Pharmacy">Central Hospital Pharmacy</option>
                <option value="Community Drugstore">Community Drugstore</option>
              </select>
            </div>
          </div>
        </div>

        {/* Medication Details */}
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">{t('docEPrescribe.medicationDetails')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="medication_name" className="block text-sm font-medium text-gray-700">{t('docEPrescribe.medicationName')}</label>
              <input 
                id="medication_name"
                name="medication_name" 
                value={formData.medication_name} 
                onChange={handleChange} 
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
                placeholder={t('docEPrescribe.medicationNamePh')}
                required 
              />
            </div>
            <div>
              <label htmlFor="strength" className="block text-sm font-medium text-gray-700">{t('docEPrescribe.strength')}</label>
              <input 
                id="strength"
                name="strength" 
                value={formData.strength} 
                onChange={handleChange} 
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
                placeholder={t('docEPrescribe.strengthPh')}
                required 
              />
            </div>
            <div>
              <label htmlFor="form" className="block text-sm font-medium text-gray-700">{t('docEPrescribe.form')}</label>
              <select
                id="form"
                name="form"
                value={formData.form}
                onChange={handleChange}
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="tablet">{t('docEPrescribe.formTablet')}</option>
                <option value="capsule">{t('docEPrescribe.formCapsule')}</option>
                <option value="liquid">{t('docEPrescribe.formLiquid')}</option>
                <option value="injection">{t('docEPrescribe.formInjection')}</option>
                <option value="cream">{t('docEPrescribe.formCream')}</option>
                <option value="inhaler">{t('docEPrescribe.formInhaler')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">{t('docEPrescribe.quantity')}</label>
              <input 
                id="quantity"
                type="number" 
                name="quantity" 
                value={formData.quantity} 
                onChange={handleChange} 
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
              />
            </div>
            <div>
              <label htmlFor="days_supply" className="block text-sm font-medium text-gray-700">{t('docEPrescribe.daysSupply')}</label>
              <input 
                id="days_supply"
                type="number" 
                name="days_supply" 
                value={formData.days_supply} 
                onChange={handleChange} 
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
              />
            </div>
            <div>
              <label htmlFor="refills_allowed" className="block text-sm font-medium text-gray-700">{t('docEPrescribe.refillsAllowed')}</label>
              <input 
                id="refills_allowed"
                type="number" 
                name="refills_allowed" 
                value={formData.refills_allowed} 
                onChange={handleChange} 
                min="0"
                max="12"
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
              />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="directions" className="block text-sm font-medium text-gray-700">{t('docEPrescribe.directions')}</label>
            <textarea
              id="directions"
              name="directions"
              value={formData.directions}
              onChange={handleChange}
              className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              rows={2}
              placeholder={t('docEPrescribe.directionsPlaceholder')}
              required
            />
          </div>

          <div className="mt-4">
            <label htmlFor="patient_instructions" className="block text-sm font-medium text-gray-700">{t('docEPrescribe.patientInstructions')}</label>
            <textarea
              id="patient_instructions"
              name="patient_instructions"
              value={formData.patient_instructions}
              onChange={handleChange}
              className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
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
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_controlled" className="ml-2 block text-sm text-gray-700">
              {t('docEPrescribe.controlled')}
            </label>
          </div>

          {formData.is_controlled && (
            <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start">
              <AlertCircle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-yellow-800">
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
            className="flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Send className="h-5 w-5 mr-2" />
            {isSubmitting ? t('docEPrescribe.sending') : t('docEPrescribe.send')}
          </button>
        </div>
      </form>
    </div>
  );
}
