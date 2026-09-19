import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import OrdersPage from './OrdersPage';
import { useAuthStore } from '../store';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listOrders: vi.fn(),
}));

describe('OrdersPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    vi.mocked(shared.listOrders).mockResolvedValue({
      success: true,
      orders: [
        {
          order_id: 'o1',
          patient_id: 'PAT-001',
          order_type: 'lab',
          order_details: 'CBC with diff',
          priority: 'routine',
          status: 'in_progress',
          notes: null,
          ordering_provider: 'Dr Smith',
          ordered_at: '2026-08-12T10:00:00Z',
        },
      ],
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
      expect(screen.getByText(/PAT-001/i)).toBeInTheDocument();
    });

    expect(screen.getByTestId('orders-in-progress-count')).toHaveTextContent('1');
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
