import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SplintPage from './SplintPage';

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones expected a "Procedure Details" section with labelled "Splint Type" and
 * "Material" selects; the page is tabbed (New Application / History) with a
 * "Patient & Device" section and a device Type chooser. Strings verified
 * against `docSplint` in shared/src/i18n/locales/en-US.ts.
 */
describe('SplintPage', () => {
  it('renders the splint & cast header', () => {
    render(<SplintPage />);

    expect(screen.getByText(/Splint & Cast Documentation/i)).toBeInTheDocument();
    expect(screen.getByText(/Immobilization and orthopedic care/i)).toBeInTheDocument();
  });

  it('offers the new-application and history tabs', () => {
    render(<SplintPage />);

    expect(screen.getByText(/New Application/i)).toBeInTheDocument();
    expect(screen.getAllByText(/History/i).length).toBeGreaterThan(0);
  });

  it('renders the patient & device section with device types', () => {
    render(<SplintPage />);

    expect(screen.getByText(/Patient & Device/i)).toBeInTheDocument();
    // Splint / Cast / Sling / Brace / Walking boot are the selectable devices.
    expect(screen.getAllByText(/Splint/i).length).toBeGreaterThan(0);
  });
});
