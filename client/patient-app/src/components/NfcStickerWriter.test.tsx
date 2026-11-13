import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as shared from '@medichain/shared';
import { NfcStickerWriter } from './NfcStickerWriter';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCardInfo: vi.fn(),
}));

/** Writing the issued card number onto a sticker, where Web NFC exists. */
describe('NfcStickerWriter', () => {
  const written: unknown[] = [];
  class FakeReader {
    async write(message: unknown) {
      written.push(message);
    }
  }

  beforeEach(() => {
    written.length = 0;
    vi.clearAllMocks();
    (window as unknown as { NDEFReader?: unknown }).NDEFReader = FakeReader;
  });
  afterEach(() => {
    delete (window as unknown as { NDEFReader?: unknown }).NDEFReader;
  });

  it('renders nothing where the browser cannot write NFC', () => {
    delete (window as unknown as { NDEFReader?: unknown }).NDEFReader;
    const { container } = render(<NfcStickerWriter patientId="PAT-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('writes the issued card number as a text record', async () => {
    vi.mocked(shared.getCardInfo).mockResolvedValue({
      card_id: 'NFC-CARD-7', patient_id: 'PAT-1', card_hash: 'h', national_id_type: 'SA', status: 'Active', created_at: 0,
    });
    render(<NfcStickerWriter patientId="PAT-1" />);
    fireEvent.click(screen.getByRole('button', { name: /write to an nfc sticker/i }));
    await waitFor(() => expect(screen.getByText(/now carries your MediChain card number/)).toBeInTheDocument());
    expect(shared.getCardInfo).toHaveBeenCalledWith('PAT-1');
    expect(written).toEqual([{ records: [{ recordType: 'text', data: 'NFC-CARD-7' }] }]);
  });

  it('writes nothing when no card has been issued', async () => {
    vi.mocked(shared.getCardInfo).mockResolvedValue(null);
    render(<NfcStickerWriter patientId="PAT-1" />);
    fireEvent.click(screen.getByRole('button', { name: /write to an nfc sticker/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No MediChain card has been issued/);
    expect(written).toEqual([]);
  });
});
