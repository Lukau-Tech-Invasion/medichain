import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StrokePage from './StrokePage';

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones described a per-item NIHSS worksheet ("1a. Level of Consciousness",
 * "1 - Drowsy" radios, a running "NIHSS Total:") that this page does not
 * implement — it captures a single NIHSS score plus a tPA eligibility decision.
 * Strings verified against `docStroke` in shared/src/i18n/locales/en-US.ts.
 */
describe('StrokePage', () => {
  it('renders the stroke code header', () => {
    render(<StrokePage />);

    expect(screen.getByText(/Stroke Code Management/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Acute stroke assessment, NIHSS scoring, and thrombolytic eligibility\./i)
    ).toBeInTheDocument();
  });

  it('captures an NIHSS score and tPA eligibility', () => {
    render(<StrokePage />);

    expect(screen.getByText(/NIHSS Score \(0-42\)/i)).toBeInTheDocument();
    expect(screen.getByText(/tPA Eligibility/i)).toBeInTheDocument();
  });

  it('lets a clinician pick the patient being assessed', () => {
    render(<StrokePage />);

    expect(screen.getAllByText(/Select Patient/i).length).toBeGreaterThan(0);
  });
});
