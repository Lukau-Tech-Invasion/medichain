import React, { useState } from 'react';
import { createEPrescription } from '@medichain/shared';
import { FileText, Send, AlertCircle } from 'lucide-react';
import { useToastActions } from '../components/Toast';
import PatientSelect from '../components/PatientSelect';

export default function EPrescribePage() {
  const { showError } = useToastActions();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createEPrescription(formData);
      setSuccess(true);
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
      showError('Error creating prescription');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <FileText className="h-8 w-8 text-blue-600 mr-3" />
          E-Prescribing
        </h1>
        <p className="mt-2 text-gray-600">
          Create and send electronic prescriptions to pharmacies.
        </p>
      </div>

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center">
          <Send className="h-5 w-5 text-green-600 mr-2" />
          <span className="text-green-800">Prescription sent successfully!</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Patient & Pharmacy */}
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Patient & Pharmacy</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PatientSelect
              id="patient_id"
              label="Patient"
              value={formData.patient_id}
              onChange={(patientId) => setFormData(prev => ({...prev, patient_id: patientId}))}
              placeholder="Search and select a patient..."
              required
            />
            <div>
              <label htmlFor="pharmacy_name" className="block text-sm font-medium text-gray-700">Pharmacy</label>
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
          <h3 className="text-lg font-medium text-gray-900 mb-4">Medication Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="medication_name" className="block text-sm font-medium text-gray-700">Medication Name</label>
              <input 
                id="medication_name"
                name="medication_name" 
                value={formData.medication_name} 
                onChange={handleChange} 
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
                placeholder="Amoxicillin"
                required 
              />
            </div>
            <div>
              <label htmlFor="strength" className="block text-sm font-medium text-gray-700">Strength</label>
              <input 
                id="strength"
                name="strength" 
                value={formData.strength} 
                onChange={handleChange} 
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
                placeholder="500mg"
                required 
              />
            </div>
            <div>
              <label htmlFor="form" className="block text-sm font-medium text-gray-700">Form</label>
              <select 
                id="form"
                name="form" 
                value={formData.form} 
                onChange={handleChange} 
                className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="tablet">Tablet</option>
                <option value="capsule">Capsule</option>
                <option value="liquid">Liquid</option>
                <option value="injection">Injection</option>
                <option value="cream">Cream/Ointment</option>
                <option value="inhaler">Inhaler</option>
              </select>
            </div>
            <div>
              <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">Quantity</label>
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
              <label htmlFor="days_supply" className="block text-sm font-medium text-gray-700">Days Supply</label>
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
              <label htmlFor="refills_allowed" className="block text-sm font-medium text-gray-700">Refills Allowed</label>
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
            <label htmlFor="directions" className="block text-sm font-medium text-gray-700">Directions (Sig)</label>
            <textarea 
              id="directions"
              name="directions" 
              value={formData.directions} 
              onChange={handleChange} 
              className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
              rows={2} 
              placeholder="Take 1 tablet by mouth twice daily with food"
              required 
            />
          </div>

          <div className="mt-4">
            <label htmlFor="patient_instructions" className="block text-sm font-medium text-gray-700">Patient Instructions</label>
            <textarea 
              id="patient_instructions"
              name="patient_instructions" 
              value={formData.patient_instructions} 
              onChange={handleChange} 
              className="mt-1 w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
              rows={2} 
              placeholder="Complete entire course. Avoid alcohol."
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
              Controlled Substance (Schedule II-V)
            </label>
          </div>

          {formData.is_controlled && (
            <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start">
              <AlertCircle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-yellow-800">
                Controlled substance prescriptions require DEA verification and may have additional restrictions.
              </span>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <button 
            type="submit" 
            disabled={isSubmitting}
            className="flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Send className="h-5 w-5 mr-2" />
            {isSubmitting ? 'Sending...' : 'Send Prescription'}
          </button>
        </div>
      </form>
    </div>
  );
}
