import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import CodeBluePage from './CodeBluePage';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  apiUrl: (path: string) => path,
}));

/**
 * Pick a patient, then start the code.
 *
 * `Start Code` is disabled until a patient is selected — a resuscitation record
 * with no patient attached is not a record.
 */
const startCode = async () => {
  const picker = await screen.findByLabelText(/Select Patient/i);
  const option = picker.querySelector('option[value]:not([value=""])') as HTMLOptionElement | null;
  if (option) fireEvent.change(picker, { target: { value: option.value } });
  fireEvent.click(screen.getByText(/Start Code/i));
  await waitFor(() => expect(screen.getByText(/Stop Code/i)).toBeInTheDocument());
};

beforeEach(() => {
  (shared.getPatients as any).mockResolvedValue([
    { patient_id: 'PAT-001', full_name: 'Test Patient', health_id: 'MCHI-1' },
  ]);
});

describe('CodeBluePage', () => {
  it('renders code blue page', () => {
    render(<CodeBluePage />);

    expect(screen.getByText(/Code Blue Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Code/i)).toBeInTheDocument();
  });

  it('shows the timer and controls when code is started', async () => {
    render(<CodeBluePage />);
    await startCode();

    expect(screen.getByText(/Quick Actions/i)).toBeInTheDocument();
    expect(screen.getByText(/Stop Code/i)).toBeInTheDocument();
    expect(screen.getByText(/CPR Cycle/i)).toBeInTheDocument();
  });

  it('allows recording medications during code', async () => {
    render(<CodeBluePage />);
    await startCode();

    expect(screen.getByText(/Epi 1mg/i)).toBeInTheDocument();
    expect(screen.getByText(/Amiodarone/i)).toBeInTheDocument();
  });
});
