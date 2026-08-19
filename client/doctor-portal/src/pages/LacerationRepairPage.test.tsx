import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import LacerationRepairPage from './LacerationRepairPage';

describe('LacerationRepairPage', () => {
  it('renders laceration repair page', () => {
    render(<LacerationRepairPage />);

    expect(screen.getAllByText(/Laceration Repair/i).length).toBeGreaterThan(0);
    // The page opens on the repairs list; the entry form is the 'New Repair' tab.
    expect(screen.getByRole('button', { name: /New Repair/i })).toBeInTheDocument();
  });

  it('displays wound description section', () => {
    render(<LacerationRepairPage />);

    // The entry form is its own tab; the page opens on the list.
    fireEvent.click(screen.getByRole('button', { name: /New Repair/i }));
    expect(screen.getByLabelText(/Length \(cm\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Depth/i)).toBeInTheDocument();
  });

  it('allows entering suture details', () => {
    render(<LacerationRepairPage />);

    // The entry form is its own tab; the page opens on the list.
    fireEvent.click(screen.getByRole('button', { name: /New Repair/i }));
    const sutureSelect = screen.getByLabelText(/Suture Type/i);
    fireEvent.change(sutureSelect, { target: { value: '5-0 Nylon' } });
    expect(sutureSelect).toHaveValue('5-0 Nylon');

    const countInput = screen.getByLabelText(/^Count/i);
    fireEvent.change(countInput, { target: { value: '5' } });
    expect(countInput).toHaveValue(5);
  });
});
