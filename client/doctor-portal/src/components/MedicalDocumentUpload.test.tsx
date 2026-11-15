import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import { MedicalDocumentUpload } from './MedicalDocumentUpload';
import { prepareMedicalDocument } from './medicalDocumentFile';
import * as documentFile from './medicalDocumentFile';

vi.mock('@medichain/shared', async original => ({
  ...(await original<Record<string, unknown>>()), uploadMedicalRecord: vi.fn(),
}));

const pdf = () => new File(['%PDF-1.4\nQA synthetic document'], 'synthetic.pdf', { type: 'application/pdf' });

describe('medical document validation', () => {
  it.each([
    ['application/pdf', '%PDF-1.4\nQA'],
    ['image/png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/jpeg', new Uint8Array([255, 216, 255, 224])],
  ])('encodes a permitted %s signature for the specified patient', async (type, bytes) => {
    const result = await prepareMedicalDocument(new File([bytes], 'QA', { type }), 'PAT-QA', 'other');
    expect(result).toMatchObject({ patient_id: 'PAT-QA', content_type: type, record_type: 'other' });
    expect(result.content_base64).not.toBe('');
  });
  it.each([
    new File(['html'], 'spoof.pdf', { type: 'application/pdf' }),
    new File(['text'], 'text.txt', { type: 'text/plain' }),
    new File([], 'empty.pdf', { type: 'application/pdf' }),
    new File([new Uint8Array(1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
  ])('rejects unsupported, spoofed, empty or oversized content', async file => {
    await expect(prepareMedicalDocument(file, 'PAT-QA', 'other')).rejects.toThrow();
  });
});

describe('MedicalDocumentUpload', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('blocks duplicate submissions and confirms the upload before refreshing', async () => {
    let finish!: () => void;
    vi.mocked(shared.uploadMedicalRecord).mockImplementation(() => new Promise(resolve => {
      finish = () => resolve({ success: true } as shared.UploadMedicalRecordResponse);
    }));
    const refreshed = vi.fn();
    render(<MedicalDocumentUpload patientId="PAT-QA" disabled={false} onUploaded={refreshed} />);
    expect(screen.getByText(/PAT-QA/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Document file'), { target: { files: [pdf()] } });
    fireEvent.submit(screen.getByRole('form'));
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(shared.uploadMedicalRecord).toHaveBeenCalledOnce());
    expect(refreshed).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Document file')).toBeDisabled();
    await act(async () => finish());
    expect(refreshed).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Document uploaded');
    // The file was consumed: pressing again asks for one rather than re-uploading.
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));
    expect(await screen.findByText('Choose a file first.')).toBeInTheDocument();
  });

  it('retains the key for an unchanged uncertain retry and does not refresh on failure', async () => {
    vi.mocked(shared.uploadMedicalRecord).mockRejectedValueOnce(new Error('Synthetic outage'))
      .mockResolvedValueOnce({ success: true } as shared.UploadMedicalRecordResponse);
    const refreshed = vi.fn();
    render(<MedicalDocumentUpload patientId="PAT-QA" disabled={false} onUploaded={refreshed} />);
    fireEvent.change(screen.getByLabelText('Document file'), { target: { files: [pdf()] } });
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the document list before retrying');
    expect(refreshed).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole('form'));
    await screen.findByRole('status');
    const calls = vi.mocked(shared.uploadMedicalRecord).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toBeTruthy();
    expect(calls[1]).toEqual(calls[0]);
  });

  it('rejects a misleading file without making an upload request', async () => {
    render(<MedicalDocumentUpload patientId="PAT-QA" disabled={false} onUploaded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Document file'), {
      target: { files: [new File(['not PDF'], 'spoof.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('contents do not match');
    expect(shared.uploadMedicalRecord).not.toHaveBeenCalled();
  });

  it('does not begin an upload when file preparation finishes after leaving the patient', async () => {
    let finish!: () => void;
    const prepare = vi.spyOn(documentFile, 'prepareMedicalDocument').mockImplementation(() => new Promise(resolve => {
      finish = () => resolve({ patient_id: 'PAT-A', content_base64: 'QA', filename: 'QA.pdf', content_type: 'application/pdf', record_type: 'other' });
    }));
    try {
      const view = render(<MedicalDocumentUpload key="PAT-A" patientId="PAT-A" disabled={false} onUploaded={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Document file'), { target: { files: [pdf()] } });
      fireEvent.submit(screen.getByRole('form'));
      view.rerender(<MedicalDocumentUpload key="PAT-B" patientId="PAT-B" disabled={false} onUploaded={vi.fn()} />);
      await act(async () => finish());
      expect(shared.uploadMedicalRecord).not.toHaveBeenCalled();
      expect(screen.getByText(/PAT-B/)).toBeVisible();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally { prepare.mockRestore(); }
  });
});
