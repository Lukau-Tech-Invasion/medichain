import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import type { MessageAttachment } from '@medichain/shared';
import * as shared from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useState } from 'react';

// The components call the shared API client, so the network edge is mocked:
// that exercises the real client's error handling, not a stand-in for it.
const mockFetch = vi.fn();
global.fetch = mockFetch;

/** A fetch answer with a JSON body. */
function answer(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob([])),
  });
}

const { AttachmentPicker, MessageAttachmentList, attachFilesToMessage } = shared;

/** A File of `size` bytes with `type`. */
function file(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

function Picker() {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <I18nProvider>
      <AttachmentPicker files={files} onChange={setFiles} />
    </I18nProvider>
  );
}

const ATTACHMENT: MessageAttachment = {
  id: 'ATT-1',
  message_id: 'MSG-1',
  filename: 'lab results.pdf',
  content_type: 'application/pdf',
  size_bytes: 2048,
  scan_status: 'not_scanned',
  created_at: '2026-09-26T10:00:00Z',
};

describe('message attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('accepts a PDF and refuses other types and oversized files, saying why', () => {
    render(<Picker />);
    const input = screen.getByLabelText(/Attach files/i);

    fireEvent.change(input, { target: { files: [file('scan.pdf', 'application/pdf')] } });
    expect(screen.getByRole('list', { name: /Files to attach/i })).toHaveTextContent('scan.pdf');

    fireEvent.change(input, { target: { files: [file('notes.docx', 'application/msword')] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/notes.docx is not a PDF, JPEG or PNG/i);

    fireEvent.change(input, { target: { files: [file('huge.png', 'image/png', 10 * 1024 * 1024 + 1)] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/huge.png is larger than 10 MB/i);
    expect(screen.getByRole('list', { name: /Files to attach/i })).not.toHaveTextContent('huge.png');
  });

  it('lets a chosen file be removed', () => {
    render(<Picker />);
    fireEvent.change(screen.getByLabelText(/Attach files/i), { target: { files: [file('scan.pdf', 'application/pdf')] } });
    fireEvent.click(screen.getByRole('button', { name: /Remove scan.pdf/i }));
    expect(screen.queryByRole('list', { name: /Files to attach/i })).not.toBeInTheDocument();
  });

  it('shows each attachment with its size and says when it was not virus-scanned', () => {
    render(<I18nProvider><MessageAttachmentList attachments={[ATTACHMENT]} /></I18nProvider>);
    expect(screen.getByRole('button', { name: /lab results.pdf/i })).toHaveTextContent('2 KB');
    expect(screen.getByText(/Not virus-scanned/i)).toBeInTheDocument();
  });

  it("reports a refused download instead of failing silently", async () => {
    mockFetch.mockImplementation(() =>
      answer(403, { error: { code: 'NOT_A_PARTICIPANT', message: 'Only the people in this conversation can open its attachments.' } }),
    );
    render(<I18nProvider><MessageAttachmentList attachments={[ATTACHMENT]} /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: /lab results.pdf/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only the people in this conversation/i);
  });

  it('reports each file that failed to attach, by name, with the reason', async () => {
    mockFetch
      .mockImplementationOnce(() => answer(201, { success: true, attachment: ATTACHMENT }))
      .mockImplementationOnce(() =>
        answer(422, { error: { code: 'ATTACHMENT_REJECTED', message: 'This file was flagged by the malware scanner.' } }),
      );
    const failed = await attachFilesToMessage('MSG-1', [file('a.pdf', 'application/pdf'), file('b.pdf', 'application/pdf')]);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    // Sent as the file's own bytes and type, named in the query string.
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/messages/MSG-1/attachments?filename=a.pdf');
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    expect(failed).toEqual([{ name: 'b.pdf', reason: 'This file was flagged by the malware scanner.' }]);
  });
});
