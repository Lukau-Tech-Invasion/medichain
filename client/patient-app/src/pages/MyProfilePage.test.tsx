import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MyProfilePage } from './MyProfilePage';
import { usePatientAuthStore } from '../store/authStore';

vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiUrl: (path: string) => path,
  addEmergencyContact: vi.fn(),
}));

describe('MyProfilePage (Patient)', () => {
  const mockPatientId = 'HEALTH123';

  beforeEach(() => {
    vi.clearAllMocks();

    (usePatientAuthStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: unknown) => unknown) => selector({
        patient: {
          healthId: mockPatientId,
          walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
        },
      }),
    );

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({
          patient_id: 'HEALTH123',
          full_name: 'Test Patient',
          date_of_birth: '1990-01-01',
          national_id: 'ID12345',
          emergency_info: {
            blood_type: 'O+',
            allergies: [{ name: 'Peanuts' }],
            chronic_conditions: ['Asthma'],
            current_medications: ['Inhaler'],
            emergency_contacts: [
              { name: 'Jane Doe', phone: '555-1212', relationship: 'Wife' }
            ],
            organ_donor: true,
            dnr_status: false,
          },
          last_updated: '2025-01-01',
        }),
      });
    });
  });

  it('renders my profile page with patient information', async () => {
    render(
      <MemoryRouter>
        <MyProfilePage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText(/Personal Information/i)).toBeInTheDocument()
    );

    await waitFor(() => {
      expect(screen.getByText(/Test Patient/i)).toBeInTheDocument();
      expect(screen.getByText(/ID12345/i)).toBeInTheDocument();
      expect(screen.getByText(/O\+/i)).toBeInTheDocument();
    });
  });

  it('displays emergency contacts', async () => {
    render(
      <MemoryRouter>
        <MyProfilePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Emergency Contacts/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/Wife/i)).toBeInTheDocument();
    });
  });

  it('allows opening the add contact form', async () => {
    render(
      <MemoryRouter>
        <MyProfilePage />
      </MemoryRouter>
    );

    // 'Add Emergency Contact' is the section heading; the control that opens
    // the form is a button labelled just 'Add'.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Add$/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));

    // The form opens asynchronously after the click inside waitFor above; the
    // placeholders are the example values, not the field names.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Jane Doe/i)).toBeInTheDocument()
    );
    expect(screen.getByPlaceholderText(/801-234-5678/i)).toBeInTheDocument();
  });
});
