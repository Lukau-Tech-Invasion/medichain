import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import LanguageSettingsPage from './LanguageSettingsPage';

describe('LanguageSettingsPage (Patient)', () => {
  it('renders language settings page with languages', () => {
    render(<LanguageSettingsPage />);

    expect(screen.getByText(/Language & Region/i)).toBeInTheDocument();
    expect(screen.getByText(/English \(US\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Spanish \(Spain\)/i)).toBeInTheDocument();
  });

  it('allows searching for a language', () => {
    render(<LanguageSettingsPage />);

    const searchInput = screen.getByPlaceholderText(/Search languages/i);
    fireEvent.change(searchInput, { target: { value: 'French' } });

    expect(screen.getByText(/French/i)).toBeInTheDocument();
    expect(screen.queryByText(/Spanish \(Spain\)/i)).not.toBeInTheDocument();
  });

  it('allows toggling regional settings', () => {
    render(<LanguageSettingsPage />);

    const toggleButton = screen.getByText(/Show Regional Settings/i);
    fireEvent.click(toggleButton);

    expect(screen.getByText(/Date Format/i)).toBeInTheDocument();
    expect(screen.getByText(/Temperature Unit/i)).toBeInTheDocument();
  });

  it('handles saving settings', async () => {
    render(<LanguageSettingsPage />);

    const saveButton = screen.getByText(/Save Changes/i);
    fireEvent.click(saveButton);

    expect(screen.getByText(/Saving.../i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText(/Changes saved/i)).toBeInTheDocument();
    });
  });
});
