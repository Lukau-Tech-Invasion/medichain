import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SpecimenPage from './SpecimenPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getPatients: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('SpecimenPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders specimen collection page', () => {
    render(<SpecimenPage />);

    expect(screen.getByText(/Specimen Collection/i)).toBeInTheDocument();
    expect(screen.getByText(/Document the collection of laboratory specimens/i)).toBeInTheDocument();
  });

  it('displays collection details section', () => {
    render(<SpecimenPage />);

    expect(screen.getByText(/Specimen Details/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Specimen Type/i)).toBeInTheDocument();
  });

  it('allows selecting specimen type', () => {
    render(<SpecimenPage />);

    const select = screen.getByLabelText(/Specimen Type/i);
    fireEvent.change(select, { target: { value: 'Blood' } });
    expect(select).toHaveValue('Blood');
  });
});
