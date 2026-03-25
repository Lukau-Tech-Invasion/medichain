import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import PediatricsPage from './PediatricsPage';

describe('PediatricsPage', () => {
  it('renders pediatrics page', () => {
    render(<PediatricsPage />);

    expect(screen.getByText(/Pediatric Care Dashboard/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search pediatric patients/i)).toBeInTheDocument();
  });

  it('displays patient list', () => {
    render(<PediatricsPage />);

    expect(screen.getByText(/Yusuf Al-Rashid/i)).toBeInTheDocument();
    expect(screen.getByText(/Sara Hassan/i)).toBeInTheDocument();
  });

  it('allows selecting a patient', () => {
    render(<PediatricsPage />);

    const patient = screen.getByText(/Yusuf Al-Rashid/i);
    fireEvent.click(patient);

    expect(screen.getByText(/Infant Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Growth Overview/i)).toBeInTheDocument();
  });
});
