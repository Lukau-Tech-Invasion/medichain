import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TriagePage from './TriagePage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TriagePage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          triage_queue: [
            {
              id: 't1',
              patientName: 'Alice Smith',
              arrivalTime: new Date().toISOString(),
              acuity: 1, // Resuscitation
              complaint: 'Chest Pain',
            },
            {
              id: 't2',
              patientName: 'Bob Jones',
              arrivalTime: new Date().toISOString(),
              acuity: 3, // Urgent
              complaint: 'Abdominal Pain',
            }
          ],
        }),
      });
    });
  });

  it('renders triage page with queue', async () => {
    render(
      <MemoryRouter>
        <TriagePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Emergency Triage/i)).toBeInTheDocument();
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Bob Jones/i)).toBeInTheDocument();
    });
  });

  it('displays acuity levels', async () => {
    render(
      <MemoryRouter>
        <TriagePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Chest Pain/i)).toBeInTheDocument();
      expect(screen.getByText(/1 - Resuscitation/i)).toBeInTheDocument();
    });
  });

  it('allows selecting a patient for triage', async () => {
    render(
      <MemoryRouter>
        <TriagePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const patient = screen.getByText(/Alice Smith/i);
      fireEvent.click(patient);
    });

    await waitFor(() => {
      expect(screen.getByText(/Triage Assessment/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Primary Complaint/i)).toBeInTheDocument();
    });
  });
});
