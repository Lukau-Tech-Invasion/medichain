import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import OrdersPage from './OrdersPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OrdersPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
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
        json: () => Promise.resolve({
          orders: [
            // The page reads snake_case `PhysicianOrder` fields
            // (order_id/order_type/order_details/ordered_at); the generated
            // fixture used camelCase `description`/`orderType`, which the
            // component never looks at, so rows rendered blank.
            {
              order_id: 'o1',
              patient_id: 'PAT-001',
              patient_name: 'John Doe',
              order_type: 'lab',
              order_details: 'CBC with diff',
              priority: 'routine',
              status: 'active',
              ordered_by: 'Dr Smith',
              ordered_at: 1755000000,
            },
          ],
        }),
      });
    });
  });

  it('renders orders page', async () => {
    render(
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Physician Orders/i)).toBeInTheDocument();
      expect(screen.getByText(/CBC with diff/i)).toBeInTheDocument();
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
    });
  });

  it('allows filtering by order type', async () => {
    render(
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/All Statuses/i)).toBeInTheDocument();
    });
  });
});
