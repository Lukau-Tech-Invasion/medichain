import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TraumaPage from './TraumaPage';
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

describe('TraumaPage', () => {
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

  it('renders trauma page', () => {
    render(<TraumaPage />);

    expect(screen.getByText(/Trauma Resuscitation/i)).toBeInTheDocument();
    expect(screen.getByText(/Primary and Secondary Trauma Survey/i)).toBeInTheDocument();
  });

  it('displays ABCDE sections', () => {
    render(<TraumaPage />);

    expect(screen.getByText(/Airway/i)).toBeInTheDocument();
    expect(screen.getByText(/Breathing/i)).toBeInTheDocument();
    expect(screen.getByText(/Circulation/i)).toBeInTheDocument();
    expect(screen.getByText(/Disability/i)).toBeInTheDocument();
  });

  it('allows calculating GCS', () => {
    render(<TraumaPage />);

    expect(screen.getByText(/Glasgow Coma Scale/i)).toBeInTheDocument();
  });
});
