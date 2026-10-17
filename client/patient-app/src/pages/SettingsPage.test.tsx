import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUserSettings,
  saveUserSettings,
  updateMedicalIdPreferences,
  DialogHost,
} from '@medichain/shared';
import * as shared from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { SettingsPage } from './SettingsPage';

// This suite renders a real MemoryRouter so navigation assertions must use its actual hooks.
vi.mock('react-router-dom', async importOriginal => importOriginal<typeof import('react-router-dom')>());

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return {
    ...actual,
    debugLog: vi.fn(),
    getUserSettings: vi.fn(),
    getResearchConsent: vi.fn(),
    saveUserSettings: vi.fn(),
    updateMedicalIdPreferences: vi.fn(),
    listMyMobileDevices: vi.fn(),
    mfaDisable: vi.fn(),
    mfaEnroll: vi.fn(),
    mfaStatus: vi.fn(),
    mfaVerify: vi.fn(),
    revokeMobileDevice: vi.fn(),
  };
});

const patient = {
  userId: '5SettingsPatient',
  healthId: 'PAT-SETTINGS-1',
  fullName: 'Settings Patient',
  firstName: 'Settings',
  createdAt: '2026-01-01T00:00:00Z',
};
const originalLogout = usePatientAuthStore.getState().logout;

describe('SettingsPage (Patient)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.getResearchConsent).mockResolvedValue(null);
    vi.mocked(shared.listMyMobileDevices).mockResolvedValue({
      success: true,
      count: 0,
      devices: [],
    } as never);
    vi.mocked(shared.mfaStatus).mockResolvedValue({ success: true, enrolled: false, enabled: false });
    usePatientAuthStore.setState({ patient, isAuthenticated: true, logout: originalLogout });
    vi.mocked(getUserSettings).mockResolvedValue({
      notifications: { emailNotifications: true },
      privacy: { allowEmergencyAccess: true },
      appSettings: { language: 'en' },
    });
    vi.mocked(saveUserSettings).mockResolvedValue({
      success: true,
      message: 'saved',
      user_id: patient.userId,
    });
    vi.mocked(updateMedicalIdPreferences).mockResolvedValue({
      success: true,
      preferences: {},
      message: 'saved',
    });
  });

  it('opens Personal Information within the patient router base', async () => {
    render(<MemoryRouter basename="/patient" initialEntries={['/patient/settings']}><Routes>
      <Route path="settings" element={<SettingsPage />} />
      <Route path="profile" element={<h1>Patient profile destination</h1>} />
    </Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Personal Information Update your name/i }));
    expect(await screen.findByRole('heading', { name: 'Patient profile destination' })).toBeVisible();
    expect(saveUserSettings).not.toHaveBeenCalled();
  });

  it('describes password authentication and names the language selector', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    expect(screen.getByText('Sign in with your password. You can add an authenticator app for two-factor authentication.')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeVisible();
  });

  it('offers an accessible sign-out dialog and preserves the session when cancelled', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    usePatientAuthStore.setState({ logout });
    render(<MemoryRouter><DialogHost /><SettingsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /^Sign Out$/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Sign Out?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(logout).not.toHaveBeenCalled();
  });

  it('confirms once and waits for session revocation before navigating', async () => {
    let finishLogout!: () => void;
    const logout = vi.fn(() => new Promise<void>(resolve => { finishLogout = resolve; }));
    usePatientAuthStore.setState({ logout });
    render(<MemoryRouter initialEntries={['/settings']}><DialogHost /><Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/login" element={<h1>Signed out destination</h1>} />
    </Routes></MemoryRouter>);
    const opener = await screen.findByRole('button', { name: /^Sign Out$/ });
    fireEvent.click(opener);
    fireEvent.click(opener);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sign Out$/ }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Signed out destination')).not.toBeInTheDocument();
    await act(async () => finishLogout());
    expect(await screen.findByText('Signed out destination')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('applies each text size immediately and includes it in saved settings', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    const large = await screen.findByRole('button', { name: /^large$/i });
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
    fireEvent.click(large);
    expect(document.documentElement.style.fontSize).toBe('112.5%');
    fireEvent.click(screen.getByRole('button', { name: /^small$/i }));
    expect(document.documentElement.style.fontSize).toBe('87.5%');
    fireEvent.click(screen.getByRole('button', { name: /^medium$/i }));
    expect(document.documentElement.style.fontSize).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(saveUserSettings).toHaveBeenCalledWith(expect.objectContaining({
      appSettings: expect.objectContaining({ fontSize: 'medium' }),
    })));
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

  it('enrolls an authenticator and confirms its server status', async () => {
    vi.mocked(shared.mfaEnroll).mockResolvedValue({
      success: true,
      secret: 'JBSWY3DPEHPK3PXP',
      otpauth_uri: 'otpauth://totp/MediChain:test',
      qr_code_base64: 'ZmFrZS1xci1jb2Rl',
    });
    vi.mocked(shared.mfaVerify).mockResolvedValue({ success: true, message: 'enabled' });
    vi.mocked(shared.mfaStatus)
      .mockResolvedValueOnce({ success: true, enrolled: false, enabled: false })
      .mockResolvedValueOnce({ success: true, enrolled: true, enabled: true });
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /set up two-factor/i }));
    expect(await screen.findByAltText(/QR code for pairing/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/code from your app/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm and enable/i }));

    await waitFor(() => expect(shared.mfaVerify).toHaveBeenCalledWith('123456'));
    expect(await screen.findByRole('status')).toHaveTextContent(/two-factor authentication is on/i);
    expect(screen.getByTestId('mfa-status')).toHaveTextContent(/^On$/);
  });

  // --- Devices that can open my records --------------------------------------
  //
  // Four mobile endpoints existed and all four write. A device id is returned
  // exactly once -- in the response to the registration that created it -- so a
  // patient who lost a phone could not name the device to revoke, and the
  // revoke endpoint was unreachable in practice.

  const device = (over: Record<string, unknown> = {}) => ({
    id: 'DEV-1',
    patient_id: 'PAT-1',
    device_label: 'Nokia G21',
    platform: 'android',
    public_key: 'pk-1',
    status: 'active',
    last_synchronised_at: null,
    revoked_at: null,
    revocation_reason: null,
    ...over,
  });

  it('lists the devices that can open my records', async () => {
    vi.mocked(shared.listMyMobileDevices).mockResolvedValue({
      success: true,
      count: 1,
      devices: [device()],
    } as never);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Nokia G21')).toBeInTheDocument());
  });

  it('keeps a revoked device listed, marked, and without a revoke button', async () => {
    vi.mocked(shared.listMyMobileDevices).mockResolvedValue({
      success: true,
      count: 1,
      devices: [device({ status: 'revoked', revoked_at: '2026-09-15T00:00:00Z' })],
    } as never);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    // Seeing that the lost phone can no longer open anything is the whole
    // reason to come to this screen.
    await waitFor(() => expect(screen.getByText(/Revoked .*2026/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Revoke$/i })).not.toBeInTheDocument();
  });

  it('revokes a device and re-reads the list', async () => {
    vi.mocked(shared.listMyMobileDevices).mockResolvedValue({
      success: true,
      count: 1,
      devices: [device()],
    } as never);
    vi.mocked(shared.revokeMobileDevice).mockResolvedValue(
      device({ status: 'revoked', revoked_at: '2026-09-15T00:00:00Z' }) as never
    );
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /^Revoke$/i }));

    await waitFor(() =>
      expect(shared.revokeMobileDevice).toHaveBeenCalledWith('DEV-1', expect.any(String))
    );
    // A write nobody reads back is the defect this codebase keeps finding.
    await waitFor(() => expect(shared.listMyMobileDevices).toHaveBeenCalledTimes(2));
  });

  it('does not claim no devices are registered when the read failed', async () => {
    vi.mocked(shared.listMyMobileDevices).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    // "No device has been registered" tells a patient their lost phone cannot
    // open anything. If the read failed, they do not know that.
    await waitFor(() =>
      expect(screen.getByText(/not a confirmation that none are registered/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/No device has been registered/i)).not.toBeInTheDocument();
  });

});
