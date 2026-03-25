import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MedicationsPage } from './MedicationsPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MedicationsPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/e-prescriptions/patient/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            prescriptions: [
              {
                prescription_id: 'med1',
                medication_name: 'Aspirin',
                dosage: '100mg',
                frequency: 'Once daily',
                prescriber_id: 'Dr. House',
                prescribed_at: '2025-01-01',
                status: 'active',
                instructions: 'Take with food',
                side_effects: ['Stomach upset'],
                interactions: ['Ibuprofen'],
              }
            ],
          }),
        });
      }
      if (url.includes('/api/medication-reminders/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ reminders: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders medications page with current medications', async () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Medications/i)).toBeInTheDocument();
      expect(screen.getByText(/Aspirin/i)).toBeInTheDocument();
      expect(screen.getByText(/Take with food/i)).toBeInTheDocument();
    });
  });

  it('allows switching to reminders tab', async () => {
    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Current/i)).toBeInTheDocument();
    });

    const remindersTab = screen.getByText(/Reminders/i);
    fireEvent.click(remindersTab);
    
    await waitFor(() => {
      expect(screen.getByText(/Medication Reminders/i)).toBeInTheDocument();
      expect(screen.getByText(/No more reminders for today/i)).toBeInTheDocument();
    });
  });

  it('shows no medications message when list is empty', async () => {
    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/e-prescriptions/patient/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ prescriptions: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(
      <MemoryRouter>
        <MedicationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/No current medications found/i)).toBeInTheDocument();
    });
  });
});
