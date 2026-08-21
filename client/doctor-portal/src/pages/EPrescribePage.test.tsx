import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import EPrescribePage from './EPrescribePage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// The specifier must match the one the component imports -- this page imports
// '../store/authStore', and a mock registered against '../store' silently does
// not apply, leaving the user undefined.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve([
            { id: 'm1', name: 'Amoxicillin', strength: '500mg' },
            { id: 'm2', name: 'Lisinopril', strength: '10mg' },
          ]),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
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

    expect(screen.getByText(/E-Prescribing/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Amoxicillin/i)).toBeInTheDocument();
  });

  it('records the medication name and strength', async () => {
    render(
      <MemoryRouter>
        <EPrescribePage />
      </MemoryRouter>
    );

    // The medication name is a free-text field, not a typeahead — this page
    // has no /api/medications/search lookup behind it.
    const name = screen.getByPlaceholderText(/Amoxicillin/i);
    fireEvent.change(name, { target: { value: 'Amoxicillin' } });
    expect(name).toHaveValue('Amoxicillin');

    const strength = screen.getByPlaceholderText(/500mg/i);
    fireEvent.change(strength, { target: { value: '250mg' } });
    expect(strength).toHaveValue('250mg');
  });

  it('allows entering dosage instructions', async () => {
    render(
      <MemoryRouter>
        <EPrescribePage />
      </MemoryRouter>
    );

    const dosageInput = screen.getByPlaceholderText(/500mg/i);
    fireEvent.change(dosageInput, { target: { value: '1 tablet' } });
    expect(dosageInput).toHaveValue('1 tablet');

    const instructionsInput = screen.getByPlaceholderText(/Complete entire course/i);
    fireEvent.change(instructionsInput, { target: { value: 'Take twice daily' } });
    expect(instructionsInput).toHaveValue('Take twice daily');
  });
});
