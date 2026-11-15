import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as shared from '@medichain/shared';
import { uploadWoundPhoto, WoundPhotoPicker } from './WoundPhotos';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), uploadMedicalRecord: vi.fn(),
}));

describe('Wound photos', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('refuses missing patient, non-raster content, oversized and falsely labelled files before upload', async () => {
    for (const [file, patient] of [
      [new File(['test'], 'x.txt', { type: 'text/plain' }), 'PAT-1'],
      [new File(['not png'], 'x.png', { type: 'image/png' }), 'PAT-1'],
      [new File([new Uint8Array(1024 * 1024 + 1)], 'large.png', { type: 'image/png' }), 'PAT-1'],
      [new File(['x'], 'x.png', { type: 'image/png' }), ''],
    ] as const) await expect(uploadWoundPhoto(file, patient)).rejects.toThrow();
    expect(shared.uploadMedicalRecord).not.toHaveBeenCalled();
  });
  it('uploads the selected patient image and only returns a durable encrypted-document reference', async () => {
    vi.mocked(shared.uploadMedicalRecord).mockResolvedValue({ success: true, ipfs_hash: 'photo-hash' } as never);
    const photo = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'QA.png', { type: 'image/png' });
    expect(await uploadWoundPhoto(photo, 'PAT-1')).toBe('photo-hash');
    expect(shared.uploadMedicalRecord).toHaveBeenCalledWith(expect.objectContaining({ patient_id: 'PAT-1', filename: 'QA.png', content_type: 'image/png', record_type: 'imaging' }));
  });
  it('requires a patient and removing an attachment does not delete the stored document', async () => {
    const change = vi.fn();
    const view = render(<WoundPhotoPicker patientId="" hashes={[]} onChange={change} onBusy={vi.fn()} />);
    expect(screen.getByLabelText('Photo Upload')).toBeDisabled();
    view.rerender(<WoundPhotoPicker patientId="PAT-1" hashes={['photo-hash']} onChange={change} onBusy={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith([]));
  });
});
