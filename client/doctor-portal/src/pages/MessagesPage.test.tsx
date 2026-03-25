import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MessagesPage from './MessagesPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('MessagesPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
    fullName: 'Dr. Smith',
  };

  const mockConversations = [
    {
      id: 'conv1',
      participantName: 'John Doe',
      participantId: 'PAT-001',
      lastMessage: 'I have a question about my meds',
      timestamp: new Date().toISOString(),
      unreadCount: 1,
      messages: [
        {
          id: 'msg1',
          senderId: 'PAT-001',
          senderName: 'John Doe',
          content: 'I have a question about my meds',
          timestamp: new Date().toISOString(),
        }
      ],
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
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
      expect(screen.getByText(/Secure Messaging/i)).toBeInTheDocument();
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/I have a question about my meds/i)).toBeInTheDocument();
    });
  });

  it('allows selecting a conversation', async () => {
    render(
      <MemoryRouter>
        <MessagesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const conv = screen.getByText(/John Doe/i);
      fireEvent.click(conv);
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type your message/i)).toBeInTheDocument();
      expect(screen.getAllByText(/I have a question about my meds/i).length).toBeGreaterThan(0);
    });
  });

  it('allows sending a message', async () => {
    render(
      <MemoryRouter>
        <MessagesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      fireEvent.click(screen.getByText(/John Doe/i));
    });

    const input = screen.getByPlaceholderText(/Type your message/i);
    fireEvent.change(input, { target: { value: 'Hello John' } });
    
    const sendButton = screen.getByLabelText(/Send/i);
    fireEvent.click(sendButton);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/messages/conv1/send'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Hello John' }),
      })
    );
  });
});
