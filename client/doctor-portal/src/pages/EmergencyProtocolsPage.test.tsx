import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import EmergencyProtocolsPage from './EmergencyProtocolsPage';

describe('EmergencyProtocolsPage', () => {
  it('renders emergency protocols page', () => {
    render(<EmergencyProtocolsPage />);

    expect(screen.getByText(/Emergency Medical Protocols/i)).toBeInTheDocument();
    expect(screen.getByText(/Select a protocol to view guidelines and checklists/i)).toBeInTheDocument();
  });

  it('displays protocol categories', () => {
    render(<EmergencyProtocolsPage />);

    expect(screen.getByText(/Cardiac/i)).toBeInTheDocument();
    expect(screen.getByText(/Respiratory/i)).toBeInTheDocument();
    expect(screen.getByText(/Trauma/i)).toBeInTheDocument();
  });

  it('allows searching for a protocol', () => {
    render(<EmergencyProtocolsPage />);

    const input = screen.getByPlaceholderText(/Search protocols/i);
    fireEvent.change(input, { target: { value: 'ACLS' } });
    expect(input).toHaveValue('ACLS');
  });
});
