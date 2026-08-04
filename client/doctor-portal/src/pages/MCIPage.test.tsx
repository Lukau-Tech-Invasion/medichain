import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import MCIPage from './MCIPage';

/**
 * Rewritten 2026-07-31. The previous version tested a design this page does not
 * have: it clicked an "Activate MCI Mode" gate before expecting triage counts.
 * There is no activation control anywhere in MCIPage (or in the docMCI
 * translations) — the page opens straight onto the START triage board with
 * Triage / Incident Info / Resources tabs. Every assertion below is against what
 * the component actually renders.
 */
describe('MCIPage', () => {
  it('renders the MCI board with the START protocol header', () => {
    render(<MCIPage />);

    expect(screen.getByText(/MASS CASUALTY INCIDENT/i)).toBeInTheDocument();
    expect(screen.getByText(/START Triage Protocol Active/i)).toBeInTheDocument();
  });

  it('offers the triage, incident and resources tabs', () => {
    render(<MCIPage />);

    expect(screen.getByText(/Triage Patients/i)).toBeInTheDocument();
    expect(screen.getByText(/Incident Info/i)).toBeInTheDocument();
    expect(screen.getByText(/Resources/i)).toBeInTheDocument();
  });

  it('shows the START triage categories', () => {
    render(<MCIPage />);

    // Red / Yellow / Green / Gray tags — the categories a triage officer sorts into.
    expect(screen.getByText(/IMMEDIATE/i)).toBeInTheDocument();
    expect(screen.getByText(/DELAYED/i)).toBeInTheDocument();
    expect(screen.getByText(/MINOR/i)).toBeInTheDocument();
    expect(screen.getByText(/EXPECTANT/i)).toBeInTheDocument();
  });

  it('opens the new-patient tag form from the triage list', () => {
    render(<MCIPage />);

    expect(screen.getByText(/Patient Triage List/i)).toBeInTheDocument();
    // "Add Patient" appears both as the list action and in the empty-state copy,
    // so target the button specifically rather than the first text match.
    fireEvent.click(screen.getAllByRole('button', { name: /Add Patient/i })[0]);

    expect(screen.getByText(/New Patient - Tag/i)).toBeInTheDocument();
  });
});
