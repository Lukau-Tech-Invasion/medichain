import { EmergencyInfo } from '../store';
import { Droplets, Pill, Heart, Phone, AlertTriangle, FileHeart } from 'lucide-react';

interface EmergencyPatientCardProps {
  patient: EmergencyInfo;
  accessId?: string;
  showFullDetails?: boolean;
}

/**
 * Blood type color mapping
 */
const BLOOD_TYPE_COLORS: Record<string, string> = {
  'O+': 'bg-red-100 text-red-800',
  'O-': 'bg-red-200 text-red-900',
  'A+': 'bg-blue-100 text-blue-800',
  'A-': 'bg-blue-200 text-blue-900',
  'B+': 'bg-green-100 text-green-800',
  'B-': 'bg-green-200 text-green-900',
  'AB+': 'bg-purple-100 text-purple-800',
  'AB-': 'bg-purple-200 text-purple-900',
};

/**
 * Format blood type display
 */
function formatBloodType(bloodType: string): string {
  const mapping: Record<string, string> = {
    APositive: 'A+',
    ANegative: 'A-',
    BPositive: 'B+',
    BNegative: 'B-',
    ABPositive: 'AB+',
    ABNegative: 'AB-',
    OPositive: 'O+',
    ONegative: 'O-',
  };
  return mapping[bloodType] || bloodType;
}

/**
 * Emergency Patient Card - displays critical medical info
 */
function EmergencyPatientCard({ patient, accessId, showFullDetails = true }: EmergencyPatientCardProps) {
  const bloodType = formatBloodType(patient.bloodType);
  const bloodTypeColor = BLOOD_TYPE_COLORS[bloodType] || 'bg-gray-100 text-gray-800';

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Emergency header */}
      <div className="bg-emergency-500 text-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle size={24} />
            <div>
              <h2 className="font-bold text-lg">Emergency Access Active</h2>
              <p className="text-sm opacity-90">Patient ID: {patient.patientId}</p>
            </div>
          </div>
          {accessId && (
            <div className="text-right text-sm">
              <p className="opacity-75">Access ID</p>
              <p className="font-mono">{accessId}</p>
            </div>
          )}
        </div>
      </div>

      {/* Critical info grid */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Blood Type - CRITICAL */}
        <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
          <div className="w-12 h-12 flex items-center justify-center">
            <Droplets className="text-red-500" size={32} />
          </div>
          <div>
            <p className="text-sm text-gray-500">Blood Type</p>
            <span
              className={`inline-block mt-1 px-3 py-1 rounded-full font-bold text-lg ${bloodTypeColor}`}
            >
              {bloodType}
            </span>
          </div>
        </div>

        {/* DNR Status */}
        <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
          <div className="w-12 h-12 flex items-center justify-center">
            <FileHeart className={patient.dnrStatus ? 'text-red-500' : 'text-green-500'} size={32} />
          </div>
          <div>
            <p className="text-sm text-gray-500">DNR Status</p>
            <span
              className={`inline-block mt-1 px-3 py-1 rounded-full font-bold ${
                patient.dnrStatus
                  ? 'bg-red-100 text-red-800'
                  : 'bg-green-100 text-green-800'
              }`}
            >
              {patient.dnrStatus ? 'DNR Active' : 'Full Code'}
            </span>
          </div>
        </div>

        {/* Allergies - CRITICAL */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-amber-500" size={20} />
            <h3 className="font-semibold text-gray-900">Allergies</h3>
          </div>
          {patient.allergies.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {patient.allergies.map((allergy, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm font-medium"
                >
                  ⚠️ {allergy}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No known allergies</p>
          )}
        </div>

        {/* Current Medications */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Pill className="text-blue-500" size={20} />
            <h3 className="font-semibold text-gray-900">Current Medications</h3>
          </div>
          {patient.currentMedications.length > 0 ? (
            <ul className="space-y-1">
              {patient.currentMedications.map((med, idx) => (
                <li key={idx} className="text-sm text-gray-700 flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                  {med}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-sm">No current medications</p>
          )}
        </div>

        {/* Chronic Conditions */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Heart className="text-red-500" size={20} />
            <h3 className="font-semibold text-gray-900">Chronic Conditions</h3>
          </div>
          {patient.chronicConditions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {patient.chronicConditions.map((condition, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm"
                >
                  {condition}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No chronic conditions</p>
          )}
        </div>

        {/* Emergency Contacts */}
        {showFullDetails && patient.emergencyContacts.length > 0 && (
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <Phone className="text-green-500" size={20} />
              <h3 className="font-semibold text-gray-900">Emergency Contacts</h3>
            </div>
            <div className="space-y-2">
              {patient.emergencyContacts.map((contact, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{contact.name}</p>
                    <p className="text-sm text-gray-500">{contact.relationship}</p>
                  </div>
                  <a
                    href={`tel:${contact.phone}`}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                  >
                    📞 {contact.phone}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Organ Donor Status */}
        {showFullDetails && (
          <div className="md:col-span-2 flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
            <div className="w-10 h-10 flex items-center justify-center">
              <Heart className={patient.organDonor ? 'text-pink-500' : 'text-gray-400'} size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Organ Donor Status</p>
              <p className="font-medium">
                {patient.organDonor ? '✅ Registered Organ Donor' : '❌ Not a Registered Donor'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer with timestamp */}
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Last updated: {new Date(patient.lastUpdated).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

export default EmergencyPatientCard;
