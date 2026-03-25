import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import EPrescribePage from './EPrescribePage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('EPrescribePage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/medications/search')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 'm1', name: 'Amoxicillin', strength: '500mg' },
            { id: 'm2', name: 'Lisinopril', strength: '10mg' },
          ]),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders e-prescribe page', () => {
    render(
      <MemoryRouter>
        <EPrescribePage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Electronic Prescription/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search for medication/i)).toBeInTheDocument();
  });

  it('allows searching for medication', async () => {
    render(
      <MemoryRouter>
        <EPrescribePage />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/Search for medication/i);
    fireEvent.change(input, { target: { value: 'Amox' } });

    await waitFor(() => {
      expect(screen.getByText(/Amoxicillin/i)).toBeInTheDocument();
    });
  });

  it('allows entering dosage instructions', async () => {
    render(
      <MemoryRouter>
        <EPrescribePage />
      </MemoryRouter>
    );

    const dosageInput = screen.getByPlaceholderText(/Enter dosage/i);
    fireEvent.change(dosageInput, { target: { value: '1 tablet' } });
    expect(dosageInput).toHaveValue('1 tablet');

    const instructionsInput = screen.getByPlaceholderText(/Instructions for patient/i);
    fireEvent.change(instructionsInput, { target: { value: 'Take twice daily' } });
    expect(instructionsInput).toHaveValue('Take twice daily');
  });
});
