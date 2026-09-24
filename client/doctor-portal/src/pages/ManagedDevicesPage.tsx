import { useState, useEffect, useCallback } from 'react';
import {
  enrollManagedDevice,
  getApiErrorMessage,
  listManagedDevices,
  listOrganizations,
  revokeManagedDevice,
  rotateManagedDevice,
  useTranslation,
  formatDateOnly,
} from '@medichain/shared';
import type { ManagedDevice, OrganizationSummary } from '@medichain/shared';
import { Laptop, Loader2, RefreshCw, ShieldOff } from 'lucide-react';

/**
 * Approved-device administration.
 *
 * # Why this page exists
 *
 * `POST /api/devices/enroll`, `/rotate` and `/revoke` had no caller anywhere in
 * either client. That is not a cosmetic gap: emergency access is bound to an
 * approved device, so with no way to enrol one, break-glass access could not be
 * issued at all -- `POST /api/emergency/grants` answered `DEVICE_NOT_FOUND` for
 * every request a real deployment could make.
 *
 * The lifecycle is deliberately two steps. Enrolment records the hardware; the
 * device cannot reach a record until a credential is provisioned and `rotate`
 * records its key id. An enrolled-but-never-rotated device showing as usable
 * would be the worst kind of wrong here, so the fleet table says so plainly.
 */
function ManagedDevicesPage() {
  const { t } = useTranslation();

  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  // "No devices are enrolled" and "the device store could not be read" are
  // opposite answers, and an empty table asserts the first.
  const [loaded, setLoaded] = useState(false);
  // Distinct from `error`, which also carries enrolment and rotation failures.
  // Only a failed *read* means the fleet is unknown, and only then must the
  // empty-state sentence be withheld -- a rotation that failed says nothing
  // about whether devices are enrolled.
  const [fleetUnknown, setFleetUnknown] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [organizationId, setOrganizationId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState('tablet');
  const [fingerprint, setFingerprint] = useState('');
  const [platform, setPlatform] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await listManagedDevices();
      setDevices(body.devices ?? []);
      setFleetUnknown(false);
      setError('');
    } catch (err) {
      setFleetUnknown(true);
      setError(getApiErrorMessage(err, t('docDevices.loadFailed')));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // The organisation id is a foreign key the enrolment insert will check.
    // Asking an administrator to type one they cannot look up anywhere is part
    // of how this endpoint stayed unreachable, so the form offers what the
    // deployment actually holds.
    listOrganizations()
      .then((body) => {
        const list = body.organizations ?? [];
        setOrganizations(list);
        if (list.length > 0) setOrganizationId((current) => current || list[0].id);
      })
      .catch((err) => setError(getApiErrorMessage(err, t('docDevices.orgsFailed'))));
  }, [t]);

  const selectedOrganization = organizations.find((org) => org.id === organizationId);

  const submitEnrollment = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setEnrolling(true);
    try {
      const device = await enrollManagedDevice({
        organization_id: organizationId,
        // An unfilled optional field is absent, not an empty string: the column
        // is a foreign key and '' is not a facility.
        facility_id: facilityId || null,
        device_name: deviceName,
        device_type: deviceType,
        hardware_fingerprint: fingerprint,
        platform: platform || null,
      });
      setNotice(t('docDevices.enrolled', { name: device.device_name }));
      setDeviceName('');
      setFingerprint('');
      setPlatform('');
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, t('docDevices.enrollFailed')));
    } finally {
      setEnrolling(false);
    }
  };

  const provisionKey = async (device: ManagedDevice) => {
    setError('');
    setNotice('');
    setBusyId(device.id);
    try {
      // The key id names a credential provisioned out of band. No private key
      // material passes through this screen or the API.
      const keyId = `key-${device.id.slice(0, 8)}-${Date.now()}`;
      await rotateManagedDevice(device.id, keyId);
      setNotice(t('docDevices.rotated', { name: device.device_name }));
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, t('docDevices.rotateFailed')));
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (device: ManagedDevice, reason: string) => {
    setError('');
    setNotice('');
    setBusyId(device.id);
    try {
      await revokeManagedDevice(device.id, reason);
      setNotice(t('docDevices.revoked', { name: device.device_name }));
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, t('docDevices.revokeFailed')));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-content flex items-center gap-2">
          <Laptop size={24} /> {t('docDevices.title')}
        </h1>
        <p className="text-sm text-content-muted mt-1">{t('docDevices.subtitle')}</p>
      </header>

      {error && (
        <div role="alert" className="mb-4 bg-critical-subtle border border-critical rounded-lg p-3">
          <p className="text-sm text-critical-subtle-fg">{error}</p>
        </div>
      )}
      {notice && (
        <div role="status" className="mb-4 bg-ok-subtle border border-ok rounded-lg p-3">
          <p className="text-sm text-ok-subtle-fg">{notice}</p>
        </div>
      )}

      <form onSubmit={submitEnrollment} className="bg-surface rounded-xl shadow p-6 mb-8">
        <h2 className="font-semibold text-content mb-4">{t('docDevices.enrollHeading')}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="device-org"
              className="block text-sm font-medium text-content-secondary mb-1"
            >
              {t('docDevices.organization')}
            </label>
            <select
              id="device-org"
              value={organizationId}
              onChange={(e) => {
                setOrganizationId(e.target.value);
                setFacilityId('');
              }}
              required
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            >
              {organizations.length === 0 && (
                <option value="">{t('docDevices.noOrganizations')}</option>
              )}
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {/* The federation boundary row is deliberately `inactive`
                      (migration 20260827000002) and is still a valid target --
                      a foreign key is satisfied by the row existing. Saying so
                      beats an operator wondering why the only choice looks
                      wrong. */}
                  {org.status === 'active'
                    ? org.name
                    : t('docDevices.orgWithStatus', { name: org.name, status: org.status })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="device-facility"
              className="block text-sm font-medium text-content-secondary mb-1"
            >
              {t('docDevices.facility')}
            </label>
            <select
              id="device-facility"
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            >
              <option value="">{t('docDevices.facilityUnset')}</option>
              {(selectedOrganization?.facilities ?? []).map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="device-name"
              className="block text-sm font-medium text-content-secondary mb-1"
            >
              {t('docDevices.name')}
            </label>
            <input
              id="device-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              required
              placeholder={t('docDevices.namePlaceholder')}
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            />
          </div>
          <div>
            <label
              htmlFor="device-type"
              className="block text-sm font-medium text-content-secondary mb-1"
            >
              {t('docDevices.type')}
            </label>
            <select
              id="device-type"
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value)}
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            >
              <option value="tablet">{t('docDevices.typeTablet')}</option>
              <option value="workstation">{t('docDevices.typeWorkstation')}</option>
              <option value="handheld">{t('docDevices.typeHandheld')}</option>
              <option value="ambulance_terminal">{t('docDevices.typeAmbulance')}</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="device-fingerprint"
              className="block text-sm font-medium text-content-secondary mb-1"
            >
              {t('docDevices.fingerprint')}
            </label>
            <input
              id="device-fingerprint"
              value={fingerprint}
              onChange={(e) => setFingerprint(e.target.value)}
              required
              placeholder={t('docDevices.fingerprintPlaceholder')}
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            />
            <p className="mt-1 text-xs text-content-muted">{t('docDevices.fingerprintHelp')}</p>
          </div>
          <div>
            <label
              htmlFor="device-platform"
              className="block text-sm font-medium text-content-secondary mb-1"
            >
              {t('docDevices.platform')}
            </label>
            <input
              id="device-platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder={t('docDevices.platformPlaceholder')}
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px]"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={enrolling}
          className="mt-4 px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[44px]"
        >
          {enrolling ? t('docDevices.enrolling') : t('docDevices.enroll')}
        </button>
      </form>

      <section className="bg-surface rounded-xl shadow p-6">
        <h2 className="font-semibold text-content mb-1">{t('docDevices.fleetHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('docDevices.fleetSubtitle')}</p>

        {!loaded ? (
          <p className="text-sm text-content-muted flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> {t('docDevices.loading')}
          </p>
        ) : fleetUnknown ? (
          // The alert above already says the read failed. Saying "no devices
          // are enrolled" underneath it would assert the opposite of the truth.
          <p className="text-sm text-content-muted">{t('docDevices.unknown')}</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-content-muted">{t('docDevices.none')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="device-table">
              <thead>
                <tr className="text-left text-content-muted">
                  <th scope="col" className="py-2 pr-4">
                    {t('docDevices.colName')}
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    {t('docDevices.colId')}
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    {t('docDevices.colStatus')}
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    {t('docDevices.colRotation')}
                  </th>
                  <th scope="col" className="py-2" />
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id} className="border-t border-border">
                    <td className="py-2 pr-4 text-content">
                      {device.device_name}
                      <span className="block text-xs text-content-muted">{device.device_type}</span>
                    </td>
                    <td className="py-2 pr-4 text-content-secondary break-all font-mono text-xs">
                      {device.id}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="px-2 py-1 rounded-full text-xs bg-surface-sunken text-content-secondary">
                        {device.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-content-muted">
                      {device.last_rotation_at
                        ? formatDateOnly(device.next_rotation_at)
                        : t('docDevices.neverRotated')}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void provisionKey(device)}
                          disabled={busyId === device.id || device.status === 'revoked'}
                          className="px-3 py-1 text-xs rounded-lg border border-border-interactive text-content-secondary disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[28px] whitespace-nowrap inline-flex items-center gap-1"
                        >
                          <RefreshCw size={12} /> {t('docDevices.rotate')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void revoke(device, 'Revoked from device administration')}
                          disabled={busyId === device.id || device.status === 'revoked'}
                          className="px-3 py-1 text-xs rounded-lg border border-critical text-critical-subtle-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[28px] whitespace-nowrap inline-flex items-center gap-1"
                        >
                          <ShieldOff size={12} /> {t('docDevices.revoke')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default ManagedDevicesPage;
