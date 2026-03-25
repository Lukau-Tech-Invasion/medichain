import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MyProfilePage } from './MyProfilePage';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  apiUrl: (path: string) => path,
  addEmergencyContact: vi.fn(),
}));

describe('MyProfilePage (Patient)', () => {
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

    expect(screen.getByText(/Personal Information/i)).toBeInTheDocument();
    
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
      expect(screen.getByText(/Emergency Contacts/i)).toBeInTheDocument();
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

    await waitFor(() => {
      const addButton = screen.getByText(/Add Contact/i);
      fireEvent.click(addButton);
    });

    expect(screen.getByPlaceholderText(/Full Name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Phone Number/i)).toBeInTheDocument();
  });
});
