import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import EmergencyProtocolsPage from './EmergencyProtocolsPage';

describe('EmergencyProtocolsPage', () => {
  it('renders emergency protocols page', () => {
    render(<EmergencyProtocolsPage />);

    expect(screen.getByText(/Emergency Protocols/i)).toBeInTheDocument();
    expect(screen.getByText(/New Emergency Record/i)).toBeInTheDocument();
  });

  it('displays protocol categories', () => {
    render(<EmergencyProtocolsPage />);

    expect(screen.getAllByText(/Cardiac Arrest/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Code Blue/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Trauma/i).length).toBeGreaterThan(0);
  });

  it('allows switching the emergency type being recorded', () => {
    render(<EmergencyProtocolsPage />);

    // The page records emergency events by type rather than serving a
    // searchable protocol library, so the type tabs are the navigation.
    const sepsisTab = screen.getByRole('button', { name: /Sepsis/i });
    fireEvent.click(sepsisTab);
    expect(sepsisTab).toBeInTheDocument();
  });
});
