import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AppointmentSchedulerPage from './AppointmentSchedulerPage';
import { useAuthStore } from '../store/authStore';
import * as endpoints from '../../../shared/src/api/endpoints';

// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module leaves
// those undefined — which surfaces as "Element type is invalid".
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

vi.mock('../../../shared/src/api/endpoints', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAppointment: vi.fn(),
  setAppointmentStatus: vi.fn(),
}));

vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

/** The booking form is collapsed until 'New Appointment' is clicked. */
const openForm = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /New Appointment/i }));
};

describe('AppointmentSchedulerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The page reads identity through useCurrentProvider, which selects from
    // the store, so the mock has to answer selector calls rather than return a
    // fixed object.
    const state = {
      user: {
        walletAddress: '5GrwvaEF...mock',
        userId: '5GrwvaEF...mock',
        username: 'Dr. Thabo Mbeki',
        role: 'Doctor',
        department: 'Emergency',
      },
      isAuthenticated: true,
      identityHydrated: true,
    };
    (useAuthStore as any).mockImplementation((sel?: (s: unknown) => unknown) =>
      typeof sel === 'function' ? sel(state) : state
    );
    (endpoints.createAppointment as any).mockResolvedValue({ success: true });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ appointments: [] }),
    });
  });

  it('renders the booking form', async () => {
    render(<AppointmentSchedulerPage />);
    await openForm();

    await waitFor(() =>
      expect(screen.getByLabelText(/Appointment Type/i)).toBeInTheDocument()
    );
  });

  /**
   * `appointment_type` was fixed at 'consultation' in initial state with no
   * control, so every appointment booked through this page was filed as a
   * consultation whatever it actually was — and the scheduler then displayed
   * that back as if it were recorded fact.
   */
  it('lets the clinician choose the appointment type', async () => {
    render(<AppointmentSchedulerPage />);
    await openForm();

    const type = await screen.findByLabelText(/Appointment Type/i);
    expect(type).toHaveValue('consultation');

    fireEvent.change(type, { target: { value: 'antenatal' } });
    expect(type).toHaveValue('antenatal');
  });

  it('offers the visit types this service actually books', async () => {
    render(<AppointmentSchedulerPage />);
    await openForm();

    const type = (await screen.findByLabelText(/Appointment Type/i)) as HTMLSelectElement;
    const values = Array.from(type.options).map((o) => o.value);

    expect(values).toContain('follow-up');
    expect(values).toContain('vaccination');
    expect(values).toContain('antenatal');
    expect(values).toContain('telehealth');
  });

  /**
   * The defect this page was rebuilt for: a signed-in doctor was asked to type
   * their own 48-character SS58 address into a required "Provider ID" box. The
   * server now derives the provider from the session, so the field must not
   * come back.
   */
  it('never asks the signed-in clinician for a provider id', async () => {
    render(<AppointmentSchedulerPage />);
    await openForm();

    expect(screen.queryByLabelText(/provider id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/wallet/i)).not.toBeInTheDocument();
  });

  it('says whose schedule this is instead of asking', async () => {
    render(<AppointmentSchedulerPage />);
    expect(await screen.findByText(/Dr\. Thabo Mbeki's schedule/i)).toBeInTheDocument();
  });

  it('does not send a provider_id, leaving the server to derive it', async () => {
    render(<AppointmentSchedulerPage />);
    await openForm();

    fireEvent.change(await screen.findByLabelText(/Appointment Type/i), {
      target: { value: 'telehealth' },
    });
    fireEvent.change(screen.getByLabelText(/^Date$/i), { target: { value: '2099-01-01' } });
    fireEvent.change(screen.getByLabelText(/^Time$/i), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'Review' } });
    // Submit the form directly: jsdom enforces `required` on a submit-button
    // click, and PatientSelect's value is set through its own control rather
    // than a plain input, so the click would never reach handleSubmit here.
    fireEvent.submit(screen.getByRole('button', { name: /^Book/i }).closest('form')!);

    await waitFor(() => expect(endpoints.createAppointment).toHaveBeenCalled());
    const sent = (endpoints.createAppointment as any).mock.calls[0][0];
    expect(sent).not.toHaveProperty('provider_id');
    expect(sent.appointment_type).toBe('telehealth');
  });

  it('separates the day into Today, Upcoming, Previous and Cancelled', async () => {
    render(<AppointmentSchedulerPage />);
    for (const tab of ['Today', 'Upcoming', 'Previous', 'Cancelled']) {
      expect(await screen.findByRole('tab', { name: new RegExp(tab, 'i') })).toBeInTheDocument();
    }
  });

  /**
   * A failed load must not render as "nothing scheduled" — that is how a
   * clinician misses a day's work.
   */
  it('shows an error with a retry when the schedule cannot be loaded', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    render(<AppointmentSchedulerPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing scheduled for today/i)).not.toBeInTheDocument();
  });

  it('offers only the transitions that are legal from the current status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () =>
        Promise.resolve({
          appointments: [
            {
              appointment_id: 'APT-1',
              patient_id: 'PAT-001-DEMO',
              patient_name: 'Thabo Mokoena',
              provider_id: '5GrwvaEF...mock',
              appointment_type: 'Consultation',
              scheduled_date: '2099-01-01',
              start_time: '09:00',
              status: 'in_progress',
            },
          ],
        }),
    });
    render(<AppointmentSchedulerPage />);

    fireEvent.click(await screen.findByRole('tab', { name: /Upcoming/i }));

    // in_progress -> completed is the only move the server allows.
    expect(await screen.findByRole('button', { name: /^Complete$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Check in$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm$/i })).not.toBeInTheDocument();
  });

  it('marks a telehealth appointment as virtual', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () =>
        Promise.resolve({
          appointments: [
            {
              appointment_id: 'APT-2',
              patient_id: 'PAT-001-DEMO',
              provider_id: '5GrwvaEF...mock',
              appointment_type: 'Telehealth',
              scheduled_date: '2099-01-01',
              start_time: '10:00',
              status: 'scheduled',
              is_telehealth: true,
            },
          ],
        }),
    });
    render(<AppointmentSchedulerPage />);

    fireEvent.click(await screen.findByRole('tab', { name: /Upcoming/i }));
    expect(await screen.findByText(/Virtual/i)).toBeInTheDocument();
  });

  describe('telehealth', () => {
    const telehealthAppt = (over: Record<string, unknown>) => ({
      appointment_id: 'APT-TH',
      patient_id: 'PAT-001-DEMO',
      provider_id: '5GrwvaEF...mock',
      appointment_type: 'Telehealth',
      status: 'scheduled',
      is_telehealth: true,
      ...over,
    });

    const withAppointments = (appointments: unknown[]) => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ appointments }),
      });
    };

    /** Local date/time strings so the window maths matches the browser clock. */
    const inMinutes = (mins: number) => {
      const d = new Date(Date.now() + mins * 60_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        scheduled_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        start_time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      };
    };

    it('offers Join once a session exists and the room is open', async () => {
      withAppointments([
        telehealthAppt({
          ...inMinutes(5),
          telehealth_session_id: 'TH-1',
          location: { telehealth_link: 'https://meet.jit.si/room' },
        }),
      ]);
      render(<AppointmentSchedulerPage />);

      const join = await screen.findByRole('link', { name: /Join consultation/i });
      expect(join).toHaveAttribute('href', 'https://meet.jit.si/room');
    });

    /**
     * The defect: a Join button that claims a meeting exists when none was
     * ever created. A telehealth appointment without a session must not offer
     * one, however close the appointment is.
     */
    it('offers no Join when no session was provisioned', async () => {
      withAppointments([telehealthAppt({ ...inMinutes(5) })]);
      render(<AppointmentSchedulerPage />);

      await screen.findByText(/Virtual/i);
      expect(screen.queryByRole('link', { name: /Join consultation/i })).not.toBeInTheDocument();
    });

    it('does not open the room days ahead of the appointment', async () => {
      withAppointments([
        telehealthAppt({
          ...inMinutes(60 * 24 * 3),
          telehealth_session_id: 'TH-2',
          location: { telehealth_link: 'https://meet.jit.si/room' },
        }),
      ]);
      render(<AppointmentSchedulerPage />);

      fireEvent.click(await screen.findByRole('tab', { name: /Upcoming/i }));
      expect(await screen.findByText(/Join opens 15 min before/i)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Join consultation/i })).not.toBeInTheDocument();
    });
  });
});
