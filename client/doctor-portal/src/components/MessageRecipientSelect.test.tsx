import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import * as shared from '@medichain/shared';
import MessageRecipientSelect from './MessageRecipientSelect';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMessageRecipients: vi.fn(),
}));

/** A doctor can choose a patient they treat, not only staff. */
describe('MessageRecipientSelect', () => {
  it('lists the patients the clinician treats, then staff', async () => {
    vi.mocked(shared.getMessageRecipients).mockResolvedValue({
      success: true,
      patients: [{ user_id: 'u-thabo', name: 'Thabo Mahlangu', patient_id: 'PAT-1' }],
      staff: [{ user_id: 'u-nurse', name: 'Sister Busisiwe Zulu', role: 'Nurse', specialty: 'Emergency Nursing' }],
    });
    const onChange = vi.fn();
    render(<MessageRecipientSelect id="to" value="" onChange={onChange} label="To" />);
    const patient = await screen.findByRole('option', { name: 'Thabo Mahlangu' });
    expect(patient.closest('optgroup')).toHaveAttribute('label', 'Patients you are treating');
    expect(screen.getByRole('option', { name: /Sister Busisiwe Zulu \(Nurse, Emergency Nursing\)/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'u-thabo' } });
    expect(onChange).toHaveBeenCalledWith('u-thabo');
  });

  it('explains how patients appear when there are none yet', async () => {
    vi.mocked(shared.getMessageRecipients).mockResolvedValue({ success: true, patients: [], staff: [] });
    render(<MessageRecipientSelect id="to" value="" onChange={vi.fn()} label="To" />);
    expect(await screen.findByText(/Patients appear here once you are treating them/)).toBeInTheDocument();
  });
});
