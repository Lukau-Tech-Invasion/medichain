import { describe, it, expect, beforeEach } from 'vitest';
import { usePatientStore, EmergencyInfo } from './patientStore';

describe('patientStore', () => {
  beforeEach(() => {
    usePatientStore.setState({
      currentEmergency: null,
      emergencyAccessId: null,
      emergencyTimestamp: null,
      searchQuery: '',
      searchResults: [],
      isSearching: false,
      recentPatients: [],
    });
  });

  const mockPatient: EmergencyInfo = {
    patientId: 'PAT-001',
    fullName: 'Test Patient',
    bloodType: 'O+',
    allergies: ['Peanuts'],
    currentMedications: [],
  };

  it('should initialize with default values', () => {
    const state = usePatientStore.getState();
    expect(state.currentEmergency).toBeNull();
    expect(state.recentPatients).toEqual([]);
  });

  it('should set emergency access and add to recent patients', () => {
    usePatientStore.getState().setEmergencyAccess(mockPatient, 'ACCESS-123');

    const state = usePatientStore.getState();
    expect(state.currentEmergency).toEqual(mockPatient);
    expect(state.emergencyAccessId).toBe('ACCESS-123');
    expect(state.recentPatients).toHaveLength(1);
    expect(state.recentPatients[0]).toEqual(mockPatient);
  });

  it('should clear emergency access', () => {
    usePatientStore.setState({
      currentEmergency: mockPatient,
      emergencyAccessId: 'ACCESS-123',
    });

    usePatientStore.getState().clearEmergencyAccess();

    const state = usePatientStore.getState();
    expect(state.currentEmergency).toBeNull();
    expect(state.emergencyAccessId).toBeNull();
  });

  it('should limit recent patients to MAX_RECENT_PATIENTS (10)', () => {
    const store = usePatientStore.getState();
    
    // Add 11 unique patients
    for (let i = 1; i <= 11; i++) {
      store.addToRecentPatients({ ...mockPatient, patientId: `PAT-${i}` });
    }

    const state = usePatientStore.getState();
    expect(state.recentPatients).toHaveLength(10);
    // Most recent should be PAT-11
    expect(state.recentPatients[0].patientId).toBe('PAT-11');
    // Oldest PAT-1 should be gone
    expect(state.recentPatients.find(p => p.patientId === 'PAT-1')).toBeUndefined();
  });

  it('should update search state', () => {
    const store = usePatientStore.getState();
    
    store.setSearchQuery('test query');
    expect(usePatientStore.getState().searchQuery).toBe('test query');

    store.setSearching(true);
    expect(usePatientStore.getState().isSearching).toBe(true);

    store.setSearchResults([mockPatient]);
    expect(usePatientStore.getState().searchResults).toEqual([mockPatient]);
    expect(usePatientStore.getState().isSearching).toBe(false);
  });
});
