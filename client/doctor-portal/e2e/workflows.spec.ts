import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFixtures } from './identity';
import { declareAccessReason, settle, signIn, type RoleName } from './support';

/**
 * Cross-role workflows, each proved by the person who needs to read the result.
 *
 * The other specs cover single screens. These follow a record from the
 * clinician who writes it to the colleague or patient who acts on it, because a
 * write that only its author can read back proves nothing.
 *
 * Staff sign in with the accounts provisioned by the fixture seeder; the
 * patient reads through the patient app with its seeded credentials.
 */

type QuickRole = 'Doctor' | 'Nurse' | 'Lab Technician' | 'Pharmacist' | 'Administrator';

const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';

function fixtures(): {
  patient: { login_id: string; password: string; linked_patient_id: string };
} {
  return readFixtures();
}

const PATIENT_A = () => fixtures().patient.linked_patient_id;

async function quickLogin(page: Page, role: QuickRole) {
  const fixtureRole: Record<QuickRole, RoleName> = {
    Doctor: 'Doctor',
    Nurse: 'Nurse',
    'Lab Technician': 'LabTechnician',
    Pharmacist: 'Pharmacist',
    Administrator: 'Admin',
  };
  await signIn(page, fixtureRole[role], 0);
}

/**
 * Choose the seeded patient in a PatientSelect by record id. The shared
 * helper takes the first option as soon as any is visible, which is the
 * unfiltered list while the search is still debouncing.
 */
async function pickPatient(page: Page, selector: string, patientId: string) {
  const input = page.locator(selector);
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator(`${selector}-selected`).click();
  }
  await input.click();
  await input.fill(patientId);
  const option = page
    .locator('div.absolute.z-50 button[type="button"]')
    .or(page.locator('[role="listbox"] button'))
    .filter({ hasText: patientId });
  await expect(option.first()).toBeVisible({ timeout: 20000 });
  await option.first().click();
  await declareAccessReason(page);
}

/** The seeded patient, reading their own app: a real sign-in, as a patient does it. */
async function patientPage(browser: Browser): Promise<Page> {
  const fx = fixtures().patient;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${PATIENT_APP}/login`);
  await page.locator('input#username').fill(fx.login_id);
  await page.locator('input#password').fill(fx.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30000 });
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
  return page;
}

async function patientSees(browser: Browser, route: string, text: string | RegExp) {
  const page = await patientPage(browser);
  // The patient session is held in memory. A full navigation discards it and
  // silently returns to sign-in, so follow the app's own router link.
  let link = page.locator(`a[href$="/${route}"]:visible`).first();
  if (!(await link.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'All pages' }).click();
    link = page.locator(`dialog[open] a[href$="/${route}"]`).first();
  }
  await link.click();
  let lastBody = '';
  const shows = async () => {
    await page.locator('main').first().waitFor({ timeout: 20000 });
    lastBody = await page.locator('main').first().innerText();
    return typeof text === 'string' ? lastBody.includes(text) : text.test(lastBody);
  };
  // The message is built after polling, so it reports what the page last showed.
  await expect.poll(shows, { timeout: 60000, intervals: [3000, 5000, 8000] }).toBe(true)
    .catch((error: unknown) => {
      throw new Error(`Patient ${route} did not show expected record; visible content: ${lastBody.slice(0, 2000)}`, { cause: error });
    });
  await page.context().close();
}

const stamp = () => new Date().toISOString().slice(11, 19).replace(/:/g, '');

test('a doctor writes a SOAP note and the patient can read it', async ({ page, browser }) => {
  test.setTimeout(240000);
  await quickLogin(page, 'Doctor');
  await settle(page, '/soap');
  await pickPatient(page, '#soap-patient-id', PATIENT_A());
  await page.locator('#soap-chief-complaint').fill(`Headache for three days (wf ${stamp()})`);
  await page.locator('#soap-clinical-summary').fill('Tension-type headache, no red flags.');
  await page.locator('#soap-treatment-plan').fill('Paracetamol as needed; review in two weeks.');
  await page.getByRole('button', { name: /create soap note/i }).click();
  await expect(page.getByText(/created|saved|success/i).first()).toBeVisible({ timeout: 20000 });

  // The patient's records list a visit note by its assessment summary.
  await patientSees(browser, 'records', 'Tension-type headache, no red flags.');
});

test('a nurse records vital signs and the patient sees them', async ({ page, browser }) => {
  test.setTimeout(240000);
  await quickLogin(page, 'Nurse');
  await settle(page, '/vitals');
  await pickPatient(page, '#vitals-patient-select', PATIENT_A());
  if (!(await page.locator('#vitals-heart-rate').isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /record|new|add/i }).first().click();
  }
  await page.locator('#vitals-heart-rate').fill('97');
  await page.locator('#vitals-bp-systolic').fill('131');
  await page.locator('#vitals-bp-diastolic').fill('84');
  await page.locator('#vitals-temperature').fill('37.4');
  await page.getByRole('button', { name: /save|record vital|submit/i }).last().click();
  await expect(page.getByText(/recorded|saved|success/i).first()).toBeVisible({ timeout: 20000 });

  await patientSees(browser, 'vitals', /131\s*\/\s*84/);
});

test('a doctor prescribes, the pharmacist sees it, and so does the patient', async ({ page, browser }) => {
  test.setTimeout(300000);
  const drug = 'Amlodipine';
  await quickLogin(page, 'Doctor');
  await settle(page, '/e-prescribe');
  await pickPatient(page, '#patient_id', PATIENT_A());
  await page.locator('#medication_name').fill(drug);
  await page.locator('#strength').fill('5 mg');
  await page.locator('#directions').fill('One tablet by mouth once daily');
  await page.getByRole('button', { name: /send prescription/i }).click();
  await expect(page.getByText(/sent|success|created|signed/i).first()).toBeVisible({ timeout: 20000 });

  const pharm = await browser.newPage();
  await quickLogin(pharm, 'Pharmacist');
  await expect
    .poll(async () => (await pharm.locator('main').first().innerText()).includes(drug), { timeout: 30000 })
    .toBe(true);
  await pharm.close();

  await patientSees(browser, 'medications', drug);
});

test('a nurse records an ambulance handover: arrivals board and the patient', async ({ page, browser }) => {
  test.setTimeout(240000);
  const complaint = `Fall from ladder (wf ${stamp()})`;
  await quickLogin(page, 'Nurse');
  await settle(page, '/ems-handoff');
  await pickPatient(page, '#ems-patient', PATIENT_A());
  await page.locator('#ems-agency').fill('Metro EMS');
  await page.locator('#ems-complaint').fill(complaint);
  await page.getByRole('button', { name: /add a set/i }).click();
  await page.getByLabel(/^Pulse$/i).fill('104');
  await page.getByRole('button', { name: /record handover/i }).click();
  await expect(page.getByText(/recorded/i).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('ems-arrivals')).toContainText(complaint, { timeout: 20000 });

  await patientSees(browser, 'records', 'Ambulance handover (Metro EMS)');
});

test('a nurse triages a patient and they join the triage queue', async ({ page }) => {
  test.setTimeout(240000);
  await quickLogin(page, 'Nurse');
  await settle(page, '/triage');
  await page.getByPlaceholder(/search patient/i).fill('Thandiwe');
  await page.getByText('Thandiwe Ndlovu').first().click();
  await page.getByRole('button', { name: /^3\s*Urgent/i }).click();
  await page.locator('#triage-chief-complaint').fill('Abdominal pain, vomiting since morning');
  await page.locator('#triage-heart-rate').fill('102');
  await page.getByRole('button', { name: /complete triage assessment/i }).click();
  await expect(page.getByText(/complete|saved|recorded|success/i).first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /triage queue/i }).click();
  await expect(page.locator('main')).toContainText('Thandiwe', { timeout: 20000 });
});

test('a doctor books a telehealth session and can show its join QR', async ({ page }) => {
  test.setTimeout(240000);
  await quickLogin(page, 'Doctor');
  await settle(page, '/telehealth');
  await page.getByRole('button', { name: /new session/i }).click();
  await pickPatient(page, '#telehealth-form-patient', PATIENT_A());
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await page.locator('#telehealth-date').fill(tomorrow);
  await page.locator('#telehealth-time').fill('10:30');
  await expect(page.locator('#telehealth-date')).toHaveValue(tomorrow);
  await expect(page.locator('#telehealth-time')).toHaveValue('10:30');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/telehealth/sessions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /schedule|create|book/i }).last().click();
  const response = await created;
  // `ErrorResponse` serialises to the canonical `{ error: { code, message } }`; accept the flat shape too.
  const body = response.status() === 503 ? await response.json().catch(() => ({})) : {};
  const code = body?.error?.code ?? body?.code;
  if (response.status() === 503 && code === 'TELEHEALTH_UNAVAILABLE') {
    // A deployment with telehealth switched off must say so, not blame the network.
    await expect(page.getByText('The telehealth session could not be created')).toBeVisible();
    await expect(page.getByText(/failed to connect to server/i)).toHaveCount(0);
    test.skip(true, 'Telehealth is disabled on this deployment; booking needs a telehealth-enabled stack');
  }
  expect(response.status(), 'telehealth session was refused').toBeLessThan(300);
  await expect(page.getByRole('heading', { name: /schedule new telehealth session/i })).toHaveCount(0);
  // The booking clinician's own list shows the persisted session without a search.
  await expect(page.getByRole('button', { name: /join qr|qr/i }).first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /join qr|qr/i }).first().click();
  await expect(page.locator('#join-qr img, img[alt*="QR" i]').first()).toBeVisible({ timeout: 20000 });
});

test('a doctor registers a patient who can then be found', async ({ page }) => {
  test.setTimeout(240000);
  const name = `Lerato Workflow ${stamp()}`;
  await quickLogin(page, 'Doctor');
  await settle(page, '/register');
  await page.locator('#register-full-name').fill(name);
  await page.locator('#register-date-of-birth').fill('1990-04-12');
  await page.locator('#register-national-id').fill(`90041${String(Date.now()).slice(-8)}`);
  await page.locator('#register-blood-type').selectOption('A+');
  await page.locator('#register-emergency-contact-name').fill('Sipho Workflow');
  await page.locator('#register-emergency-contact-phone').fill('+27821234567');
  await page.locator('#register-emergency-contact-relationship').fill('Brother');
  await page.getByRole('button', { name: /register patient/i }).click();
  await expect(page.getByText(/registered|success|created/i).first()).toBeVisible({ timeout: 30000 });
  // The way in is handed over here, once: a one-time activation code in the
  // XXXX-XXXX-XXXX shape.
  await expect(page.getByText(/\b[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}\b/).first()).toBeVisible({
    timeout: 30000,
  });

  await settle(page, '/patients');
  await page.getByPlaceholder(/search/i).first().fill('Lerato');
  await expect(page.locator('#main-content')).toContainText(name, { timeout: 20000 });
});

test('a lab result is entered, approved, and reaches the patient and their trends', async ({ page, browser }) => {
  test.setTimeout(360000);
  await quickLogin(page, 'Lab Technician');
  await settle(page, '/lab-results');
  await page.getByRole('tab', { name: /enter result/i }).click();
  await pickPatient(page, '#lab-entry-patient', PATIENT_A());
  const panel = page.locator('#lab-entry-panel');
  const panelValue = await panel.locator('option').nth(1).getAttribute('value');
  await panel.selectOption(panelValue as string);
  await page.locator('input[id^="lab-value-"]').first().fill('5.4');
  // The fictional report states adult-female ranges; the group is never inferred.
  await page.getByRole('combobox', { name: /Reference range group from the laboratory report/i })
    .selectOption({ label: 'Adult female' });
  const note = `Workflow result ${stamp()}`;
  await page.locator('#lab-entry-notes').fill(note);
  // Proof of submission is the server's answer, not text that also matches a tab label.
  const submitted = page.waitForResponse((r) => r.url().endsWith('/api/lab/submit') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /submit for review/i }).click();
  expect((await submitted).status(), 'lab submission was refused').toBeLessThan(300);

  const doctor = await browser.newPage();
  await quickLogin(doctor, 'Doctor');
  await settle(doctor, '/lab-review');
  // Approve this run's submission, never whichever happens to be first in the queue.
  const ours = doctor.locator('li[data-testid^="lab-submission-"]').filter({ hasText: note });
  await expect(ours).toHaveCount(1, { timeout: 30000 });
  await expect(ours).toContainText('Thandiwe');
  await ours.getByRole('button', { name: /^approve$/i }).click();
  const confirm = doctor.getByRole('dialog').getByRole('button', { name: /approve|confirm/i });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(ours).toHaveCount(0, { timeout: 20000 });
  await doctor.close();

  await patientSees(browser, 'lab-results', '5.4');
  await patientSees(browser, 'lab-trends', /\S/);
});

test('an untyped patient registers with blood group Unknown, not a guess', async ({ page }) => {
  test.setTimeout(240000);
  const name = `Untyped Workflow ${stamp()}`;
  await quickLogin(page, 'Doctor');
  await settle(page, '/register');
  await page.locator('#register-full-name').fill(name);
  await page.locator('#register-date-of-birth').fill('1988-02-02');
  await page.locator('#register-national-id').fill(`88020${String(Date.now()).slice(-8)}`);
  await page.locator('#register-blood-type').selectOption('Unknown');
  await page.locator('#register-emergency-contact-name').fill('Kin Workflow');
  await page.locator('#register-emergency-contact-phone').fill('+27821230000');
  await page.locator('#register-emergency-contact-relationship').fill('Sister');
  await page.getByRole('button', { name: /register patient/i }).click();
  await expect(page.getByText(/registered|success|created/i).first()).toBeVisible({ timeout: 30000 });
  // The way in is handed over here, once: a one-time activation code in the
  // XXXX-XXXX-XXXX shape.
  await expect(page.getByText(/\b[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}\b/).first()).toBeVisible({
    timeout: 30000,
  });

  await settle(page, '/patients');
  await page.getByPlaceholder(/search/i).first().fill('Untyped');
  const main = page.locator('#main-content');
  await expect(main).toContainText(name, { timeout: 20000 });
  const patientLink = page.getByRole('link', { name: new RegExp(name) });
  const patientId = (await patientLink.getAttribute('href'))?.split('/').pop();
  expect(patientId).toBeTruthy();
  await settle(page, '/appointments');
  await page.getByRole('button', { name: /new appointment/i }).first().click();
  await pickPatient(page, '#patient_id', patientId!);
  // Give this run its own business-hours slot. Other workflow cases book the
  // same clinician, so a fixed time makes this test depend on suite order.
  const slot = Math.floor(Date.now() / 1000) % (180 * 36);
  const dayOffset = 2 + Math.floor(slot / 36);
  const quarterHour = slot % 36;
  const appointmentDate = new Date(Date.now() + dayOffset * 86400000).toISOString().slice(0, 10);
  const appointmentTime = `${String(8 + Math.floor(quarterHour / 4)).padStart(2, '0')}:${String((quarterHour % 4) * 15).padStart(2, '0')}`;
  await page.locator('#preferred_date').fill(appointmentDate);
  await page.locator('#preferred_time').fill(appointmentTime);
  await page.locator('#reason').fill('Clinical assessment after registration');
  await page.getByRole('button', { name: /book appointment/i }).click();
  await expect(page.getByRole('heading', { name: /schedule new appointment/i })).toHaveCount(0);
  await settle(page, '/patients');
  await page.getByPlaceholder(/search/i).first().fill('Untyped');
  // The directory intentionally excludes clinical fields. Open this patient's
  // chart and declare the treatment purpose before checking the blood group.
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByTestId('access-reason-gate')).toBeVisible({ timeout: 10000 });
  await declareAccessReason(page);
  await expect(page.locator('#main-content')).toContainText('Blood: Unknown', { timeout: 20000 });
});

test('glucose is entered in mmol/L: 110 is refused as mg/dL, 5.4 is recorded', async ({ page }) => {
  test.setTimeout(240000);
  await quickLogin(page, 'Nurse');
  await settle(page, '/vitals');
  await pickPatient(page, '#vitals-patient-select', PATIENT_A());
  if (!(await page.locator('#vitals-blood-glucose').isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /record|new|add/i }).first().click();
  }
  await expect(page.getByText('Blood Glucose (mmol/L)')).toBeVisible();
  await page.locator('#vitals-heart-rate').fill('88');
  await page.locator('#vitals-blood-glucose').fill('110');
  await page.getByRole('button', { name: /save|record vital|submit/i }).last().click();
  await expect(page.getByText(/not mg\/dL|not plausible/i).first()).toBeVisible({ timeout: 20000 });

  await page.locator('#vitals-blood-glucose').fill('5.4');
  await page.getByRole('button', { name: /save|record vital|submit/i }).last().click();
  await expect(page.getByText(/recorded|saved|success/i).first()).toBeVisible({ timeout: 20000 });
});

test('sepsis and toxicology forms label their values in SI units', async ({ page }) => {
  test.setTimeout(240000);
  await quickLogin(page, 'Doctor');
  await settle(page, '/sepsis');
  await expect(page.locator('main')).toContainText('Bilirubin (µmol/L)', { timeout: 20000 });
  await expect(page.locator('main')).toContainText('Creatinine (µmol/L)');
  await settle(page, '/toxicology');
  await expect(page.locator('main')).toContainText('Ethanol (mmol/L)', { timeout: 20000 });
  await expect(page.locator('main')).not.toContainText('mg/dL');
});
