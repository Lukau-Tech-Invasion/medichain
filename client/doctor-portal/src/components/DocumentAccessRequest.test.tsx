import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import { DocumentAccessRequest } from './DocumentAccessRequest';

vi.mock('@medichain/shared', async original => ({
  ...(await original<Record<string, unknown>>()), requestPatientDocumentAccess: vi.fn(),
}));

describe('DocumentAccessRequest', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('requires a reason and sends one request for the displayed patient while pending', async () => {
    let finish!: () => void;
    vi.mocked(shared.requestPatientDocumentAccess).mockImplementation(() => new Promise(resolve => {
      finish = () => resolve({ request: {} as shared.PatientAccessRequest });
    }));
    render(<DocumentAccessRequest patientId="PAT-QA" onCheckAccess={vi.fn()} />);
    expect(screen.getByText('PAT-QA')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Request document access' })).toBeDisabled();
    const input = screen.getByLabelText('Reason for document access');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('form'));
    expect(shared.requestPatientDocumentAccess).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' Synthetic follow-up ' } });
    fireEvent.submit(screen.getByRole('form'));
    fireEvent.submit(screen.getByRole('form'));
    expect(input).toBeDisabled();
    expect(shared.requestPatientDocumentAccess).toHaveBeenCalledOnce();
    expect(shared.requestPatientDocumentAccess).toHaveBeenCalledWith('PAT-QA', 'Synthetic follow-up');
    await act(async () => finish());
    expect(screen.getByRole('status')).toHaveTextContent('Access has not been granted yet');
    expect(screen.queryByRole('button', { name: 'Request document access' })).not.toBeInTheDocument();
  });

  it('keeps the reason on failure and checks access only when explicitly requested', async () => {
    vi.mocked(shared.requestPatientDocumentAccess).mockRejectedValue(new Error('Synthetic outage'));
    const check = vi.fn();
    render(<DocumentAccessRequest patientId="PAT-QA" onCheckAccess={check} />);
    fireEvent.change(screen.getByLabelText('Reason for document access'), { target: { value: 'QA review' } });
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('The access request could not be sent');
    expect(screen.getByLabelText('Reason for document access')).toHaveValue('QA review');
    expect(check).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check document access' }));
    expect(check).toHaveBeenCalledOnce();
  });

  it('does not carry a pending request result into another patient form', async () => {
    let finish!: () => void;
    vi.mocked(shared.requestPatientDocumentAccess).mockImplementation(() => new Promise(resolve => {
      finish = () => resolve({ request: {} as shared.PatientAccessRequest });
    }));
    const view = render(<DocumentAccessRequest key="PAT-A" patientId="PAT-A" onCheckAccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Reason for document access'), { target: { value: 'QA review' } });
    fireEvent.submit(screen.getByRole('form'));
    view.rerender(<DocumentAccessRequest key="PAT-B" patientId="PAT-B" onCheckAccess={vi.fn()} />);
    await act(async () => finish());
    expect(screen.getByText('PAT-B')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Reason for document access')).toHaveValue('');
  });
});
