import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MessagesPage } from './MessagesPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

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
      lastMessageTime: new Date().toISOString(),
      unreadCount: 1,
      messages: [
        {
          id: 'msg1',
          senderId: 'PROV1',
          senderName: 'Dr. Smith',
          senderRole: 'Physician',
          content: 'Hello, how are you?',
          timestamp: new Date().toISOString(),
          read: false,
          isPatient: false,
        }
      ],
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/messages')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ conversations: mockConversations }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders messages page with conversations', async () => {
    render(
      <MemoryRouter>
        <MessagesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Messages/i)).toBeInTheDocument();
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
      expect(screen.getByPlaceholderText(/Type your message/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Hello, how are you?/i).length).toBeGreaterThan(0);
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
