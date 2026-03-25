import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import OrderSetsPage from './OrderSetsPage';

describe('OrderSetsPage', () => {
  it('renders order sets page', () => {
    render(<OrderSetsPage />);

    expect(screen.getByText(/Clinical Order Sets/i)).toBeInTheDocument();
    expect(screen.getByText(/Standardized evidence-based order sets by condition/i)).toBeInTheDocument();
  });

  it('displays available order sets', () => {
    render(<OrderSetsPage />);

    expect(screen.getByText(/Chest Pain \/ ACS/i)).toBeInTheDocument();
    expect(screen.getByText(/Sepsis Protocol/i)).toBeInTheDocument();
    expect(screen.getByText(/Stroke \/ TIA/i)).toBeInTheDocument();
  });

  it('allows selecting an order set to view details', () => {
    render(<OrderSetsPage />);

    const orderSet = screen.getByText(/Chest Pain \/ ACS/i);
    fireEvent.click(orderSet);

    expect(screen.getByText(/Order Set Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Medications/i)).toBeInTheDocument();
    expect(screen.getByText(/Labs/i)).toBeInTheDocument();
  });
});
