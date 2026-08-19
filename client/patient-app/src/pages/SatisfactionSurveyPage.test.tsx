import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSatisfactionSurvey, getPatientAppointments } from '@medichain/shared';
import SatisfactionSurveyPage from './SatisfactionSurveyPage';

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return {
    ...actual,
    createSatisfactionSurvey: vi.fn(),
    debugLog: vi.fn(),
    getPatientAppointments: vi.fn(),
  };
});

const completeSurvey = async () => {
  fireEvent.click(screen.getByRole('button', { name: /start survey/i }));
  fireEvent.click(screen.getByRole('button', { name: 'v1: 5 of 5' }));
  fireEvent.click(screen.getByRole('button', { name: 'v2: Yes' }));
  fireEvent.click(screen.getByRole('button', { name: 'v3: Yes' }));
  fireEvent.click(screen.getByRole('button', { name: 'v4: 5 of 5' }));
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  fireEvent.click(screen.getByRole('button', { name: 's1: 5 of 5' }));
  fireEvent.click(screen.getByRole('button', { name: 's2: Yes' }));
  fireEvent.click(screen.getByRole('button', { name: 's3: 5 of 5' }));
  fireEvent.click(screen.getByRole('button', { name: 's4: Yes' }));
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  fireEvent.click(screen.getByRole('button', { name: 'f1: 5 of 5' }));
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  fireEvent.click(screen.getByRole('button', { name: 'overall: 5 of 5' }));
  fireEvent.click(screen.getByRole('button', { name: 'recommend: Yes' }));
  fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));
};

describe('SatisfactionSurveyPage (Patient)', () => {
  beforeEach(() => {
    vi.mocked(createSatisfactionSurvey).mockReset();
    vi.mocked(getPatientAppointments).mockReset();
    vi.mocked(getPatientAppointments).mockResolvedValue({
      success: true,
      appointments: [],
      count: 0,
    });
  });

  it('renders intro step initially', () => {
    render(<SatisfactionSurveyPage />);

    expect(screen.getByText(/Patient Feedback/i)).toBeInTheDocument();
    expect(screen.getByText(/Help us improve your care/i)).toBeInTheDocument();
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

    const backButton = screen.getByRole('button', { name: /^Back$/i });
    fireEvent.click(backButton);

    expect(screen.getByText(/Patient Feedback/i)).toBeInTheDocument();
  });

  it('submits the completed survey through the typed API client', async () => {
    vi.mocked(createSatisfactionSurvey).mockResolvedValue({ id: 'SURV-1', success: true });
    render(<SatisfactionSurveyPage />);

    await completeSurvey();

    await waitFor(() => expect(createSatisfactionSurvey).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSatisfactionSurvey).mock.calls[0][0]).toMatchObject({
      survey_type: 'PostVisit',
      overall_rating: 5,
      nps_score: 10,
      anonymous: false,
      follow_up_requested: false,
    });
    expect(await screen.findByText(/Thank You!/i)).toBeInTheDocument();
  });

  it('shows an actionable error and does not claim success when submission fails', async () => {
    vi.mocked(createSatisfactionSurvey).mockRejectedValue(new Error('storage unavailable'));
    render(<SatisfactionSurveyPage />);

    await completeSurvey();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not submit/i);
    expect(screen.queryByText(/Thank You!/i)).not.toBeInTheDocument();
  });
});
