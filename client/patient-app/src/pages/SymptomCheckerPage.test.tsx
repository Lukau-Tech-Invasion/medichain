import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import SymptomCheckerPage from './SymptomCheckerPage';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('SymptomCheckerPage (Patient)', () => {
  it('renders intro step initially', () => {
    render(<SymptomCheckerPage />);

    expect(screen.getByText(/Symptom Checker/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Assessment/i)).toBeInTheDocument();
  });

  it('navigates to chat step when clicking Start Check', () => {
    render(<SymptomCheckerPage />);

    // Start is disabled until age and gender are supplied — correct product
    // behaviour, and the generated test skipped both.
    fireEvent.change(screen.getByPlaceholderText(/Enter your age/i), {
      target: { value: '34' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Female$/i }));

    const startButton = screen.getByText(/Start Assessment/i);
    fireEvent.click(startButton);

    // Clicking Start leaves the intro step, so its heading is gone; the chat
    // step is identified by its message input.
    expect(screen.getByPlaceholderText(/Describe your symptoms/i)).toBeInTheDocument();
  });

  it('allows entering age and gender', () => {
    render(<SymptomCheckerPage />);
    
    fireEvent.click(screen.getByText(/Start Assessment/i));

    const ageInput = screen.getByPlaceholderText(/Enter your age/i);
    fireEvent.change(ageInput, { target: { value: '30' } });
    expect(ageInput).toHaveValue(30);

    // The label sits inside the button, so `parentElement` is the button
    // itself only by coincidence of markup — target the button directly.
    const femaleButton = screen.getByRole('button', { name: /^Female$/i });
    fireEvent.click(femaleButton);
    expect(femaleButton).toHaveClass('border-purple-500');
  });
});
