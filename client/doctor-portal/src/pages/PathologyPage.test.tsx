import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PathologyPage from './PathologyPage';
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

describe('PathologyPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Pathologist',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders pathology page', () => {
    render(<PathologyPage />);

    expect(screen.getByText(/Pathology & Laboratory/i)).toBeInTheDocument();
    expect(screen.getByText(/Documentation and analysis of tissue samples and specimens/i)).toBeInTheDocument();
  });

  it('displays assessment sections', () => {
    render(<PathologyPage />);

    expect(screen.getByText(/Specimen Information/i)).toBeInTheDocument();
    expect(screen.getByText(/Gross Description/i)).toBeInTheDocument();
    expect(screen.getByText(/Microscopic Examination/i)).toBeInTheDocument();
  });

  it('allows entering gross description', () => {
    render(<PathologyPage />);

    const input = screen.getByLabelText(/Gross Description/i);
    fireEvent.change(input, { target: { value: 'Specimen consists of a 2cm skin punch biopsy.' } });
    expect(input).toHaveValue('Specimen consists of a 2cm skin punch biopsy.');
  });
});
