import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MessagesPage from './MessagesPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

  // The page reads `data.messages` with the flat `Message` shape
  // (message_id/sender_id/subject/body/sent_at); the generated fixture used a
  // nested `conversations` structure with `participantName`/`lastMessage`,
  // which the component never looks at, so nothing rendered.
  const mockMessages = [
    {
      message_id: 'msg1',
      sender_id: 'PAT-001',
      recipient_id: '5GrwvaEF...mock',
      subject: 'Question about my meds',
      body: 'I have a question about my meds',
      sent_at: 1755000000,
      read: false,
    },
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
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ messages: mockMessages }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
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
      expect(screen.getAllByText(/Messages/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Question about my meds/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/I have a question about my meds/i).length).toBeGreaterThan(0);
    });
  });

  it('allows selecting a conversation', async () => {
    render(
      <MemoryRouter>
        <MessagesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const conv = screen.getAllByText(/Question about my meds/i)[0];
      fireEvent.click(conv);
    });

    // Selecting a message shows the DETAIL pane; the compose box appears via
    // the New Message / Reply control, which the generated test skipped.
    await waitFor(() =>
      expect(screen.getAllByText(/I have a question about my meds/i).length).toBeGreaterThan(0)
    );

    fireEvent.click(screen.getByRole('button', { name: /Compose/i }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Type your message/i)).toBeInTheDocument()
    );
  });

  it('allows sending a message', async () => {
    render(
      <MemoryRouter>
        <MessagesPage />
      </MemoryRouter>
    );

    // Compose replaces the detail pane with the new-message form; selecting a
    // conversation alone shows the message, not a compose box.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Compose/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Compose/i }));

    const body = await screen.findByPlaceholderText(/Type your message/i);
    fireEvent.change(body, { target: { value: 'Hello John' } });
    expect(body).toHaveValue('Hello John');

    fireEvent.change(screen.getByPlaceholderText(/Subject/i), {
      target: { value: 'Re: meds' },
    });
    expect(screen.getAllByRole('button', { name: /Send/i }).length).toBeGreaterThan(0);
  });
});
