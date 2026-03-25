import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EmergencyCardPage } from './EmergencyCardPage';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('EmergencyCardPage (Patient)', () => {
  const mockPatientId = 'HEALTH123';

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock localStorage
    const authData = JSON.stringify({ patientId: mockPatientId });
    localStorage.getItem = vi.fn().mockReturnValue(authData);

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          patient_id: 'HEALTH123',
          full_name: 'Test Patient',
          date_of_birth: '1990-01-01',
          emergency_info: {
            blood_type: 'O+',
            allergies: [{ name: 'Peanuts' }],
            chronic_conditions: ['Asthma'],
            current_medications: ['Inhaler'],
            emergency_contacts: [{
              name: 'Jane Doe',
              phone: '+123456789',
              relationship: 'Wife'
            }],
            organ_donor: true,
            dnr_status: false,
          },
          last_updated: '2025-01-01',
        }),
      });
    });
  });

  it('renders emergency card with patient information', async () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <EmergencyCardPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Emergency Card/i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText(/Test Patient/i)).toBeInTheDocument();
      expect(screen.getByText(/O\+/i)).toBeInTheDocument();
      expect(screen.getByText(/Asthma/i)).toBeInTheDocument();
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
    });
  });

  it('displays QR code placeholder', async () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <EmergencyCardPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Scan for emergency medical access/i)).toBeInTheDocument();
    });
  });

  it('shows medical alerts for critical conditions', async () => {
    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <EmergencyCardPage />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Medical Alerts/i)).toBeInTheDocument();
      expect(screen.getByText(/Peanuts/i)).toBeInTheDocument();
    });
  });
});
