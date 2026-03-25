import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BurnPage from './BurnPage';

describe('BurnPage', () => {
  it('renders burn page', () => {
    render(<BurnPage />);

    expect(screen.getByText(/Burn Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Lund-Browder Chart /i)).toBeInTheDocument();
  });

  it('displays TBSA calculation section', () => {
    render(<BurnPage />);

    expect(screen.getByText(/Total Body Surface Area /i)).toBeInTheDocument();
    expect(screen.getByText(/TBSA/i)).toBeInTheDocument();
  });

  it('allows selecting burn degree', () => {
    render(<BurnPage />);

    const select = screen.getByLabelText(/Burn Degree/i);
    fireEvent.change(select, { target: { value: '2' } });
    expect(select).toHaveValue('2');
  });
});
