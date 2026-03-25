import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import UserManagementPage from './UserManagementPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
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
        json: () => Promise.resolve({
          users: [
            {
              id: 'u1',
              username: 'dr_smith',
              role: 'Doctor',
              fullName: 'John Smith',
              walletAddress: '5ABC...XYZ',
              status: 'Active',
            }
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
      expect(screen.getByText(/User & RBAC Management/i)).toBeInTheDocument();
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

    const rolesTab = screen.getByText(/Roles/i);
    fireEvent.click(rolesTab);
    
    expect(screen.getByText(/Role Permissions/i)).toBeInTheDocument();
  });
});
