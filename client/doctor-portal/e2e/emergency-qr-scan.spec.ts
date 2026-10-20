import { writeFileSync } from 'node:fs';
import { test, expect, chromium } from '@playwright/test';
import { api, fixtureToken, readFixtures } from './identity';
import { settle, signIn } from './support';
import { clinicianWorkLocation, enrolDevice, revokeDevice } from './emergency-device';

/**
 * Emergency access by camera: a clinician scans the patient's Medical ID QR
 * and reads the emergency data, through the same server grant an NFC tap uses.
 *
 * The camera is real as far as the page can tell. Chromium is started with a
 * fake capture device that plays an image of the patient's actual QR code (the
 * PNG the patient downloads from the patient app), so the page asks for the
 * camera, opens the stream, and decodes the frames itself. Desktop Chromium on
 * Windows has no BarcodeDetector, so this exercises the jsQR fallback a laptop
 * webcam would use.
 *
 *   1. the patient's QR carries the server's possession proof;
 *   2. scanned, it opens emergency access: blood type and allergy on screen;
 *   3. the patient's access history records it, under a grant, as a QR scan.
 */

const fixtures = () => readFixtures();

test('a clinician scans the patient\'s Medical ID QR with the camera and reads the emergency data', async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(360_000);
  const patient = fixtures().patient;
  const patientToken = await fixtureToken(request, { login_id: patient.login_id, password: patient.password ?? '' });

  // 1. The code the patient downloads.
  const qr = await api(request, 'GET', `/api/medical-id/${patient.linked_patient_id}/qr`, { token: patientToken });
  expect(qr.status).toBe(200);
  expect(String(qr.body?.qr_data?.emergency_proof ?? ''), 'the QR carries no possession proof').toMatch(/^[0-9a-f]{64}$/);
  const png = String(qr.body?.qr_image_base64 ?? '');
  expect(png, 'the QR image is missing').not.toBe('');

  // The fake camera's picture: that PNG on a white page, as one MJPEG frame.
  const painter = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await painter.setContent(
    `<body style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;height:480px">` +
      `<img src="data:image/png;base64,${png}" style="width:360px;height:360px;image-rendering:pixelated"></body>`
  );
  const frame = testInfo.outputPath('patient-qr.mjpeg');
  writeFileSync(frame, await painter.screenshot({ type: 'jpeg', quality: 95 }));
  await painter.close();

  const before = await api(request, 'GET', `/api/patients/${patient.linked_patient_id}/emergency-capsule/access-log`, {
    token: patientToken,
  });
  const countBefore = Number(before.body?.count ?? 0);

  const admin = await browser.newPage();
  await signIn(admin, 'Admin');
  const deviceName = `E2E QR scan tablet ${Date.now()}`;
  const deviceId = await enrolDevice(admin, deviceName, await clinicianWorkLocation(request));

  // The full Chromium build: Playwright's default headless shell has no media
  // capture at all and answers every camera request NotSupportedError.
  const camera = await chromium.launch({
    channel: 'chromium',
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${frame}`],
  });
  try {
    // 2. The scan. The permission is granted the way a person would allow it.
    const context = await camera.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1440, height: 900 },
      permissions: ['camera'],
    });
    const clinician = await context.newPage();
    await signIn(clinician, 'Doctor', 0);
    await settle(clinician, '/emergency');
    await clinician.locator('#approved-device').selectOption(deviceId);
    await clinician.getByRole('button', { name: /^qr code$/i }).click();
    await clinician.getByRole('button', { name: /scan qr code with camera/i }).click();
    await expect(clinician.getByTestId('qr-scanner')).toBeVisible();

    try {
      await expect(clinician.getByText('Access Granted!'), 'the camera scan did not open access').toBeVisible({
        timeout: 45000,
      });
    } catch (error) {
      // This page lives in its own browser, outside Playwright's own failure capture.
      await clinician.screenshot({ path: testInfo.outputPath('clinician.png'), fullPage: true });
      throw error;
    }
    await expect(clinician.getByText('Emergency Access Active')).toBeVisible({ timeout: 10000 });
    await expect(clinician.locator('main')).toContainText('O+');
    await expect(clinician.locator('main')).toContainText(/penicillin/i);
    // The scanner let go of the camera once the code was read.
    await expect(clinician.getByTestId('qr-scanner')).toHaveCount(0);
    await context.close();
  } finally {
    await camera.close();
    await revokeDevice(admin, deviceName);
    await admin.close();
  }

  // 3. The patient can see it happened, and how.
  const after = await api(request, 'GET', `/api/patients/${patient.linked_patient_id}/emergency-capsule/access-log`, {
    token: patientToken,
  });
  expect(Number(after.body?.count ?? 0), 'the scan left no record the patient can read').toBeGreaterThan(countBefore);
  const newest = (after.body?.accesses ?? [])[0] as Record<string, unknown> | undefined;
  expect(newest?.reason_code).toBe('emergency_qr_access');
  expect(String(newest?.grant_id ?? ''), 'the read was not made under a grant').not.toBe('');
});
