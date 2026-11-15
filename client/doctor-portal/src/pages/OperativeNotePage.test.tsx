import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import OperativeNotePage from './OperativeNotePage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  getProviders: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('OperativeNotePage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Surgeon',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    vi.mocked(shared.getProviders).mockResolvedValue({
      providers: [
        { user_id: '5GrwvaEF...mock', name: 'Dr Author', role: 'Doctor' },
        { user_id: 'doc-2', name: 'Dr Second', role: 'Doctor' },
      ],
    } as unknown as Awaited<ReturnType<typeof shared.getProviders>>);
  });

  it('renders operative note page', () => {
    render(<OperativeNotePage />);

    expect(screen.getAllByText(/Operative Note/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Surgical procedure documentation/i)).toBeInTheDocument();
  });

  it('displays procedure details section', () => {
    render(<OperativeNotePage />);

    expect(screen.getByText(/Pre-operative Diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/Post-operative Diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/Procedure Name/i)).toBeInTheDocument();
  });

  // The surgeon is a person picked from the staff directory, not an id typed
  // into a box; it starts as the author, who knows who operated.
  it('chooses the surgeon from the doctors on the staff directory', async () => {
    render(<OperativeNotePage />);

    await waitFor(() => expect(shared.getProviders).toHaveBeenCalledWith('Doctor'));
    expect(await screen.findByText('Dr Author')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^Surgeon.*Dr Author/i));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Surgeon/i }), { target: { value: 'Second' } });
    fireEvent.click(await screen.findByText('Dr Second'));
    expect(await screen.findByText('Dr Second')).toBeInTheDocument();
    expect(screen.queryByText('Dr Author')).not.toBeInTheDocument();
  });
});
