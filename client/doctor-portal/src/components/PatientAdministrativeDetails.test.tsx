import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PatientAdministrativeDetails } from './PatientAdministrativeDetails';

describe('PatientAdministrativeDetails', () => {
  it('preserves absent data as unknown rather than no insurance or active coverage', () => {
    render(<PatientAdministrativeDetails details={{}} />);
    expect(screen.getAllByText('Not recorded')).toHaveLength(10);
    expect(screen.queryByText('Reported inactive')).not.toBeInTheDocument();
    expect(screen.queryByText('Reported active')).not.toBeInTheDocument();
  });

  it('updates read-only facts with the new chart and keeps missing status unknown', () => {
    const view = render(<PatientAdministrativeDetails details={{ insurance: {
      provider: 'First insurer', policy_number: 'FIRST', coverage_type: 'Private', is_active: false,
    } }} />);
    expect(screen.getByText('Reported inactive')).toBeVisible();
    view.rerender(<PatientAdministrativeDetails details={{ insurance: {
      provider: 'Second insurer', policy_number: 'SECOND', coverage_type: 'Public', valid_from: null,
    } }} />);
    const panel = screen.getByRole('region', { name: 'Administrative details' });
    expect(within(panel).getByText('Second insurer')).toBeVisible();
    expect(within(panel).queryByText('FIRST')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Reported inactive')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument();
  });
});
