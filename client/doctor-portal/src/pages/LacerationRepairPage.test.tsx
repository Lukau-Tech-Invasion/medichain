import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import LacerationRepairPage from './LacerationRepairPage';

describe('LacerationRepairPage', () => {
  it('renders laceration repair page', () => {
    render(<LacerationRepairPage />);

    expect(screen.getByText(/Laceration Repair Documentation/i)).toBeInTheDocument();
    expect(screen.getByText(/Procedure Details/i)).toBeInTheDocument();
  });

  it('displays wound description section', () => {
    render(<LacerationRepairPage />);

    expect(screen.getByText(/Wound Description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Length \(cm\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Location/i)).toBeInTheDocument();
  });

  it('allows entering suture details', () => {
    render(<LacerationRepairPage />);

    const sutureSelect = screen.getByLabelText(/Suture Type/i);
    fireEvent.change(sutureSelect, { target: { value: 'Ethilon' } });
    expect(sutureSelect).toHaveValue('Ethilon');

    const countInput = screen.getByLabelText(/Suture Count/i);
    fireEvent.change(countInput, { target: { value: '5' } });
    expect(countInput).toHaveValue(5);
  });
});
