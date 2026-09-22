import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@medichain/shared';
import EmergencyPatientCard from './EmergencyPatientCard';

describe('EmergencyPatientCard', () => {
  it('does not turn absent emergency directives into negative assertions', () => {
    render(
      <I18nProvider>
        <EmergencyPatientCard
          patient={{
            patientId: 'PAT-1',
            allergies: [],
            currentMedications: [],
          }}
        />
      </I18nProvider>,
    );

    expect(screen.queryByText('Full Code')).not.toBeInTheDocument();
    expect(screen.queryByText('Not a Registered Donor')).not.toBeInTheDocument();
    expect(screen.getAllByText('None recorded')).toHaveLength(2);
    expect(screen.getByText(/Last updated: None recorded/i)).toBeInTheDocument();
  });
});
