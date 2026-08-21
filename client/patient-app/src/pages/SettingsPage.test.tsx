import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUserSettings,
  saveUserSettings,
  updateMedicalIdPreferences,
} from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { SettingsPage } from './SettingsPage';

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return {
    ...actual,
    debugLog: vi.fn(),
    getUserSettings: vi.fn(),
    saveUserSettings: vi.fn(),
    updateMedicalIdPreferences: vi.fn(),
  };
});

const patient = {
  walletAddress: '5SettingsPatient',
  healthId: 'PAT-SETTINGS-1',
  fullName: 'Settings Patient',
  firstName: 'Settings',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('SettingsPage (Patient)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePatientAuthStore.setState({ patient, isAuthenticated: true });
    vi.mocked(getUserSettings).mockResolvedValue({
      notifications: { emailNotifications: true },
      privacy: { allowEmergencyAccess: true },
      appSettings: { language: 'en' },
    });
    vi.mocked(saveUserSettings).mockResolvedValue({
      success: true,
      message: 'saved',
      user_id: patient.walletAddress,
    });
    vi.mocked(updateMedicalIdPreferences).mockResolvedValue({
      success: true,
      preferences: {},
      message: 'saved',
    });
  });

  it('loads, edits, and persists settings plus Medical ID preferences', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await screen.findByRole('button', { name: /email notifications/i });
    await waitFor(() => expect(getUserSettings).toHaveBeenCalledTimes(1));
    const saveButton = screen.getByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr' } });
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveUserSettings).toHaveBeenCalledTimes(1));
    expect(saveUserSettings).toHaveBeenCalledWith(expect.objectContaining({
      appSettings: expect.objectContaining({ language: 'fr' }),
    }));
    expect(updateMedicalIdPreferences).toHaveBeenCalledWith(
      patient.healthId,
      expect.objectContaining({ show_when_locked: true, display_language: 'fr' }),
    );
    expect(await screen.findByRole('button', { name: /^saved$/i })).toBeInTheDocument();
  });

  it('shows a visible error when persistence fails', async () => {
    vi.mocked(saveUserSettings).mockRejectedValue(new Error('storage unavailable'));
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await screen.findByRole('button', { name: /email notifications/i });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    expect(screen.queryByRole('button', { name: /^saved$/i })).not.toBeInTheDocument();
  });
});
