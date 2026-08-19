import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ChainOfCustodyPage from './ChainOfCustodyPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

    expect(screen.getByText(/Chain of Custody/i)).toBeInTheDocument();
    expect(screen.getByText(/Forensic specimen tracking and custody documentation/i)).toBeInTheDocument();
  });

  it('allows entering item description', () => {
    render(<ChainOfCustodyPage />);

    // Collection fields live on the 'New Collection' tab; the page opens on
    // the active-custody list.
    fireEvent.click(screen.getByRole('button', { name: /New Collection/i }));
    const input = screen.getByLabelText(/Specimen Description/i);
    fireEvent.change(input, { target: { value: 'Blood sample tube' } });
    expect(input).toHaveValue('Blood sample tube');
  });

  it('allows entering collection details', () => {
    render(<ChainOfCustodyPage />);

    fireEvent.click(screen.getByRole('button', { name: /New Collection/i }));
    const locationInput = screen.getByLabelText(/Collection Location/i);
    fireEvent.change(locationInput, { target: { value: 'ER Room 2' } });
    expect(locationInput).toHaveValue('ER Room 2');
  });
});
