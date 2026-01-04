import { create } from 'zustand';

/**
 * Emergency info from NFC tap
 */
export interface EmergencyInfo {
  patientId: string;
  bloodType: string;
  allergies: string[];
  currentMedications: string[];
  chronicConditions: string[];
  emergencyContacts: {
    name: string;
    phone: string;
    relationship: string;
  }[];
  organDonor: boolean;
  dnrStatus: boolean;
  lastUpdated: string;
}

/**
 * Patient store state
 */
interface PatientState {
  // Current emergency access patient
  currentEmergency: EmergencyInfo | null;
  emergencyAccessId: string | null;
  emergencyTimestamp: Date | null;

  // Patient search
  searchQuery: string;
  searchResults: EmergencyInfo[];
  isSearching: boolean;

  // Recent accesses
  recentPatients: EmergencyInfo[];

  // Actions
  setEmergencyAccess: (info: EmergencyInfo, accessId: string) => void;
  clearEmergencyAccess: () => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: EmergencyInfo[]) => void;
  setSearching: (isSearching: boolean) => void;
  addToRecentPatients: (patient: EmergencyInfo) => void;
}

/**
 * Maximum recent patients to store
 */
const MAX_RECENT_PATIENTS = 10;

/**
 * Patient store
 */
export const usePatientStore = create<PatientState>()((set, get) => ({
  currentEmergency: null,
  emergencyAccessId: null,
  emergencyTimestamp: null,
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  recentPatients: [],

  setEmergencyAccess: (info: EmergencyInfo, accessId: string) => {
    set({
      currentEmergency: info,
      emergencyAccessId: accessId,
      emergencyTimestamp: new Date(),
    });

    // Also add to recent patients
    get().addToRecentPatients(info);
  },

  clearEmergencyAccess: () => {
    set({
      currentEmergency: null,
      emergencyAccessId: null,
      emergencyTimestamp: null,
    });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setSearchResults: (results: EmergencyInfo[]) => {
    set({ searchResults: results, isSearching: false });
  },

  setSearching: (isSearching: boolean) => {
    set({ isSearching });
  },

  addToRecentPatients: (patient: EmergencyInfo) => {
    const { recentPatients } = get();

    // Remove if already exists
    const filtered = recentPatients.filter((p) => p.patientId !== patient.patientId);

    // Add to front and limit size
    const updated = [patient, ...filtered].slice(0, MAX_RECENT_PATIENTS);

    set({ recentPatients: updated });
  },
}));
