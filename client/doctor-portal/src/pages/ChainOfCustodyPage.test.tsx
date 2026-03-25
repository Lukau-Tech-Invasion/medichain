import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ChainOfCustodyPage from './ChainOfCustodyPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

describe('ChainOfCustodyPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    username: 'Dr. Forensic',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
  });

  it('renders chain of custody page', () => {
    render(<ChainOfCustodyPage />);

    expect(screen.getByText(/Evidence Chain of Custody/i)).toBeInTheDocument();
    expect(screen.getByText(/Document the collection and handling of forensic evidence/i)).toBeInTheDocument();
  });

  it('allows entering item description', () => {
    render(<ChainOfCustodyPage />);

    const input = screen.getByLabelText(/Item Description/i);
    fireEvent.change(input, { target: { value: 'Blood sample tube' } });
    expect(input).toHaveValue('Blood sample tube');
  });

  it('allows entering collection details', () => {
    render(<ChainOfCustodyPage />);

    const locationInput = screen.getByLabelText(/Collection Location/i);
    fireEvent.change(locationInput, { target: { value: 'ER Room 2' } });
    expect(locationInput).toHaveValue('ER Room 2');
  });
});
