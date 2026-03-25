import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SepsisPage from './SepsisPage';
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

describe('SepsisPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders sepsis page', () => {
    render(<SepsisPage />);

    expect(screen.getByText(/Sepsis Assessment & Bundle/i)).toBeInTheDocument();
    expect(screen.getByText(/Early recognition and evidence-based management of sepsis/i)).toBeInTheDocument();
  });

  it('displays screening tools', () => {
    render(<SepsisPage />);

    expect(screen.getByText(/qSOFA Score/i)).toBeInTheDocument();
    expect(screen.getByText(/SIRS Criteria/i)).toBeInTheDocument();
  });

  it('allows calculating qSOFA', () => {
    render(<SepsisPage />);

    const systolicInput = screen.getByLabelText(/Systolic BP ≤ 100/i);
    fireEvent.click(systolicInput);

    expect(screen.getByText(/qSOFA Total:/i)).toBeInTheDocument();
  });
});
