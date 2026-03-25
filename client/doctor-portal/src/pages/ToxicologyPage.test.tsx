import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ToxicologyPage from './ToxicologyPage';
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

describe('ToxicologyPage', () => {
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

  it('renders toxicology page', () => {
    render(<ToxicologyPage />);

    expect(screen.getByText(/Toxicology Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Overdose management and toxidrome assessment/i)).toBeInTheDocument();
  });

  it('displays assessment sections', () => {
    render(<ToxicologyPage />);

    expect(screen.getByText(/Ingestion Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Toxidrome Recognition/i)).toBeInTheDocument();
    expect(screen.getByText(/Antidote Checklist/i)).toBeInTheDocument();
  });

  it('allows selecting a toxidrome', () => {
    render(<ToxicologyPage />);

    const select = screen.getByLabelText(/Suspected Toxidrome/i);
    fireEvent.change(select, { target: { value: 'opioid' } });
    expect(select).toHaveValue('opioid');
  });
});
