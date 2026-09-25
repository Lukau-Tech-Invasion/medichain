import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as shared from '@medichain/shared';
import { DialogHost, I18nProvider } from '@medichain/shared';
import EmergencyPatientCard from './EmergencyPatientCard';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifyEmergencyContacts: vi.fn(),
}));

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

  it('texts the emergency contacts after confirmation and says who was reached', async () => {
    vi.mocked(shared.notifyEmergencyContacts).mockResolvedValue({
      success: true,
      notifications_sent: 1,
      notifications_attempted: 2,
      notifications: [],
      message: 'Emergency notification delivered to 1 of 2 contacts',
    });
    render(
      <I18nProvider>
        <EmergencyPatientCard
          patient={{
            patientId: 'PAT-1',
            allergies: [],
            currentMedications: [],
            emergencyContacts: [{ name: 'Thandi', phone: '+27820000000', relationship: 'Sister' }],
          }}
        />
        <DialogHost />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Text emergency contacts/i }));
    const dialog = await screen.findByRole('dialog');
    expect(shared.notifyEmergencyContacts).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: /Text emergency contacts/i }));

    await waitFor(() =>
      expect(shared.notifyEmergencyContacts).toHaveBeenCalledWith('PAT-1', { emergency_type: 'medical' })
    );
    expect(await screen.findByText(/Delivered to 1 of 2 contacts/i)).toBeInTheDocument();
  });
});
