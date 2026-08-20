import { EmergencyInfo } from '../store';
import { Droplets, Pill, Heart, Phone, AlertTriangle, FileHeart, CheckCircle2, XCircle } from 'lucide-react';

interface EmergencyPatientCardProps {
  patient: EmergencyInfo;
  accessId?: string;
  showFullDetails?: boolean;
}

/**
 * Blood type color mapping
 */
const BLOOD_TYPE_COLORS: Record<string, string> = {
  'O+': 'bg-critical-subtle text-critical-subtle-fg',
  'O-': 'bg-red-200 text-critical-subtle-fg',
  'A+': 'bg-notice-subtle text-notice-subtle-fg',
  'A-': 'bg-blue-200 text-notice-subtle-fg',
  'B+': 'bg-ok-subtle text-ok-subtle-fg',
  'B-': 'bg-green-200 text-ok-subtle-fg',
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
  // Extract optional properties with defaults to avoid undefined errors
  const patientBloodType = patient.bloodType || '';
  const chronicConditions = patient.chronicConditions || [];
  const emergencyContacts = patient.emergencyContacts || [];
  const lastUpdated = patient.lastUpdated || new Date().toISOString();

  const bloodType = formatBloodType(patientBloodType);
  const bloodTypeColor = BLOOD_TYPE_COLORS[bloodType] || 'bg-surface-sunken text-content-secondary';

  return (
    <div className="bg-surface rounded-xl shadow-lg overflow-hidden">
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
        <div className="flex items-center gap-4 p-4 bg-surface-sunken rounded-lg">
          <div className="w-12 h-12 flex items-center justify-center">
            <Droplets className="text-red-500" size={32} />
          </div>
          <div>
            <p className="text-sm text-content-muted">Blood Type</p>
            <span
              className={`inline-block mt-1 px-3 py-1 rounded-full font-bold text-lg ${bloodTypeColor}`}
            >
              {bloodType}
            </span>
          </div>
        </div>

        {/* DNR Status */}
        <div className="flex items-center gap-4 p-4 bg-surface-sunken rounded-lg">
          <div className="w-12 h-12 flex items-center justify-center">
            <FileHeart className={patient.dnrStatus ? 'text-red-500' : 'text-green-500'} size={32} />
          </div>
          <div>
            <p className="text-sm text-content-muted">DNR Status</p>
            <span
              className={`inline-block mt-1 px-3 py-1 rounded-full font-bold ${
                patient.dnrStatus
                  ? 'bg-critical-subtle text-critical-subtle-fg'
                  : 'bg-ok-subtle text-ok-subtle-fg'
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
            <h3 className="font-semibold text-content">Allergies</h3>
          </div>
          {patient.allergies.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {patient.allergies.map((allergy, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-caution-subtle text-caution-subtle-fg rounded-full text-sm font-medium"
                >
                  <AlertTriangle size={12} aria-hidden="true" /> {allergy}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-content-muted text-sm">No known allergies</p>
          )}
        </div>

        {/* Current Medications */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Pill className="text-blue-500" size={20} />
            <h3 className="font-semibold text-content">Current Medications</h3>
          </div>
          {patient.currentMedications.length > 0 ? (
            <ul className="space-y-1">
              {patient.currentMedications.map((med, idx) => (
                <li key={idx} className="text-sm text-content-secondary flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                  {med}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-content-muted text-sm">No current medications</p>
          )}
        </div>

        {/* Chronic Conditions */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Heart className="text-red-500" size={20} />
            <h3 className="font-semibold text-content">Chronic Conditions</h3>
          </div>
          {chronicConditions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {chronicConditions.map((condition, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-critical-subtle text-critical-subtle-fg rounded-full text-sm"
                >
                  {condition}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-content-muted text-sm">No chronic conditions</p>
          )}
        </div>

        {/* Emergency Contacts */}
        {showFullDetails && emergencyContacts.length > 0 && (
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <Phone className="text-green-500" size={20} />
              <h3 className="font-semibold text-content">Emergency Contacts</h3>
            </div>
            <div className="space-y-2">
              {emergencyContacts.map((contact, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
                  <div>
                    <p className="font-medium text-content">{contact.name}</p>
                    <p className="text-sm text-content-muted">{contact.relationship}</p>
                  </div>
                  <a
                    href={`tel:${contact.phone}`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                  >
                    <Phone size={14} aria-hidden="true" /> {contact.phone}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Organ Donor Status */}
        {showFullDetails && (
          <div className="md:col-span-2 flex items-center gap-4 p-4 bg-surface-sunken rounded-lg">
            <div className="w-10 h-10 flex items-center justify-center">
              <Heart className={patient.organDonor ? 'text-pink-500' : 'text-content-muted'} size={24} />
            </div>
            <div>
              <p className="text-sm text-content-muted">Organ Donor Status</p>
              <p className="font-medium inline-flex items-center gap-1.5">
                {patient.organDonor ? (
                  <>
                    <CheckCircle2 size={16} className="text-ok-subtle-fg" aria-hidden="true" /> Registered Organ Donor
                  </>
                ) : (
                  <>
                    <XCircle size={16} className="text-content-muted" aria-hidden="true" /> Not a Registered Donor
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer with timestamp */}
      <div className="px-6 py-4 bg-surface-sunken border-t border-border">
        <p className="text-xs text-content-muted">
          Last updated: {new Date(lastUpdated).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

export default EmergencyPatientCard;
