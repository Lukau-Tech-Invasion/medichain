import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmergencyAccessPage from './EmergencyAccessPage';
import { usePatientStore } from '../store';

// Mock the components
vi.mock('../components', () => ({
  NFCTapSimulator: ({ onEmergencyAccess }: { onEmergencyAccess: Function }) => (
    <div data-testid="nfc-simulator">
      <button onClick={() => onEmergencyAccess({ patientId: 'PAT-123', emergencyInfo: {} })}>
        Simulate NFC Tap
      </button>
    </div>
  ),
  EmergencyPatientCard: ({ patient }: { patient: any }) => (
    <div data-testid="emergency-card">
      <p>{patient.fullName || patient.full_name}</p>
      <p>{patient.patientId || patient.patient_id}</p>
    </div>
  ),
}));

vi.mock('../store', () => ({
  usePatientStore: vi.fn(),
}));

describe('EmergencyAccessPage', () => {
  const mockEmergencyPatient = {
    patientId: 'PAT-123',
    fullName: 'Emergency Patient',
    bloodType: 'O-',
    allergies: ['Latex'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders instructions when no emergency patient is active', () => {
    (usePatientStore as any).mockReturnValue({
      currentEmergency: null,
      clearEmergencyAccess: vi.fn(),
    });

    render(<EmergencyAccessPage />);

    expect(screen.getByText(/Emergency Access/i)).toBeInTheDocument();
    expect(screen.getByText(/How to Access Emergency Records/i)).toBeInTheDocument();
    expect(screen.getByTestId('nfc-simulator')).toBeInTheDocument();
  });

  it('renders patient card and timer when emergency patient is active', () => {
    (usePatientStore as any).mockReturnValue({
      currentEmergency: mockEmergencyPatient,
      clearEmergencyAccess: vi.fn(),
    });

    render(<EmergencyAccessPage />);

    expect(screen.getByTestId('emergency-card')).toBeInTheDocument();
    expect(screen.getByText('Emergency Patient')).toBeInTheDocument();
    expect(screen.getByText(/Access Time Remaining/i)).toBeInTheDocument();
  });

  it('allows clearing emergency access', () => {
    const clearEmergencyAccess = vi.fn();
    (usePatientStore as any).mockReturnValue({
      currentEmergency: mockEmergencyPatient,
      clearEmergencyAccess,
    });

    render(<EmergencyAccessPage />);

    const endAccessButton = screen.getByText(/End Access/i);
    fireEvent.click(endAccessButton);

    expect(clearEmergencyAccess).toHaveBeenCalled();
  });
});
