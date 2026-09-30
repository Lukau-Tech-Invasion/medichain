import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import UserManagementPage from './UserManagementPage';
import { useAuthStore } from '../store/authStore';
import { answerConfirm } from '../../../shared/src/testing/dialogs';

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

describe('UserManagementPage', () => {
  const mockUser = {
    userId: 'admin-user-id',
    role: 'Admin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        // The page maps snake_case user records: `name` (not `fullName`),
        // `user_id` (not `userId`), and lower-case role/status
        // values matching its UserRole / UserStatus unions.
        json: () => Promise.resolve({
          users: [
            {
              user_id: '5ABC-user-id',
              name: 'John Smith',
              email: 'dr_smith@example.org',
              phone: '+27123456789',
              role: 'doctor',
              status: 'active',
              department: 'Cardiology',
              license_number: 'MP-123456',
              permissions: [],
            },
          ],
        }),
      });
    });
  });

  it('renders user management page', async () => {
    render(
      <MemoryRouter>
        <UserManagementPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/User Management/i)).toBeInTheDocument();
      expect(screen.getByText(/John Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/dr_smith/i)).toBeInTheDocument();
    });
  });

  it('allows switching to roles tab', async () => {
    render(
      <MemoryRouter>
        <UserManagementPage />
      </MemoryRouter>
    );

    const rolesTab = screen.getAllByText(/Roles/i)[0];
    fireEvent.click(rolesTab);
    
    expect(screen.getAllByText(/Role Permissions/i).length).toBeGreaterThan(0);
  });

  // --- credential and MFA reset (the administrator's recovery tools) ---------

  function jsonResponse(body: unknown, status = 200) {
    return Promise.resolve({
      ok: status < 400,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
    });
  }

  function requestsTo(fragment: string) {
    return mockFetch.mock.calls.filter(([url]) => String(url).includes(fragment));
  }

  it('asks before resetting a credential, then shows the one-time code once', async () => {
    render(<MemoryRouter><UserManagementPage /></MemoryRouter>);
    await screen.findByText(/John Smith/i);

    const usersResponse = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/credential-reset') && init?.method === 'POST'
        ? jsonResponse({ credential_code: 'ABCD-EFGH-JKMN', expires_at: '2026-10-03T10:00:00Z' })
        : usersResponse(url, init)
    );

    fireEvent.click(screen.getByRole('button', { name: /Reset credential/i }));
    await answerConfirm(true);

    await waitFor(() => expect(screen.getByTestId('one-time-code')).toHaveTextContent('ABCD-EFGH-JKMN'));
    expect(requestsTo('/api/admin/users/5ABC-user-id/credential-reset')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /I have given it to them/i }));
    expect(screen.queryByTestId('one-time-code')).not.toBeInTheDocument();
  });

  it('sends nothing when the administrator declines the reset', async () => {
    render(<MemoryRouter><UserManagementPage /></MemoryRouter>);
    await screen.findByText(/John Smith/i);

    fireEvent.click(screen.getByRole('button', { name: /Reset credential/i }));
    await answerConfirm(false);

    expect(requestsTo('/credential-reset')).toHaveLength(0);
    expect(screen.queryByTestId('one-time-code')).not.toBeInTheDocument();
  });

  it('removes an authenticator only after confirmation', async () => {
    render(<MemoryRouter><UserManagementPage /></MemoryRouter>);
    await screen.findByText(/John Smith/i);

    const usersResponse = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/mfa-reset') && init?.method === 'POST'
        ? jsonResponse({ success: true })
        : usersResponse(url, init)
    );

    fireEvent.click(screen.getByRole('button', { name: /Reset two-factor authentication/i }));
    await answerConfirm(true);

    await waitFor(() => expect(requestsTo('/api/admin/users/5ABC-user-id/mfa-reset')).toHaveLength(1));
  });
});
