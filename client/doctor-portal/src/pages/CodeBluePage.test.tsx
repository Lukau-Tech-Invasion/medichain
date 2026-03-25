import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import CodeBluePage from './CodeBluePage';

describe('CodeBluePage', () => {
  it('renders code blue page', () => {
    render(<CodeBluePage />);

    expect(screen.getByText(/Code Blue Resuscitation/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Code/i)).toBeInTheDocument();
  });

  it('shows the timer and controls when code is started', () => {
    render(<CodeBluePage />);

    const startButton = screen.getByText(/Start Code/i);
    fireEvent.click(startButton);

    expect(screen.getByText(/Elapsed Time/i)).toBeInTheDocument();
    expect(screen.getByText(/Stop Code/i)).toBeInTheDocument();
    expect(screen.getByText(/Record Rhythm/i)).toBeInTheDocument();
  });

  it('allows recording medications during code', () => {
    render(<CodeBluePage />);
    fireEvent.click(screen.getByText(/Start Code/i));

    expect(screen.getByText(/Epinephrine/i)).toBeInTheDocument();
    expect(screen.getByText(/Amiodarone/i)).toBeInTheDocument();
  });
});
