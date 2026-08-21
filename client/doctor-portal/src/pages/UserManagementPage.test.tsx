import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import UserManagementPage from './UserManagementPage';
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

describe('UserManagementPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Admin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        // The page maps snake_case user records: `name` (not `fullName`),
        // `wallet_address` (not `walletAddress`), and lower-case role/status
        // values matching its UserRole / UserStatus unions.
        json: () => Promise.resolve({
          users: [
            {
              user_id: 'u1',
              wallet_address: '5ABC...XYZ',
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
});
