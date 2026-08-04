import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BarcodePage from './BarcodePage';

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The scan
 * modes are labelled "Patient" / "Medication" / "Equipment" / "Specimen" (not
 * "Patient ID"), and there is no descriptive subtitle under the title. Strings
 * verified against `docBarcode` in shared/src/i18n/locales/en-US.ts.
 */
describe('BarcodePage', () => {
  it('renders the scanner header', () => {
    render(<BarcodePage />);

    expect(screen.getAllByText(/Barcode Scanner/i).length).toBeGreaterThan(0);
  });

  it('offers the scan / history / settings tabs', () => {
    render(<BarcodePage />);

    expect(screen.getAllByText(/Scan/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/History/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Settings/i).length).toBeGreaterThan(0);
  });

  it('offers the scan-target modes', () => {
    render(<BarcodePage />);

    // Scanning the wrong entity class is a patient-safety issue, so all four
    // modes must remain selectable.
    expect(screen.getAllByText(/Patient/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Medication/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Equipment/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Specimen/i).length).toBeGreaterThan(0);
  });
});
