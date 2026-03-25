import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import FamilyHistoryPage from './FamilyHistoryPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getPatients: vi.fn(),
  getFamilyHistory: vi.fn(),
  createFamilyHistory: vi.fn(),
}));

// Mock components
vi.mock('../components/PedigreeChart', () => ({
  default: () => <div data-testid="pedigree-chart">Pedigree Chart</div>,
}));

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

describe('FamilyHistoryPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  const mockFamilyMembers = [
    {
      memberId: '1',
      relationship: 'mother',
      vitalStatus: 'alive',
      conditions: [{ conditionName: 'Diabetes', category: 'diabetes' }],
      recordedAt: new Date().toISOString(),
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getFamilyHistory as any).mockResolvedValue(mockFamilyMembers);
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders family history page', async () => {
    render(<FamilyHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText(/Family Health History/i)).toBeInTheDocument();
      expect(screen.getByText(/mother/i)).toBeInTheDocument();
      expect(screen.getByText(/Diabetes/i)).toBeInTheDocument();
    });
  });

  it('allows switching to risk assessment tab', async () => {
    render(<FamilyHistoryPage />);

    const riskTab = screen.getByText(/Risk Assessment/i);
    fireEvent.click(riskTab);
    
    expect(screen.getByText(/Hereditary Risk Analysis/i)).toBeInTheDocument();
  });

  it('allows switching to pedigree tab', async () => {
    render(<FamilyHistoryPage />);

    const pedigreeTab = screen.getByText(/Pedigree Chart/i);
    fireEvent.click(pedigreeTab);
    
    expect(screen.getByTestId('pedigree-chart')).toBeInTheDocument();
  });
});
