import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as shared from '@medichain/shared';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrderSets: vi.fn(),
}));

// Order sets come from the API — this page ships no built-in library.
const ORDER_SETS = [
  {
    setId: 'OS-001',
    name: 'Chest Pain Rule-Out',
    type: 'protocol',
    specialty: 'Cardiology',
    description: 'Initial workup for undifferentiated chest pain',
    indication: 'Chest pain',
    orders: [
      { orderId: 'O-1', type: 'medication', description: 'Aspirin 300 mg PO stat', priority: 'stat' },
      { orderId: 'O-2', type: 'lab', description: 'Troponin, serial', priority: 'urgent' },
    ],
    createdBy: 'Dr Smith',
    createdAt: '2026-08-01T00:00:00Z',
    lastModified: '2026-08-01T00:00:00Z',
    usageCount: 42,
    isActive: true,
    tags: ['cardiology'],
  },
  {
    setId: 'OS-002',
    name: 'Sepsis Protocol',
    type: 'emergency',
    specialty: 'Emergency',
    description: 'Sepsis Six bundle',
    indication: 'Suspected sepsis',
    orders: [
      { orderId: 'O-3', type: 'medication', description: 'Broad-spectrum antibiotics', priority: 'stat' },
    ],
    createdBy: 'Dr Smith',
    createdAt: '2026-08-01T00:00:00Z',
    lastModified: '2026-08-01T00:00:00Z',
    usageCount: 18,
    isActive: true,
    tags: ['sepsis'],
  },
];

beforeEach(() => {
  (shared.getOrderSets as any).mockResolvedValue(ORDER_SETS);
});
import { vi, describe, it, expect, beforeEach } from 'vitest';
import OrderSetsPage from './OrderSetsPage';

describe('OrderSetsPage', () => {
  it('renders order sets page', () => {
    render(<OrderSetsPage />);

    expect(screen.getAllByText(/Order Sets/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Pre-defined clinical order templates and protocols/i)).toBeInTheDocument();
  });

  it('displays available order sets', async () => {
    render(<OrderSetsPage />);

    await waitFor(() =>
      expect(screen.getByText(/Chest Pain Rule-Out/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Sepsis Protocol/i)).toBeInTheDocument();
  });

  it('shows the orders each set contains', async () => {
    render(<OrderSetsPage />);

    await waitFor(() =>
      expect(screen.getByText(/Aspirin 300 mg PO stat/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Troponin, serial/i)).toBeInTheDocument();
  });
});
