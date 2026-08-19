import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';
import { useAuthStore, useThemeStore } from '../store';
import { getUserSettings, saveUserSettings } from '@medichain/shared';

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return {
    ...actual,
    debugLog: vi.fn(),
    getUserSettings: vi.fn(),
    saveUserSettings: vi.fn(),
  };
});

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
  useThemeStore: vi.fn(),
}));

describe('SettingsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    username: 'Dr. Smith',
    role: 'Doctor',
    userId: '5GrwvaEF...mock',
    createdAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });
    (useThemeStore as any).mockReturnValue({
      theme: 'light',
      setTheme: vi.fn(),
    });

    vi.mocked(getUserSettings).mockResolvedValue({});
    vi.mocked(saveUserSettings).mockResolvedValue({
      success: true,
      message: 'saved',
      user_id: mockUser.walletAddress,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    });
  });

  it('renders settings page with user profile tab active', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/Settings/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Profile Information/i)).toBeInTheDocument();
    expect(screen.getByText(mockUser.username)).toBeInTheDocument();
    expect(screen.getByDisplayValue(`${mockUser.username}@medichain.health`)).toBeInTheDocument();
  });

  it('allows switching to notifications tab', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    const notificationsTab = screen.getByText(/Notifications/i);
    fireEvent.click(notificationsTab);

    expect(screen.getByText(/Emergency Alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/Patient Updates/i)).toBeInTheDocument();
  });

  it('allows switching to security tab', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    const securityTab = screen.getByText(/Security/i);
    fireEvent.click(securityTab);

    expect(screen.getByText(/Two-Factor Authentication/i)).toBeInTheDocument();
    expect(screen.getByText(/Session Timeout/i)).toBeInTheDocument();
  });

  it('allows switching to display tab and changing theme', async () => {
    const { setTheme } = (useThemeStore as any)();
    
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    const displayTab = screen.getByText(/Display/i);
    fireEvent.click(displayTab);

    expect(screen.getByText(/Display Preferences/i)).toBeInTheDocument();
    
    const darkThemeButton = screen.getByText(/Dark/i);
    fireEvent.click(darkThemeButton);
    
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('handles saving settings', async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    const saveButton = screen.getByText(/Save Changes/i);
    fireEvent.click(saveButton);

    expect(screen.getByText(/Saving.../i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText(/^Saved!$/i)).toBeInTheDocument();
    });
    
    expect(saveUserSettings).toHaveBeenCalledTimes(1);
  });
});
