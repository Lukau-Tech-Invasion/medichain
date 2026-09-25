import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { MessagesPage } from './MessagesPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMessages: vi.fn(),
  getProviders: vi.fn(),
  markMessageRead: vi.fn(),
  sendMessage: vi.fn(),
}));

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('MessagesPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  const mockConversations = [
    {
      id: 'conv1',
      providerId: 'PROV1',
      providerName: 'Dr. Smith',
      providerRole: 'Physician',
      specialty: 'Cardiology',
      lastMessage: 'Hello, how are you?',
      lastMessageTime: Math.floor(Date.now() / 1000),
      unreadCount: 1,
      messages: [
        {
          message_id: 'msg1',
          sender_id: 'PROV1',
          sender_name: 'Dr. Smith',
          sender_role: 'Physician',
          recipient_id: mockPatient.walletAddress,
          subject: 'Check-in',
          content: 'Hello, how are you?',
          priority: 'normal',
          related_patient_id: 'HEALTH123',
          sent_at: Math.floor(Date.now() / 1000),
          read: false,
          thread_id: 'msg1',
        }
      ],
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    vi.mocked(shared.getMessages).mockResolvedValue({
      success: true,
      folder: 'all',
      messages: mockConversations[0].messages,
      conversations: mockConversations,
      count: 1,
      unread_count: 1,
    });
    vi.mocked(shared.markMessageRead).mockResolvedValue({
      success: true,
      message_id: 'msg1',
      read: true,
    });
  });

  it('renders messages page with conversations', async () => {
    render(
      <MemoryRouter>
        <MessagesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Messages/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Dr. Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Hello, how are you?/i)).toBeInTheDocument();
    });
  });

  it('allows selecting a conversation', async () => {
    render(
      <MemoryRouter>
        <MessagesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const conv = screen.getByText(/Dr. Smith/i);
      fireEvent.click(conv);
    });

    await waitFor(() => {
      // In mobile view it might show a back button, in desktop it shows the chat area
      expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Hello, how are you?/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Attachments are not available/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /attach file/i })).not.toBeInTheDocument();
    });
  });

  it('allows filtering conversations by search', async () => {
    render(
      <MemoryRouter>
        <MessagesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Dr. Smith/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search/i);
    fireEvent.change(searchInput, { target: { value: 'Dr. Jones' } });

    expect(screen.queryByText(/Dr. Smith/i)).not.toBeInTheDocument();
  });
});
