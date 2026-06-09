import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider, ToastProvider } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EmergencyCardPage } from './EmergencyCardPage';

// Generate a deterministic data URL so the QR <img> renders predictably.
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QRMOCK'),
  },
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderPage() {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <I18nProvider>
        <ToastProvider>
          <EmergencyCardPage />
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>,
  );
}

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
              relationship: 'Wife',
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
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Test Patient/i)).toBeInTheDocument();
      expect(screen.getByText(/O\+/i)).toBeInTheDocument();
      expect(screen.getByText(/Asthma/i)).toBeInTheDocument();
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
    });
  });

  it('renders a real scannable QR code image', async () => {
    renderPage();

    await waitFor(() => {
      const img = screen.getByRole('img', { name: /emergency medical qr code/i });
      expect(img).toHaveAttribute('src', 'data:image/png;base64,QRMOCK');
    });
  });

  it('shows critical medical info including allergies', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Peanuts/i)).toBeInTheDocument();
    });
  });
});
