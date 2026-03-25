import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DrugInteractionsPage from './DrugInteractionsPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  checkDrugInteractions: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('DrugInteractionsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
  });

  it('renders drug interactions page', () => {
    render(<DrugInteractionsPage />);

    expect(screen.getByText(/Drug Interaction Checker/i)).toBeInTheDocument();
    expect(screen.getByText(/Check for potential interactions between multiple medications/i)).toBeInTheDocument();
  });

  it('allows adding medications to check', () => {
    render(<DrugInteractionsPage />);

    const input = screen.getByPlaceholderText(/Add medication to list/i);
    fireEvent.change(input, { target: { value: 'Warfarin' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Warfarin')).toBeInTheDocument();
  });

  it('performs interaction check', async () => {
    (shared.checkDrugInteractions as any).mockResolvedValue({
      interactions: [
        { severity: 'High', description: 'Major interaction between Warfarin and Aspirin' }
      ]
    });

    render(<DrugInteractionsPage />);

    const input = screen.getByPlaceholderText(/Add medication to list/i);
    fireEvent.change(input, { target: { value: 'Warfarin' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    fireEvent.change(input, { target: { value: 'Aspirin' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    const checkButton = screen.getByText(/Check Interactions/i);
    fireEvent.click(checkButton);

    await waitFor(() => {
      expect(screen.getByText(/Major interaction between Warfarin and Aspirin/i)).toBeInTheDocument();
    });
  });
});
