import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import HealthIdCardsPage from './HealthIdCardsPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Spread the real module: it also exports the role predicates the layout uses,
// and replacing it wholesale leaves those undefined, which surfaces as
// "Element type is invalid" rather than as a missing mock.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateNFCCard: vi.fn(),
  getCardInfo: vi.fn(),
  listNFCCards: vi.fn(),
  suspendCard: vi.fn(),
  apiUrl: (path: string) => path,
}));

vi.mock('../components/Toast', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useToastActions: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

describe('HealthIdCardsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: { walletAddress: '5GrwvaEF...mock', role: 'Doctor' },
    });
    vi.mocked(shared.listNFCCards).mockResolvedValue({ cards: [], total: 0 });
  });

  it('renders the card screen', () => {
    render(<HealthIdCardsPage />);
    expect(screen.getAllByText(/Health ID Cards/i).length).toBeGreaterThan(0);
  });

  it('offers no ID type by default, so none is stamped on a card by accident', () => {
    render(<HealthIdCardsPage />);
    const select = screen.getByLabelText(/National ID held/i) as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('does not show an administrator-only registry to a doctor', () => {
    render(<HealthIdCardsPage />);
    expect(screen.queryByRole('button', { name: /^Registry$/i })).not.toBeInTheDocument();
  });

  it('shows the registry tab to an administrator', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      user: { walletAddress: '5Admin...mock', role: 'Admin' },
    });
    render(<HealthIdCardsPage />);
    expect(screen.getByRole('button', { name: /^Registry$/i })).toBeInTheDocument();
  });

  it('refuses to issue a card without a patient and an ID type', () => {
    render(<HealthIdCardsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Issue card/i }));
    // The point: nothing is sent. A card issued against a blank ID type would
    // be a national health credential verified against no national ID system.
    expect(shared.generateNFCCard).not.toHaveBeenCalled();
  });

  it('says the registry could not be read rather than showing it as empty', async () => {
    vi.mocked(useAuthStore).mockReturnValue({
      user: { walletAddress: '5Admin...mock', role: 'Admin' },
    });
    vi.mocked(shared.listNFCCards).mockRejectedValue(new Error('nope'));
    render(<HealthIdCardsPage />);

    fireEvent.click(screen.getByRole('button', { name: /^Registry$/i }));

    // "No cards have been issued" and "the registry could not be read" are
    // opposite facts, and an administrator deciding whether to issue a
    // replacement card needs to know which one they are looking at.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByText(/No cards have been issued yet/i)).not.toBeInTheDocument();
  });
});
