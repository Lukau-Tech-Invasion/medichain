import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import { PatientRecordDocuments } from './PatientRecordDocuments';

vi.mock('@medichain/shared', async original => ({
  ...(await original<Record<string, unknown>>()), getPatientRecords: vi.fn(), downloadRecordContent: vi.fn(),
}));

describe('PatientRecordDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getPatientRecords).mockReset();
    vi.mocked(shared.downloadRecordContent).mockReset();
    shared.getApiClient().setUserId('doctor-documents-qa');
  });
  it('explains a refused document read without declaring an empty record list', async () => {
    vi.mocked(shared.getPatientRecords).mockRejectedValueOnce(new shared.ApiClientError('Refused', 'ACCESS_DENIED', 403));
    render(<PatientRecordDocuments patientId="PAT-QA" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Document access was refused');
    expect(screen.queryByText(/No uploaded documents/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry loading documents' })).not.toBeInTheDocument();
  });

  it('does not claim an empty history when the list request fails and retries only the read', async () => {
    vi.mocked(shared.getPatientRecords).mockRejectedValueOnce(new Error('Synthetic read failure')).mockResolvedValueOnce([]);
    render(<PatientRecordDocuments patientId="PAT-QA" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Documents could not be loaded.');
    expect(screen.queryByText(/No uploaded documents/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading documents' }));
    expect(await screen.findByText(/No uploaded documents/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(shared.getPatientRecords).toHaveBeenCalledTimes(2));
    expect(shared.downloadRecordContent).not.toHaveBeenCalled();
  });

  const record: shared.MedicalRecordReference = {
    content_hash: 'QA-HASH', metadata_hash: 'QA-META', record_type: 'other', uploaded_at: 1, content_checksum: 'QA',
  };

  it('removes stale document controls and offers a normal request when an opened document is refused', async () => {
    vi.mocked(shared.getPatientRecords).mockResolvedValueOnce([record]);
    vi.mocked(shared.downloadRecordContent).mockRejectedValueOnce(new shared.ApiClientError('Patient-only backend wording', 'ACCESS_DENIED', 403));
    render(<PatientRecordDocuments patientId="PAT-QA" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open document' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Document access was refused');
    expect(screen.queryByRole('button', { name: 'Open document' })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Request document access' })).toBeVisible();
    expect(screen.queryByText(/No uploaded documents/)).not.toBeInTheDocument();
  });

  it('ignores text that finishes decoding after switching patients', async () => {
    let finish!: (value: string) => void;
    const text = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    vi.mocked(shared.getPatientRecords).mockResolvedValueOnce([record]).mockResolvedValueOnce([]);
    vi.mocked(shared.downloadRecordContent).mockResolvedValueOnce({ blob: { text } as unknown as Blob, contentType: 'text/plain' });
    const view = render(<PatientRecordDocuments patientId="PAT-A" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open document' }));
    await waitFor(() => expect(text).toHaveBeenCalled());
    view.rerender(<PatientRecordDocuments patientId="PAT-B" />);
    await screen.findByText(/No uploaded documents/);
    await act(async () => finish('PAT-A PRIVATE TEST TEXT'));
    expect(screen.queryByRole('region', { name: 'Document preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('PAT-A PRIVATE TEST TEXT')).not.toBeInTheDocument();
  });

  it('ignores a late refused response after switching patients', async () => {
    let refuse!: (reason: unknown) => void;
    vi.mocked(shared.getPatientRecords).mockResolvedValueOnce([record]).mockResolvedValueOnce([]);
    vi.mocked(shared.downloadRecordContent).mockImplementationOnce(() => new Promise((_resolve, reject) => { refuse = reject; }));
    const view = render(<PatientRecordDocuments patientId="PAT-A" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open document' }));
    view.rerender(<PatientRecordDocuments patientId="PAT-B" />);
    await screen.findByText(/No uploaded documents/);
    await act(async () => refuse(new shared.ApiClientError('Refused', 'ACCESS_DENIED', 403)));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Request document access' })).not.toBeInTheDocument();
  });

  it.each(['clinician', 'login session'])('does not show decoded text after the %s changes', async change => {
    let finish!: (value: string) => void;
    const text = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    vi.mocked(shared.getPatientRecords).mockResolvedValueOnce([record]);
    vi.mocked(shared.downloadRecordContent).mockResolvedValueOnce({ blob: { text } as unknown as Blob, contentType: 'text/plain' });
    render(<PatientRecordDocuments patientId="PAT-QA" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open document' }));
    await waitFor(() => expect(text).toHaveBeenCalled());
    if (change === 'clinician') shared.getApiClient().setUserId('another-doctor-qa');
    else shared.getApiClient().setTokens('synthetic-new-login-session');
    await act(async () => finish('PREVIOUS CLINICIAN TEST TEXT'));
    expect(screen.queryByRole('region', { name: 'Document preview' })).not.toBeInTheDocument();
  });

  it('does not start a binary download when the response arrives after leaving the document workspace', async () => {
    let finish!: (value: Awaited<ReturnType<typeof shared.downloadRecordContent>>) => void;
    vi.mocked(shared.getPatientRecords).mockResolvedValueOnce([record]);
    vi.mocked(shared.downloadRecordContent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const original = URL.createObjectURL;
    const create = vi.fn(() => 'blob:QA');
    URL.createObjectURL = create;
    try {
      const view = render(<PatientRecordDocuments patientId="PAT-QA" />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open document' }));
      view.unmount();
      await act(async () => finish({ blob: new Blob(['QA']), contentType: 'application/pdf' }));
      expect(create).not.toHaveBeenCalled();
    } finally { URL.createObjectURL = original; }
  });
});
