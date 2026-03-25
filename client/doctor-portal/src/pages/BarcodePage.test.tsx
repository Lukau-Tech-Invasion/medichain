import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BarcodePage from './BarcodePage';

describe('BarcodePage', () => {
  it('renders barcode page', () => {
    render(<BarcodePage />);

    expect(screen.getByText(/Barcode Scanner/i)).toBeInTheDocument();
    expect(screen.getByText(/Identify patients, medications, and equipment/i)).toBeInTheDocument();
  });

  it('displays scan modes', () => {
    render(<BarcodePage />);

    expect(screen.getByText(/Patient ID/i)).toBeInTheDocument();
    expect(screen.getByText(/Medication/i)).toBeInTheDocument();
    expect(screen.getByText(/Specimen/i)).toBeInTheDocument();
  });

  it('allows manual entry', () => {
    render(<BarcodePage />);

    const input = screen.getByPlaceholderText(/Enter barcode manually/i);
    fireEvent.change(input, { target: { value: '123456789' } });
    expect(input).toHaveValue('123456789');
  });
});
