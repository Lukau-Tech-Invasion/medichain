import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AppointmentsPage } from './AppointmentsPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

const getProvidersMock = vi.fn().mockResolvedValue({
  success: true,
  providers: [{ provider_id: 'DOC-001', name: 'Dr Test Provider', specialty: 'General' }],
  count: 1,
});

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setAppointmentStatus: vi.fn().mockResolvedValue({ success: true }),
  getProviders: (...args: unknown[]) => getProvidersMock(...args),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

/** The page needs a router: it redirects unauthenticated visitors. */
const renderPage = () =>
  render(
    <MemoryRouter>
      <AppointmentsPage />
    </MemoryRouter>
  );

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
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            appointments: [
              {
                appointment_id: 'app1',
                type: 'in-person',
                status: 'scheduled',
                // A booking is a proposal until both sides agree, so Confirm
                // and Decline only render for the side whose turn it is. This
                // fixture predated two-sided confirmation and left the field
                // absent, which maps to null — nobody's turn, no buttons.
                awaiting_confirmation_from: 'patient',
                provider_name: 'Dr. Jones',
                specialty: 'Cardiology',
                scheduled_date: new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0],
                scheduled_time: '10:00 AM',
                duration_minutes: 30,
                location: 'Room 302',
                reason: 'Follow-up',
              },
              {
                appointment_id: 'app2',
                appointment_type: 'Telehealth',
                is_telehealth: true,
                status: 'Completed',
                provider_name: 'Dr. Smith',
                specialty: 'General',
                scheduled_date: new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0],
                start_time: '2:00 PM',
                scheduled_time: 1787655600,
                duration_minutes: 15,
                visit_reason: 'Cold symptoms',
              }
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
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
      expect(screen.getAllByText(/Appointments/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Dr. Jones/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Follow-up/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Cardiology/i).length).toBeGreaterThan(0);
    });
  });

  it('allows switching to past appointments tab', async () => {
    render(
      <MemoryRouter>
        <AppointmentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Upcoming/i).length).toBeGreaterThan(0);
    });

    const pastTab = screen.getByText(/Past/i);
    fireEvent.click(pastTab);
    
    await waitFor(() => {
      expect(screen.getByText(/Dr. Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Cold symptoms/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Dr. Smith/i).length).toBeGreaterThan(0);
    });
  });

  it('shows no appointments message when list is empty', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
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

  /**
   * These four controls rendered as ordinary buttons with no onClick at all -
   * Book, Confirm, Reschedule and Join video (docs/WORKFLOW_AUDIT.md, WF-012).
   * A patient could press any of them and nothing whatsoever happened.
   */
  describe('the controls that used to do nothing', () => {
    it('confirms an appointment through the API', async () => {
      const shared = await import('@medichain/shared');
      renderPage();

      const confirm = await screen.findByRole('button', { name: /^Confirm$/i });
      fireEvent.click(confirm);

      await waitFor(() =>
        expect(shared.setAppointmentStatus).toHaveBeenCalledWith(
          expect.any(String),
          'confirmed',
          undefined
        )
      );
    });

    it('sends the patient to telehealth rather than nowhere', async () => {
      renderPage();
      const telehealth = await screen.findByRole('button', { name: /Virtual visit|Telehealth/i });
      expect(telehealth).not.toBeDisabled();
    });

    /**
     * Booking used to have no patient-facing screen, so the tile was disabled
     * on purpose (WF-012) and this test asserted that. The flow now exists: the
     * tile opens a real booking panel that loads bookable providers. Asserting
     * the old disabled state would now be asserting that a shipped feature is
     * missing.
     */
    it('opens the booking flow and offers real providers', async () => {
      renderPage();
      const book = await screen.findByRole('button', { name: /Book|Call your clinic/i });
      expect(book).toBeEnabled();

      fireEvent.click(book);

      // The panel loads the bookable provider directory rather than presenting
      // a form that cannot be submitted against anyone.
      await waitFor(() => expect(getProvidersMock).toHaveBeenCalled());
    });

    /**
     * No session is created for an appointment yet (WF-014), so a Join button
     * would be claiming a meeting exists when none does.
     */
    it('does not offer Join until a session link actually exists', async () => {
      renderPage();
      await screen.findByText(/Test Provider|Appointments/i);
      expect(screen.queryByRole('link', { name: /Join/i })).not.toBeInTheDocument();
    });
  });
});
