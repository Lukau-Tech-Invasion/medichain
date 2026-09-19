import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LanguageSettingsPage from './LanguageSettingsPage';

describe('LanguageSettingsPage (Patient)', () => {
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
  });
});
