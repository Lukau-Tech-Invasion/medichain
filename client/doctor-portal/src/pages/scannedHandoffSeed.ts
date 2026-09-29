import type { EmergencyInfo } from '../store/patientStore';

/** Build a handover draft from an unexpired scan; never invent observations. */
export function scannedHandoffSeed(state: {
  currentEmergency: EmergencyInfo | null;
  emergencyExpiresAt: Date | null;
}, now = Date.now()) {
  const patient = state.currentEmergency;
  const expiry = state.emergencyExpiresAt?.getTime();
  if (!patient || !expiry || expiry <= now) return { patientId: '', sample: {} };
  return {
    patientId: patient.patientId,
    sample: {
      allergies: patient.allergies.join('; '),
      medications: patient.currentMedications.join('; '),
      past_history: (patient.chronicConditions ?? patient.medicalConditions ?? []).join('; '),
    },
  };
}
