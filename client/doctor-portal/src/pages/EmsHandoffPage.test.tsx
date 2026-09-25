import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as shared from '@medichain/shared';
import EmsHandoffPage from './EmsHandoffPage';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  createEmsHandoff: vi.fn(),
  listRecentEmsHandoffs: vi.fn(),
}));

describe('EmsHandoffPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    vi.mocked(shared.listRecentEmsHandoffs).mockResolvedValue({
      success: true, hours: 24, count: 1,
      handoffs: [{
        id: 'EMS-1', ems_agency: 'Metro EMS', unit_number: 'M12', chief_complaint: 'Fall from height',
        received_by: '5Nurse', received_at: '2026-09-25T08:00:00Z', trauma_alert: true,
      }],
    });
  });

  it('lists the handovers received, with the pre-alerts the crew called', async () => {
    render(<EmsHandoffPage />);
    const list = await screen.findByTestId('ems-arrivals');
    expect(list.textContent).toContain('Fall from height');
    expect(list.textContent).toContain('patient not yet identified');
    expect(list.textContent).toContain('Trauma');
  });

  it('sends only what was entered', async () => {
    vi.mocked(shared.createEmsHandoff).mockResolvedValue({ success: true, id: 'EMS-2' });
    render(<EmsHandoffPage />);
    await screen.findByTestId('ems-arrivals');

    fireEvent.change(screen.getByLabelText(/Ambulance service/i), { target: { value: 'Metro EMS' } });
    fireEvent.change(screen.getByLabelText(/Chief complaint/i), { target: { value: 'Chest pain' } });
    fireEvent.click(screen.getByRole('button', { name: /Add a set/i }));
    fireEvent.change(screen.getByLabelText(/^Pulse$/i), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText(/^Allergies$/i), { target: { value: 'Penicillin' } });
    fireEvent.click(screen.getByLabelText(/^STEMI$/i));
    fireEvent.click(screen.getByRole('button', { name: /Record handover/i }));

    await waitFor(() => expect(shared.createEmsHandoff).toHaveBeenCalledWith({
      ems_agency: 'Metro EMS',
      chief_complaint: 'Chest pain',
      vital_signs: [{ heart_rate: 110 }],
      sample: { allergies: 'Penicillin' },
      stemi_alert: true,
    }));
    expect(await screen.findByText(/Handover EMS-2 recorded/i)).toBeInTheDocument();
  });

  it('refuses an observations set with no readings', async () => {
    render(<EmsHandoffPage />);
    await screen.findByTestId('ems-arrivals');
    fireEvent.change(screen.getByLabelText(/Ambulance service/i), { target: { value: 'Metro EMS' } });
    fireEvent.change(screen.getByLabelText(/Chief complaint/i), { target: { value: 'Chest pain' } });
    fireEvent.click(screen.getByRole('button', { name: /Add a set/i }));
    fireEvent.click(screen.getByRole('button', { name: /Record handover/i }));
    expect(await screen.findByText(/at least one reading/i)).toBeInTheDocument();
    expect(shared.createEmsHandoff).not.toHaveBeenCalled();
  });
});
