import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import MCIPage from './MCIPage';

describe('MCIPage', () => {
  it('renders MCI page', () => {
    render(<MCIPage />);

    expect(screen.getByText(/Mass Casualty Incident/i)).toBeInTheDocument();
    expect(screen.getByText(/Activate MCI Mode/i)).toBeInTheDocument();
  });

  it('displays triage counts when activated', () => {
    render(<MCIPage />);

    fireEvent.click(screen.getByText(/Activate MCI Mode/i));

    expect(screen.getByText(/Immediate/i)).toBeInTheDocument();
    expect(screen.getByText(/Delayed/i)).toBeInTheDocument();
    expect(screen.getByText(/Minimal/i)).toBeInTheDocument();
    expect(screen.getByText(/Expectant/i)).toBeInTheDocument();
  });

  it('allows reporting new casualty', () => {
    render(<MCIPage />);
    fireEvent.click(screen.getByText(/Activate MCI Mode/i));

    const addButton = screen.getByText(/Report New Casualty/i);
    fireEvent.click(addButton);

    expect(screen.getByText(/Casualty Information/i)).toBeInTheDocument();
  });
});
