import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import SymptomCheckerPage from './SymptomCheckerPage';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('SymptomCheckerPage (Patient)', () => {
  it('renders intro step initially', () => {
    render(<SymptomCheckerPage />);

    expect(screen.getByText(/AI Symptom Checker/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Check/i)).toBeInTheDocument();
  });

  it('navigates to chat step when clicking Start Check', () => {
    render(<SymptomCheckerPage />);

    const startButton = screen.getByText(/Start Check/i);
    fireEvent.click(startButton);

    expect(screen.getByText(/MediChain Assistant/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Type your message/i)).toBeInTheDocument();
  });

  it('allows entering age and gender', () => {
    render(<SymptomCheckerPage />);
    
    fireEvent.click(screen.getByText(/Start Check/i));

    const ageInput = screen.getByPlaceholderText(/Enter age/i);
    fireEvent.change(ageInput, { target: { value: '30' } });
    expect(ageInput).toHaveValue(30);

    const femaleOption = screen.getByText(/Female/i);
    fireEvent.click(femaleOption);
    expect(femaleOption.parentElement).toHaveClass('border-primary-500');
  });
});
