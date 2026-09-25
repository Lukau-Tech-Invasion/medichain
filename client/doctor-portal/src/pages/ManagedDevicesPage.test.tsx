import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ManagedDevicesPage from './ManagedDevicesPage';
import * as shared from '@medichain/shared';

// Mock only the data calls; i18n stays real so these assertions read the copy a
// clinician sees rather than a key.
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listManagedDevices: vi.fn(),
  listOrganizations: vi.fn(),
  enrollManagedDevice: vi.fn(),
  rotateManagedDevice: vi.fn(),
  revokeManagedDevice: vi.fn(),
}));

const device = (over: Partial<shared.ManagedDevice> = {}): shared.ManagedDevice => ({
  id: 'dev-1',
  organization_id: 'legacy-organization',
  facility_id: 'legacy-facility',
  device_name: 'ED tablet 3',
  device_type: 'tablet',
  hardware_fingerprint: 'fp-1',
  platform: 'Android 14',
  status: 'enrolled',
  current_key_id: null,
  last_seen_at: null,
  last_rotation_at: null,
  next_rotation_at: '2026-10-15T00:00:00Z',
  revoked_at: null,
  revocation_reason: null,
  ...over,
});

describe('ManagedDevicesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.listOrganizations).mockResolvedValue({
      success: true,
      backend: 'postgres',
      organizations: [
        {
          id: 'legacy-organization',
          name: 'MediChain legacy deployment',
          organization_type: 'healthcare_provider',
          // The boundary row is deliberately inactive and is still a valid
          // enrolment target (migration 20260827000002).
          status: 'inactive',
          facilities: [
            {
              id: 'legacy-facility',
              organization_id: 'legacy-organization',
              name: 'MediChain legacy facility',
              facility_type: 'healthcare',
              status: 'active',
            },
          ],
        },
      ],
    });
    vi.mocked(shared.listManagedDevices).mockResolvedValue({
      success: true,
      count: 1,
      devices: [device()],
    });
  });

  it('lists enrolled devices with the id an emergency grant needs', async () => {
    render(<ManagedDevicesPage />);

    await waitFor(() => expect(screen.getByText('ED tablet 3')).toBeInTheDocument());
    expect(screen.getByText('dev-1')).toBeInTheDocument();
  });

  it('says a device has no credential yet rather than showing a rotation date', async () => {
    render(<ManagedDevicesPage />);

    // An enrolled-but-never-rotated device cannot open a record. Rendering
    // `next_rotation_at` for it would read as a working device on a schedule.
    await waitFor(() => expect(screen.getByText(/No credential yet/i)).toBeInTheDocument());
  });

  it('offers the organisations the deployment holds, and says when one is not active', async () => {
    render(<ManagedDevicesPage />);

    await waitFor(() =>
      expect(screen.getByText(/MediChain legacy deployment \(inactive\)/i)).toBeInTheDocument()
    );
  });

  it('sends the enrolment the form collected, with an unset facility absent', async () => {
    vi.mocked(shared.enrollManagedDevice).mockResolvedValue(device({ device_name: 'Ward 2 cart' }));
    render(<ManagedDevicesPage />);
    await waitFor(() => expect(screen.getByText('ED tablet 3')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/Device name/i), 'Ward 2 cart');
    await userEvent.type(screen.getByLabelText(/Hardware fingerprint/i), 'fp-ward-2');
    await userEvent.click(screen.getByRole('button', { name: /Enrol device/i }));

    await waitFor(() => expect(shared.enrollManagedDevice).toHaveBeenCalled());
    expect(vi.mocked(shared.enrollManagedDevice).mock.calls[0][0]).toMatchObject({
      organization_id: 'legacy-organization',
      device_name: 'Ward 2 cart',
      hardware_fingerprint: 'fp-ward-2',
      // Nobody chose a facility, so none is sent. '' is not a facility, and the
      // column is a foreign key.
      facility_id: null,
    });
  });

  it('reports a failed read instead of showing an empty fleet', async () => {
    vi.mocked(shared.listManagedDevices).mockRejectedValue(new Error('boom'));
    render(<ManagedDevicesPage />);

    // "No devices are enrolled" and "the device store could not be read" are
    // opposite answers to the question an administrator is asking.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/No devices are enrolled/i)).not.toBeInTheDocument();
  });

  it('re-reads the fleet after provisioning a credential', async () => {
    vi.mocked(shared.rotateManagedDevice).mockResolvedValue(
      device({ status: 'active', last_rotation_at: '2026-09-15T00:00:00Z' })
    );
    render(<ManagedDevicesPage />);
    await waitFor(() => expect(screen.getByText('ED tablet 3')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Provision key/i }));

    await waitFor(() => expect(shared.rotateManagedDevice).toHaveBeenCalledWith('dev-1', expect.any(String)));
    // A write nobody reads back is the defect this codebase keeps finding.
    await waitFor(() => expect(shared.listManagedDevices).toHaveBeenCalledTimes(2));
  });

  it('revokes a device with a reason and re-reads', async () => {
    vi.mocked(shared.revokeManagedDevice).mockResolvedValue(device({ status: 'revoked' }));
    render(<ManagedDevicesPage />);
    await waitFor(() => expect(screen.getByText('ED tablet 3')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Revoke/i }));

    await waitFor(() =>
      expect(shared.revokeManagedDevice).toHaveBeenCalledWith('dev-1', expect.any(String))
    );
    await waitFor(() => expect(shared.listManagedDevices).toHaveBeenCalledTimes(2));
  });
});
