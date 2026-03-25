import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CardiacPage from './CardiacPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getPatients: vi.fn(),
  createCardiac: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('CardiacPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  const mockPatients = [
    { patient_id: 'PAT-001', full_name: 'John Doe' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue(mockPatients);
  });

  it('renders cardiac page', async () => {
    render(
      <MemoryRouter>
        <CardiacPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Cardiac Event Assessment/i)).toBeInTheDocument();
      expect(screen.getByText(/ECG Monitoring/i)).toBeInTheDocument();
    });
  });

  it('allows selecting a patient', async () => {
    render(
      <MemoryRouter>
        <CardiacPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const select = screen.getByLabelText(/Select Patient/i);
      fireEvent.change(select, { target: { value: 'PAT-001' } });
      expect(select).toHaveValue('PAT-001');
    });
  });

  it('allows entering event details', async () => {
    render(
      <MemoryRouter>
        <CardiacPage />
      </MemoryRouter>
    );

    const select = screen.getByLabelText(/Event Type/i);
    fireEvent.change(select, { target: { value: 'stemi' } });
    expect(select).toHaveValue('stemi');
  });
});
