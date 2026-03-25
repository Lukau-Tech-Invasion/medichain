import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';
import { useAuthStore, useThemeStore } from '../store';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
  useThemeStore: vi.fn(),
}));

describe('SettingsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    username: 'Dr. Smith',
    role: 'Doctor',
    fullName: 'Smith, J.',
    email: 'smith@hospital.com',
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

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  it('renders settings page with user profile tab active', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/User Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Profile Information/i)).toBeInTheDocument();
    expect(screen.getByText(mockUser.fullName)).toBeInTheDocument();
    expect(screen.getByText(mockUser.email)).toBeInTheDocument();
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

    expect(screen.getByText(/Theme Preferences/i)).toBeInTheDocument();
    
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
      expect(screen.getByText(/All changes saved/i)).toBeInTheDocument();
    });
    
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/settings'),
      expect.objectContaining({
        method: 'POST',
      })
    );
  });
});
