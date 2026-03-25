import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SymptomTrackerPage } from './SymptomTrackerPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SymptomTrackerPage (Patient)', () => {
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
      if (url.includes('/api/symptoms/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            entries: [
              {
                id: 'sym1',
                symptom: 'Headache',
                category: 'Pain',
                severity: 3,
                timestamp: new Date().toISOString(),
                notes: 'Morning headache',
              }
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders symptom tracker page with entries', async () => {
    render(
      <MemoryRouter>
        <SymptomTrackerPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Symptom Tracker/i)).toBeInTheDocument();
      expect(screen.getByText(/Headache/i)).toBeInTheDocument();
      expect(screen.getByText(/Morning headache/i)).toBeInTheDocument();
    });
  });

  it('allows opening the add symptom modal', async () => {
    render(
      <MemoryRouter>
        <SymptomTrackerPage />
      </MemoryRouter>
    );

    const addButton = screen.getByText(/Log Symptom/i);
    fireEvent.click(addButton);

    expect(screen.getByText(/Select Category/i)).toBeInTheDocument();
    expect(screen.getByText(/Pain/i)).toBeInTheDocument();
    expect(screen.getByText(/Respiratory/i)).toBeInTheDocument();
  });
});
