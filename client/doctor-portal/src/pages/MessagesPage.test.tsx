import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import MessagesPage from './MessagesPage';
import { useAuthStore } from '../store/authStore';

vi.mock('../store/authStore', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  markMessageRead: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const doctorId = 'doctor-wallet';
const patientId = 'patient-wallet';
const inbound = {
  message_id: 'msg-1',
  sender_id: patientId,
  sender_name: 'Patient Example',
  sender_role: 'Patient',
  recipient_id: doctorId,
  recipient_name: 'Dr Smith',
  subject: 'Medication question',
  content: 'Can I take this with breakfast?',
  priority: 'normal',
  related_patient_id: 'PAT-001',
  sent_at: 1755000000,
  read: false,
  thread_id: 'thread-1',
};
const outbound = {
  ...inbound,
  message_id: 'msg-2',
  sender_id: doctorId,
  sender_name: 'Dr Smith',
  sender_role: 'Doctor',
  recipient_id: patientId,
  recipient_name: 'Patient Example',
  content: 'Yes, take it with food.',
  sent_at: 1755000060,
  read: true,
};

function responseMessages(includeNewReply: boolean) {
  const messages = includeNewReply
    ? [inbound, outbound, { ...outbound, message_id: 'msg-3', content: 'Please call if nausea develops.', sent_at: 1755000120, read: false }]
    : [inbound, outbound];
  return {
    success: true,
    folder: 'all',
    messages,
    conversations: [{
      id: patientId,
      providerId: patientId,
      providerName: 'Patient Example',
      providerRole: 'Patient',
      specialty: null,
      lastMessage: messages[messages.length - 1]?.content,
      lastMessageTime: messages[messages.length - 1]?.sent_at,
      unreadCount: 1,
      messages,
    }],
    count: messages.length,
    unread_count: 1,
  };
}

describe('MessagesPage', () => {
  let replySent = false;

  beforeEach(() => {
    replySent = false;
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: { walletAddress: doctorId, role: 'Doctor', fullName: 'Dr Smith' },
      isAuthenticated: true,
    });
    vi.mocked(shared.markMessageRead).mockResolvedValue({ success: true, message_id: 'msg-1', read: true });
    // A real JSON response: the page now goes through the typed client, which
    // reads the content type before it parses anything.
    const json = (body: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(body),
      });
    mockFetch.mockImplementation((url, init) => {
      if (String(url).includes('/api/messages/send') && init?.method === 'POST') {
        replySent = true;
        return json({ success: true });
      }
      if (String(url).includes('/api/messages')) {
        return json(responseMessages(replySent));
      }
      return json({});
    });
  });

  function renderPage() {
    render(<MemoryRouter><MessagesPage /></MemoryRouter>);
  }

  it('opens a participant conversation and displays the complete history', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Patient Example/ }));
    expect(await screen.findByText('Can I take this with breakfast?')).toBeInTheDocument();
    expect(screen.getAllByText('Yes, take it with food.').length).toBeGreaterThan(0);
    expect(shared.markMessageRead).toHaveBeenCalledWith('msg-1');
  });

  it('adds a sent reply to the open conversation instead of clearing the view', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Patient Example/ }));
    const reply = await screen.findByPlaceholderText(/Type your message/i);
    fireEvent.change(reply, { target: { value: 'Please call if nausea develops.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
    expect(await screen.findByText('Please call if nausea develops.')).toBeInTheDocument();
    expect(screen.getByText(/added to this conversation/i)).toBeInTheDocument();
  });

  it('keeps the live unread total aligned with opened conversations', async () => {
    renderPage();
    expect((await screen.findAllByText('1')).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /Patient Example/ }));
    await waitFor(() => expect(shared.markMessageRead).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });
});
