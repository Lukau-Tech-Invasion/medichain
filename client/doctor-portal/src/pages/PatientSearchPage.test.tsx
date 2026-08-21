import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PatientSearchPage from './PatientSearchPage';
import { useAuthStore, usePatientStore } from '../store';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
  usePatientStore: vi.fn(),
}));

describe('PatientSearchPage', () => {
  // Mirrors `PatientProfile` in `api/src/types/domain.rs`: blood type,
  // allergies, medications and conditions all live under `emergency_info`, not
  // at the top level. This fixture had them flat, so `emergency_info?.blood_type`
  // read back undefined, every patient's blood type became "Unknown", and the
  // blood-type filter matched nobody — a working filter looking broken.
  //
  // `blood_type` is the wire format too: `BloodType` serializes through its
  // `Display` impl, so the JSON carries "A+"/"O+" rather than the Rust variant
  // names `APositive`/`OPositive`.
  const mockPatients = [
    {
      patient_id: 'PAT-001',
      health_id: 'HID-001',
      full_name: 'John Doe',
      date_of_birth: '1980-01-01',
      gender: 'Male',
      national_id: 'NAT-001',
      emergency_info: {
        blood_type: 'O+',
        allergies: [{ name: 'Peanuts' }],
        current_medications: [],
        chronic_conditions: [],
      },
    },
    {
      patient_id: 'PAT-002',
      health_id: 'HID-002',
      full_name: 'Jane Smith',
      date_of_birth: '1990-05-15',
      gender: 'Female',
      national_id: 'NAT-002',
      emergency_info: {
        blood_type: 'A+',
        allergies: [],
        current_medications: ['Insulin'],
        chronic_conditions: ['Diabetes'],
      },
    }
  ];

  const mockSetSearchResults = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: { walletAddress: '0x123', role: 'Doctor' },
      isAuthenticated: true,
    });
    (usePatientStore as any).mockReturnValue({
      searchResults: [],
      setSearchResults: mockSetSearchResults,
      addToRecentPatients: vi.fn(),
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockPatients,
    });
  });

  it('renders search page and fetches patients', async () => {
    render(
      <MemoryRouter>
        <PatientSearchPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Patient Search/i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  it('performs search and updates store', async () => {
    render(
      <MemoryRouter>
        <PatientSearchPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('John Doe')).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/Search by name/i);
    fireEvent.change(input, { target: { value: 'John' } });
    
    const form = screen.getByRole('textbox').closest('form');
    fireEvent.submit(form!);

    expect(mockSetSearchResults).toHaveBeenCalled();
    const callArgs = mockSetSearchResults.mock.calls[0][0];
    expect(callArgs).toHaveLength(1);
    expect(callArgs[0].fullName).toBe('John Doe');
  });

  it('filters by blood type', async () => {
    render(
      <MemoryRouter>
        <PatientSearchPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('John Doe')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Filters/i));
    
    const bloodTypeSelect = screen.getByDisplayValue(/All Blood Types/i);
    fireEvent.change(bloodTypeSelect, { target: { value: 'A+' } });

    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });
});
