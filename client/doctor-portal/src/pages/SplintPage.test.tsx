import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import SplintPage from './SplintPage';

describe('SplintPage', () => {
  it('renders splint page', () => {
    render(<SplintPage />);

    expect(screen.getByText(/Splinting & Immobilization/i)).toBeInTheDocument();
    expect(screen.getByText(/Documentation of orthopedic splinting and immobilization/i)).toBeInTheDocument();
  });

  it('displays procedure details section', () => {
    render(<SplintPage />);

    expect(screen.getByText(/Procedure Details/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Splint Type/i)).toBeInTheDocument();
  });

  it('allows selecting splint material', () => {
    render(<SplintPage />);

    const select = screen.getByLabelText(/Material/i);
    fireEvent.change(select, { target: { value: 'Fiberglass' } });
    expect(select).toHaveValue('Fiberglass');
  });
});
