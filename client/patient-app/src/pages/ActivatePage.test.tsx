import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { ActivatePage } from './ActivatePage';
import { usePatientAuthStore } from '../store/authStore';

vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

/**
 * A patient's account is theirs from the first sign-in: they redeem the code the
 * clinic gave them and choose their own username and password. The clinic never
 * sees either.
 */
describe('ActivatePage (Patient)', () => {
  const mockActivate = vi.fn();
  const mockClearError = vi.fn();

  function mockStore(overrides: Record<string, unknown> = {}) {
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      activate: mockActivate,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      clearError: mockClearError,
      ...overrides,
    });
  }

  function renderPage() {
    return render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ActivatePage />
      </BrowserRouter>
    );
  }

  function fill(values: { id?: string; code?: string; username?: string; password?: string; confirm?: string }) {
    const change = (label: RegExp, value?: string) => {
      if (value !== undefined) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    };
    change(/^Patient ID$/i, values.id);
    change(/^Activation code$/i, values.code);
    change(/^Choose a username$/i, values.username);
    change(/^Choose a password$/i, values.password);
    change(/^Confirm password$/i, values.confirm);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore();
  });

  it('asks for the patient id, the code, a username and a password', () => {
    renderPage();

    expect(screen.getByLabelText(/^Patient ID$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Activation code$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Choose a username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Choose a password$/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('formats the code as the patient types it', () => {
    renderPage();

    fill({ code: 'abcd efgh jkmn' });

    expect(screen.getByLabelText(/^Activation code$/i)).toHaveValue('ABCD-EFGH-JKMN');
  });

  it('refuses a short password without contacting the server', async () => {
    renderPage();

    fill({ id: 'PAT-1', code: 'ABCDEFGHJKMN', username: 'thandi.n', password: 'short', confirm: 'short' });
    fireEvent.click(screen.getByRole('button', { name: /Activate and sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters/i);
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('refuses mismatched passwords without contacting the server', async () => {
    renderPage();

    fill({
      id: 'PAT-1',
      code: 'ABCDEFGHJKMN',
      username: 'thandi.n',
      password: 'a long enough password',
      confirm: 'a different long password',
    });
    fireEvent.click(screen.getByRole('button', { name: /Activate and sign in/i }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('redeems the code and goes to the dashboard once signed in', async () => {
    mockActivate.mockResolvedValue(true);
    renderPage();

    fill({
      id: ' PAT-1 ',
      code: 'ABCDEFGHJKMN',
      username: 'thandi.n',
      password: 'a long enough password',
      confirm: 'a long enough password',
    });
    fireEvent.click(screen.getByRole('button', { name: /Activate and sign in/i }));

    await waitFor(() => {
      expect(mockActivate).toHaveBeenCalledWith({
        identifier: 'PAT-1',
        code: 'ABCD-EFGH-JKMN',
        username: 'thandi.n',
        password: 'a long enough password',
      });
    });
  });

  it('leaves the fields for a retry, but not the password, after a refusal', async () => {
    mockActivate.mockResolvedValue(false);
    renderPage();

    fill({
      id: 'PAT-1',
      code: 'ABCDEFGHJKMN',
      username: 'thandi.n',
      password: 'a long enough password',
      confirm: 'a long enough password',
    });
    fireEvent.click(screen.getByRole('button', { name: /Activate and sign in/i }));

    await waitFor(() => expect(mockActivate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/^Choose a password$/i)).toHaveValue(''));
    expect(screen.getByLabelText(/^Choose a username$/i)).toHaveValue('thandi.n');
  });

  it('shows the server error as an alert', () => {
    mockStore({ error: 'That activation code is not valid, has expired, or was already used.' });
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(/not valid, has expired/i);
  });
});
