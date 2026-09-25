import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ProviderSchedulePage from './ProviderSchedulePage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module leaves
// those undefined — which surfaces as "Element type is invalid".
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getProviderSchedule: vi.fn(),
  setProviderSchedule: vi.fn(),
  getAvailableSlots: vi.fn(),
}));

const provider = { walletAddress: '5Provider', username: 'Dr. Rota', role: 'Doctor' };

describe('ProviderSchedulePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ user: provider });
    vi.mocked(shared.getProviderSchedule).mockResolvedValue({
      success: true,
      has_schedule: false,
      provider_id: '5Provider',
    });
    vi.mocked(shared.setProviderSchedule).mockResolvedValue({
      success: true,
      provider_id: '5Provider',
      working_days: 1,
      message: 'Schedule saved',
    });
  });

  /**
   * No schedule is not "works no hours" — booking falls back to the default
   * clinic grid. A provider must be told which of the two they are looking at,
   * because only one of them needs their attention.
   */
  it('says when no hours are published, and why that matters', async () => {
    render(<ProviderSchedulePage />);
    expect(await screen.findByText(/No working hours published/i)).toBeInTheDocument();
    expect(screen.getByText(/default clinic grid/i)).toBeInTheDocument();
  });

  it('starts every weekday unticked and empty', async () => {
    render(<ProviderSchedulePage />);
    await screen.findByText(/Weekly pattern/i);
    const monday = screen.getByLabelText(/Monday — Working/i) as HTMLInputElement;
    expect(monday.checked).toBe(false);
  });

  /**
   * The defect this page is here to prevent is publishing hours nobody chose.
   * Ticking a day and saving without times must be refused at the field, not
   * accepted and turned into availability.
   */
  it('refuses a ticked day with no times, and does not call the API', async () => {
    render(<ProviderSchedulePage />);
    await screen.findByText(/Weekly pattern/i);

    fireEvent.click(screen.getByLabelText(/Tuesday — Working/i));
    fireEvent.click(screen.getByRole('button', { name: /Publish working hours/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Enter a time as HH:MM/i).length).toBeGreaterThan(0);
    });
    expect(shared.setProviderSchedule).not.toHaveBeenCalled();
  });

  /**
   * One end of a break silently blocks either nothing or the whole day on the
   * server. The message has to say what to do, not that something is invalid.
   */
  it('refuses one end of a break', async () => {
    render(<ProviderSchedulePage />);
    await screen.findByText(/Weekly pattern/i);

    fireEvent.click(screen.getByLabelText(/Wednesday — Working/i));
    const starts = screen.getAllByLabelText('Start');
    const finishes = screen.getAllByLabelText('Finish');
    const breakFrom = screen.getAllByLabelText('Break from');
    fireEvent.change(starts[2], { target: { value: '09:00' } });
    fireEvent.change(finishes[2], { target: { value: '17:00' } });
    fireEvent.change(breakFrom[2], { target: { value: '13:00' } });

    fireEvent.click(screen.getByRole('button', { name: /Publish working hours/i }));

    await waitFor(() => {
      expect(screen.getByText(/Give both ends of the break, or neither/i)).toBeInTheDocument();
    });
    expect(shared.setProviderSchedule).not.toHaveBeenCalled();
  });

  /**
   * A complete day is sent as the API spells it, and an untouched break is
   * absent rather than an empty string — `''` is one end of a break, which the
   * API refuses.
   */
  it('sends only what was entered', async () => {
    render(<ProviderSchedulePage />);
    await screen.findByText(/Weekly pattern/i);

    fireEvent.click(screen.getByLabelText(/Monday — Working/i));
    fireEvent.change(screen.getAllByLabelText('Start')[0], { target: { value: '08:30' } });
    fireEvent.change(screen.getAllByLabelText('Finish')[0], { target: { value: '12:30' } });

    fireEvent.click(screen.getByRole('button', { name: /Publish working hours/i }));

    await waitFor(() => expect(shared.setProviderSchedule).toHaveBeenCalled());
    const [id, payload] = vi.mocked(shared.setProviderSchedule).mock.calls[0];
    expect(id).toBe('5Provider');
    expect(payload.working_days).toEqual([{ weekday: 1, start: '08:30', end: '12:30' }]);
    expect(payload.blocked).toEqual([]);
    // Left blank: the server's own default applies and the page does not
    // assert a number it was never given.
    expect(payload.slot_minutes).toBeUndefined();
  });

  /**
   * The preview must come from the server. A page that previews its own
   * arithmetic proves only that it agrees with itself.
   */
  it('reads the preview back from the slots endpoint', async () => {
    vi.mocked(shared.getAvailableSlots).mockResolvedValue({
      success: true,
      provider_id: '5Provider',
      date: '2026-09-22',
      available_slots: ['08:30', '09:00'],
      slot_duration_minutes: 30,
    });

    render(<ProviderSchedulePage />);
    await screen.findByText(/Slots this produces/i);

    fireEvent.change(screen.getByLabelText(/Check a date/i), { target: { value: '2026-09-22' } });
    fireEvent.click(screen.getByRole('button', { name: /Check slots/i }));

    expect(await screen.findByText('08:30')).toBeInTheDocument();
    expect(shared.getAvailableSlots).toHaveBeenCalledWith('5Provider', '2026-09-22');
  });
});
