import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AppointmentsPage } from './AppointmentsPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AppointmentsPage (Patient)', () => {
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
      if (url.includes('/api/appointments/patient/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            appointments: [
              {
                appointment_id: 'app1',
                type: 'in-person',
                status: 'scheduled',
                provider_name: 'Dr. Jones',
                specialty: 'Cardiology',
                scheduled_date: '2025-05-20',
                scheduled_time: '10:00 AM',
                duration_minutes: 30,
                location: 'Room 302',
                reason: 'Follow-up',
              },
              {
                appointment_id: 'app2',
                type: 'telehealth',
                status: 'completed',
                provider_name: 'Dr. Smith',
                specialty: 'General',
                scheduled_date: '2025-01-10',
                scheduled_time: '2:00 PM',
                duration_minutes: 15,
                reason: 'Cold symptoms',
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

  it('renders appointments page with upcoming appointments', async () => {
    render(
      <MemoryRouter>
        <AppointmentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Appointments/i)).toBeInTheDocument();
      expect(screen.getByText(/Dr. Jones/i)).toBeInTheDocument();
      expect(screen.getByText(/Follow-up/i)).toBeInTheDocument();
      expect(screen.getByText(/Cardiology/i)).toBeInTheDocument();
    });
  });

  it('allows switching to past appointments tab', async () => {
    render(
      <MemoryRouter>
        <AppointmentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Upcoming/i)).toBeInTheDocument();
    });

    const pastTab = screen.getByText(/Past/i);
    fireEvent.click(pastTab);
    
    await waitFor(() => {
      expect(screen.getByText(/Dr. Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Cold symptoms/i)).toBeInTheDocument();
      expect(screen.queryByText(/Dr. Jones/i)).not.toBeInTheDocument();
    });
  });

  it('shows no appointments message when list is empty', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ appointments: [] }),
    }));

    render(
      <MemoryRouter>
        <AppointmentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/No upcoming appointments/i)).toBeInTheDocument();
    });
  });
});
