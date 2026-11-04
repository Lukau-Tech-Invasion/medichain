import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MCIPage, { localIncidentTime, incidentTimeInstant } from './MCIPage';
import { localDateInput } from '@medichain/shared';

/**
 * Rewritten 2026-07-31. The previous version tested a design this page does not
 * have: it clicked an "Activate MCI Mode" gate before expecting triage counts.
 * There is no activation control anywhere in MCIPage (or in the docMCI
 * translations) — the page opens straight onto the START triage board with
 * Triage / Incident Info / Resources tabs. Every assertion below is against what
 * the component actually renders.
 */
describe('MCIPage', () => {
  it('displays Johannesburg wall time instead of UTC in the incident input', () => {
    const instant = new Date('2026-10-08T19:53:00Z');
    const offset = vi.spyOn(instant, 'getTimezoneOffset').mockReturnValue(-120);
    expect(localIncidentTime(instant)).toBe('2026-10-08T21:53');
    offset.mockRestore();
  });

  it('sends the selected local time as an RFC 3339 instant', () => {
    const selected = '2026-10-08T21:00';
    expect(incidentTimeInstant(selected)).toBe(new Date(selected).toISOString());
    expect(incidentTimeInstant(selected)).toMatch(/Z$/);
    expect(() => incidentTimeInstant('')).toThrow();
  });

  it('keeps the Johannesburg calendar date after local midnight', () => {
    const instant = new Date('2026-10-08T22:05:00Z');
    const offset = vi.spyOn(instant, 'getTimezoneOffset').mockReturnValue(-120);
    expect(localDateInput(instant)).toBe('2026-10-09');
    offset.mockRestore();
  });

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

  it('requires a receiving destination before marking a casualty transported', () => {
    render(<MCIPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add & Tag Patient' }));
    const transport = screen.getByRole('button', { name: 'Mark as transported' });
    expect(transport).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Destination hospital for MCI-0001' }), {
      target: { value: 'Synthetic receiving hospital' },
    });
    expect(transport).toBeEnabled();
    fireEvent.click(transport);
    expect(screen.getByText('Transported')).toBeInTheDocument();
  });

  it('tags a casualty nobody examined without inventing vitals', () => {
    render(<MCIPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add & Tag Patient' }));
    // It used to read "RR 16, pulse 80, cap refill 2, alert" for a casualty
    // whose vitals no one had taken.
    expect(screen.queryByText(/\b80\b/)).toBeNull();
    expect(screen.getByText(/not assessed/)).toBeInTheDocument();
  });
});
