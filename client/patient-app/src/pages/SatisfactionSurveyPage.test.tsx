import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import SatisfactionSurveyPage from './SatisfactionSurveyPage';

describe('SatisfactionSurveyPage (Patient)', () => {
  it('renders intro step initially', () => {
    render(<SatisfactionSurveyPage />);

    expect(screen.getByText(/Patient Satisfaction Survey/i)).toBeInTheDocument();
    expect(screen.getByText(/Help us improve our care/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Survey/i)).toBeInTheDocument();
  });

  it('navigates to first question set when clicking Start', () => {
    render(<SatisfactionSurveyPage />);

    const startButton = screen.getByText(/Start Survey/i);
    fireEvent.click(startButton);

    expect(screen.getByText(/Your Visit Experience/i)).toBeInTheDocument();
    expect(screen.getByText(/How would you rate your overall visit experience?/i)).toBeInTheDocument();
  });

  it('allows moving back to intro from first question set', () => {
    render(<SatisfactionSurveyPage />);

    fireEvent.click(screen.getByText(/Start Survey/i));
    expect(screen.getByText(/Your Visit Experience/i)).toBeInTheDocument();

    const backButton = screen.getByText(/Back/i);
    fireEvent.click(backButton);

    expect(screen.getByText(/Patient Satisfaction Survey/i)).toBeInTheDocument();
  });
});
