import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { 
  UserPlus, 
  CheckCircle, 
  AlertTriangle,
  Loader2
} from 'lucide-react';

interface FormData {
  fullName: string;
  dateOfBirth: string;
  nationalId: string;
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
  dateOfBirth: '',
  nationalId: '',
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

function RegisterPatientPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ patientId: string; nfcTagId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user?.userId || '',
        },
        body: JSON.stringify({
          full_name: formData.fullName,
          date_of_birth: formData.dateOfBirth,
          national_id: formData.nationalId,
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      setSuccess({
        patientId: data.patient_id,
        nfcTagId: data.nfc_tag_id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="p-8">
        <div className="max-w-lg mx-auto bg-white rounded-xl shadow p-8 text-center">
          <div className="w-16 h-16 bg-success-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="text-success-600" size={32} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Patient Registered!</h2>
          <p className="text-gray-500 mb-6">
            The patient has been successfully added to MediChain.
          </p>
          
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Patient ID</p>
                <p className="font-mono font-medium">{success.patientId}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">NFC Tag ID</p>
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
              className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Register Another
            </button>
            <button
              onClick={() => navigate(`/patients/${success.patientId}`)}
              className="flex-1 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              View Patient
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
          <h1 className="text-2xl font-bold text-gray-900">Register New Patient</h1>
        </div>
        <p className="text-gray-500">
          Add a new patient to the MediChain network. An NFC card will be provisioned automatically.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-emergency-50 border border-emergency-200 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="text-emergency-600" size={20} />
          <p className="text-emergency-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-3xl">
        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Personal Information</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="John Doe"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
              <input
                type="date"
                name="dateOfBirth"
                value={formData.dateOfBirth}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">National ID *</label>
              <input
                type="text"
                name="nationalId"
                value={formData.nationalId}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="NIN-12345678901"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Blood Type *</label>
              <select
                name="bloodType"
                value={formData.bloodType}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                <option value="">Select blood type</option>
                {bloodTypes.map(bt => (
                  <option key={bt} value={bt}>{bt}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Medical Information</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Allergies <span className="text-gray-400">(comma-separated)</span>
              </label>
              <input
                type="text"
                name="allergies"
                value={formData.allergies}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="Penicillin, Sulfa drugs"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Current Medications <span className="text-gray-400">(comma-separated)</span>
              </label>
              <textarea
                name="currentMedications"
                value={formData.currentMedications}
                onChange={handleChange}
                rows={2}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
                placeholder="Metformin 500mg - twice daily, Lisinopril 10mg - once daily"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Chronic Conditions <span className="text-gray-400">(comma-separated)</span>
              </label>
              <input
                type="text"
                name="chronicConditions"
                value={formData.chronicConditions}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="Type 2 Diabetes, Hypertension"
              />
            </div>

            <div className="flex gap-6 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="organDonor"
                  checked={formData.organDonor}
                  onChange={handleChange}
                  className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">Organ Donor</span>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="dnrStatus"
                  checked={formData.dnrStatus}
                  onChange={handleChange}
                  className="w-4 h-4 text-emergency-600 rounded focus:ring-emergency-500"
                />
                <span className="text-sm text-gray-700">Do Not Resuscitate (DNR)</span>
              </label>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Emergency Contact</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name *</label>
              <input
                type="text"
                name="emergencyContactName"
                value={formData.emergencyContactName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="Jane Doe"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
              <input
                type="tel"
                name="emergencyContactPhone"
                value={formData.emergencyContactPhone}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="+234-801-234-5678"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Relationship *</label>
              <input
                type="text"
                name="emergencyContactRelationship"
                value={formData.emergencyContactRelationship}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="Spouse"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Registering...
              </>
            ) : (
              <>
                <UserPlus size={20} />
                Register Patient
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default RegisterPatientPage;
