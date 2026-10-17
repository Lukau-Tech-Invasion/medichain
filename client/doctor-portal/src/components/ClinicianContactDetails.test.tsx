import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import { ClinicianContactDetails } from './ClinicianContactDetails';

vi.mock('@medichain/shared', async original => ({
  ...(await original<typeof import('@medichain/shared')>()), updateUserProfile: vi.fn(),
}));

describe('clinician contact details', () => {
  beforeEach(() => { vi.mocked(shared.updateUserProfile).mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('loads authoritative values and preserves unknown contacts as blank', async () => {
    vi.spyOn(shared.getApiClient(), 'get').mockResolvedValue({ user_id: 'QA', email: null, phone: null });
    render(<ClinicianContactDetails userId="QA" />);
    expect(await screen.findByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Phone')).toHaveValue('');
    expect(screen.queryByDisplayValue('+234-800-000-0000')).not.toBeInTheDocument();
  });

  it('reports read failure and requires a successful retry before editing', async () => {
    vi.spyOn(shared.getApiClient(), 'get').mockRejectedValueOnce(new Error('QA outage'))
      .mockResolvedValue({ user_id: 'QA', email: 'qa@example.invalid', phone: '' });
    render(<ClinicianContactDetails userId="QA" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Contact details could not be loaded');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry contact details' }));
    expect(await screen.findByLabelText('Email')).toHaveValue('qa@example.invalid');
  });

  it('retains edited fields after a failed write and verifies the retry through a read', async () => {
    const read = vi.spyOn(shared.getApiClient(), 'get').mockResolvedValueOnce({ user_id: 'QA', email: '', phone: '' })
      .mockResolvedValue({ user_id: 'QA', email: 'new@example.invalid', phone: '+27000000000' });
    vi.mocked(shared.updateUserProfile).mockRejectedValueOnce(new Error('QA write outage')).mockResolvedValue({ success: true, user_id: 'QA', message: 'saved' });
    render(<ClinicianContactDetails userId="QA" />);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'new@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+27000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is retained');
    expect(screen.getByLabelText('Phone')).toHaveValue('+27000000000');
    fireEvent.click(screen.getByRole('button', { name: 'Save contact details' }));
    expect(await screen.findByRole('status')).toHaveTextContent('saved and verified');
    expect(read).toHaveBeenCalledTimes(2);
    expect(shared.updateUserProfile).toHaveBeenLastCalledWith('QA', { email: 'new@example.invalid', phone: '+27000000000' });
  });

  it('does not claim success when a committed save cannot be read back', async () => {
    vi.spyOn(shared.getApiClient(), 'get').mockResolvedValueOnce({ user_id: 'QA', email: '', phone: '' })
      .mockRejectedValueOnce(new Error('QA confirmation outage'));
    vi.mocked(shared.updateUserProfile).mockResolvedValue({ success: true, user_id: 'QA', message: 'saved' });
    render(<ClinicianContactDetails userId="QA" />);
    fireEvent.change(await screen.findByLabelText('Phone'), { target: { value: '+27000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toHaveValue('+27000000000');
  });

  it('never displays a contact response belonging to a different account', async () => {
    vi.spyOn(shared.getApiClient(), 'get').mockResolvedValue({ user_id: 'someone-else', email: 'private@example.invalid' });
    render(<ClinicianContactDetails userId="QA" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByDisplayValue('private@example.invalid')).not.toBeInTheDocument();
  });

  it('prevents a rapid repeat submission while saving and verifying', async () => {
    vi.spyOn(shared.getApiClient(), 'get').mockResolvedValue({ user_id: 'QA', email: '', phone: '' });
    let finish!: (value: { success: boolean; user_id: string; message: string }) => void;
    vi.mocked(shared.updateUserProfile).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<ClinicianContactDetails userId="QA" />);
    const save = await screen.findByRole('button', { name: 'Save contact details' });
    fireEvent.click(save); fireEvent.click(save);
    expect(shared.updateUserProfile).toHaveBeenCalledOnce();
    expect(save).toBeDisabled();
    finish({ success: true, user_id: 'QA', message: 'saved' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('saved and verified'));
  });
});

