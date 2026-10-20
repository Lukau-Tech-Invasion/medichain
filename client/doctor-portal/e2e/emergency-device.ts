import { expect, type Page } from '@playwright/test';
import { api, fixtureToken, readFixtures } from './identity';
import { answerPasswordConfirmation, settle } from './support';

/**
 * An approved device for emergency access, enrolled through the admin screen
 * and bound to the doctor fixture's work location. Shared by the NFC and QR
 * emergency specs.
 */

const fixtures = () => readFixtures();

export async function enrolDevice(
  admin: Page,
  name: string,
  workLocation: { organization_id: string; facility_id: string }
): Promise<string> {
  await settle(admin, '/devices');
  await expect(admin.getByRole('heading', { name: /approved devices/i })).toBeVisible({ timeout: 20000 });
  await admin.locator('#device-org').selectOption(workLocation.organization_id);
  await admin.locator('#device-facility').selectOption(workLocation.facility_id);
  await admin.locator('#device-name').fill(name);
  await admin.locator('#device-fingerprint').fill(`e2e-emergency-${Date.now()}`);
  await admin.getByRole('button', { name: /enrol device/i }).click();

  const row = admin.locator('[data-testid="device-table"] tr').filter({ hasText: name });
  await expect(row).toHaveCount(1, { timeout: 20000 });
  const deviceId = (await row.locator('td').nth(1).innerText()).trim();
  expect(deviceId).not.toEqual('');

  await row.getByRole('button', { name: /provision key/i }).click();
  await expect(row).toContainText(/active/i, { timeout: 20000 });
  return deviceId;
}

/** Bind a test device to the clinician's real work assignment. */
export async function clinicianWorkLocation(request: Parameters<typeof api>[0]) {
  const doctor = fixtures().staff.find((member) => member.role === 'Doctor');
  expect(doctor, 'the fixture has no doctor').toBeTruthy();
  const token = await fixtureToken(request, {
    login_id: doctor!.login_id,
    password: doctor!.password ?? '',
  });
  const response = await api(request, 'POST', '/api/identity/context/work', { token, data: {} });
  expect(response.status).toBe(200);
  const { organization_id, facility_id } = response.body.context ?? {};
  expect(organization_id).toBeTruthy();
  expect(facility_id).toBeTruthy();
  return { organization_id: String(organization_id), facility_id: String(facility_id) };
}

/** Revoke the device again, leaving the fleet as it was found. */
export async function revokeDevice(admin: Page, name: string): Promise<void> {
  await settle(admin, '/devices');
  const row = admin.locator('[data-testid="device-table"] tr').filter({ hasText: name });
  await row.getByRole('button', { name: /^revoke$/i }).click();
  // Revoking a device that still carries another person's emergency grant
  // revokes that grant too: ADR-0008 Class C, confirmed by the administrator.
  await answerPasswordConfirmation(admin, 'Admin');
  await expect(row).toContainText(/revoked/i, { timeout: 20000 });
}
