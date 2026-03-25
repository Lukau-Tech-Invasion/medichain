import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SOAPNotePage from './SOAPNotePage';
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

describe('SOAPNotePage', () => {
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

  it('renders SOAP note page', () => {
    render(<SOAPNotePage />);

    expect(screen.getByText(/SOAP Progress Note/i)).toBeInTheDocument();
    expect(screen.getByText(/Structured clinical documentation/i)).toBeInTheDocument();
  });

  it('displays SOAP sections', () => {
    render(<SOAPNotePage />);

    expect(screen.getByText(/Subjective/i)).toBeInTheDocument();
    expect(screen.getByText(/Objective/i)).toBeInTheDocument();
    expect(screen.getByText(/Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Plan/i)).toBeInTheDocument();
  });

  it('allows entering subjective part', () => {
    render(<SOAPNotePage />);

    const input = screen.getByLabelText(/Subjective/i);
    fireEvent.change(input, { target: { value: 'Patient reports mild pain.' } });
    expect(input).toHaveValue('Patient reports mild pain.');
  });
});
