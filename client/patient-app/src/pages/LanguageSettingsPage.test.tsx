import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserSettings, saveUserSettings, setLanguagePreference } from '@medichain/shared';
import LanguageSettingsPage from './LanguageSettingsPage';

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return {
    ...actual,
    getUserSettings: vi.fn(),
    saveUserSettings: vi.fn(),
    setLanguagePreference: vi.fn(),
  };
});

describe('LanguageSettingsPage (Patient)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserSettings).mockResolvedValue({});
    vi.mocked(saveUserSettings).mockResolvedValue({ success: true, message: 'saved', user_id: 'patient' });
    vi.mocked(setLanguagePreference).mockResolvedValue({ success: true, message: 'saved' });
  });

  it('renders language settings page with languages', () => {
    render(<LanguageSettingsPage />);

    expect(screen.getByText(/Language & Region/i)).toBeInTheDocument();
    expect(screen.getAllByText(/English \(US\)/i).length).toBeGreaterThan(0);
    // A locale that is ~1% translated is listed so patients know it is coming,
    // but it cannot be chosen: selecting it would put a Kiswahili Save button
    // on an English medication list.
    const kiswahili = screen.getAllByText(/Kiswahili/i)[0].closest('button');
    expect(kiswahili).toBeDisabled();
  });

  it('allows searching for a language', () => {
    render(<LanguageSettingsPage />);

    const searchInput = screen.getByPlaceholderText(/Search languages/i);
    fireEvent.change(searchInput, { target: { value: 'French' } });

    expect(screen.getByText(/French/i)).toBeInTheDocument();
    expect(screen.queryByText(/Kiswahili/i)).not.toBeInTheDocument();
  });

  it('allows toggling regional settings', () => {
    render(<LanguageSettingsPage />);

    const toggleButton = screen.getByText(/Regional Format Settings/i);
    fireEvent.click(toggleButton);

    expect(screen.getByText(/Date Format/i)).toBeInTheDocument();
    expect(screen.getByText(/Temperature Unit/i)).toBeInTheDocument();
  });

  it('handles saving settings', async () => {
    render(<LanguageSettingsPage />);

    const saveButton = screen.getByText(/Save Language Settings/i);
    fireEvent.click(saveButton);

    expect(screen.getByText(/Saving.../i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText(/Settings Saved/i)).toBeInTheDocument();
    });
    expect(setLanguagePreference).toHaveBeenCalledWith({ language_code: 'en-US' });
    expect(saveUserSettings).toHaveBeenCalledWith(expect.objectContaining({
      regionalSettings: expect.objectContaining({ dateFormat: 'MM/DD/YYYY' }),
    }));
  });

  it('loads stored regional settings and preserves unrelated preferences on save', async () => {
    vi.mocked(getUserSettings)
      .mockResolvedValueOnce({
        wearables: { syncSteps: true },
        regionalSettings: {
          dateFormat: 'YYYY-MM-DD',
          timeFormat: '24h',
          firstDayOfWeek: 'monday',
          temperatureUnit: 'celsius',
          measurementSystem: 'metric',
          currencySymbol: 'R',
          numberFormat: 'period-comma',
        },
      })
      .mockResolvedValueOnce({ wearables: { syncSteps: true } });
    render(<LanguageSettingsPage />);

    fireEvent.click(await screen.findByText(/Regional Format Settings/i));
    expect(screen.getByLabelText(/Date Format/i)).toHaveValue('YYYY-MM-DD');
    fireEvent.click(screen.getByText(/Save Language Settings/i));

    await waitFor(() => expect(saveUserSettings).toHaveBeenCalledTimes(1));
    expect(saveUserSettings).toHaveBeenCalledWith(expect.objectContaining({
      wearables: { syncSteps: true },
      regionalSettings: expect.objectContaining({
        timeFormat: '24h',
        measurementSystem: 'metric',
      }),
    }));
  });

  it('does not claim success when a settings write fails', async () => {
    vi.mocked(saveUserSettings).mockRejectedValue(new Error('storage unavailable'));
    render(<LanguageSettingsPage />);

    fireEvent.click(screen.getByText(/Save Language Settings/i));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i);
    expect(screen.queryByText(/Settings Saved/i)).not.toBeInTheDocument();
  });
});
