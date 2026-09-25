import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { settle } from './support';

/**
 * Cross-role workflows, each proved by the person who needs to read the result.
 *
 * The other specs cover single screens. These follow a record from the
 * clinician who writes it to the colleague or patient who acts on it, because a
 * write that only its author can read back proves nothing.
 *
 * Staff sign in through the Quick Login buttons, the app's own demo path; the
 * patient reads through the patient app with the seeded fixture session.
 */

type QuickRole = 'Doctor' | 'Nurse' | 'Lab Technician' | 'Pharmacist' | 'Administrator';

const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';

function fixtures(): {
  patient: { wallet: string; linked_patient_id: string };
} {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    try {
      return JSON.parse(readFileSync(resolve(dir, '.browser-test', 'fixtures.json'), 'utf8'));
    } catch {
      dir = resolve(dir, '..');
    }
  }
  throw new Error('No .browser-test/fixtures.json; run the fixture seeder.');
}

const PATIENT_A = () => fixtures().patient.linked_patient_id;

async function quickLogin(page: Page, role: QuickRole) {
  await page.goto('/login');
  await page.getByRole('button').filter({ hasText: role }).first().click();
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toBeVisible({ timeout: 30000 });
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
}

/** The seeded patient, reading their own app. */
async function patientPage(browser: Browser): Promise<Page> {
  const fx = fixtures().patient;
  const context = await browser.newContext();
  await context.addInitScript(([auth]) => {
    localStorage.setItem('medichain_patient_auth', JSON.stringify(auth));
    localStorage.setItem(
      'medichain_wallet',
      JSON.stringify({ address: (auth as { address: string }).address, role: 'Patient' })
    );
  }, [{ address: fx.wallet, healthId: fx.linked_patient_id, name: 'Browser Test Patient' }]);
  return context.newPage();
}

async function patientSees(browser: Browser, route: string, text: string | RegExp) {
  const page = await patientPage(browser);
  await expect
    .poll(
      async () => {
        await page.goto(`${PATIENT_APP}/${route}`);
        await page.locator('main').first().waitFor({ timeout: 20000 });
        await page.waitForTimeout(2500);
        const body = await page.locator('main').first().innerText();
        return typeof text === 'string' ? body.includes(text) : text.test(body);
      },
      { timeout: 60000, intervals: [3000, 5000, 8000] }
    )
    .toBe(true);
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
  await page.getByText('Thandiwe Browser-Test').first().click();
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
  await page.getByRole('button', { name: /schedule|create|book/i }).last().click();
  // The booking clinician's own list shows the session without a search.
  await expect(page.locator('main')).toContainText('Thandiwe', { timeout: 20000 });
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
  await page.getByRole('button', { name: /^generate$/i }).click();
  // Registration refuses until the clinician confirms the patient has their
  // recovery phrase: without it they could never sign in.
  await page.getByRole('checkbox', { name: /the patient has this phrase/i }).check();
  await page.locator('#register-national-id').fill(`90041${String(Date.now()).slice(-8)}`);
  await page.locator('#register-blood-type').selectOption('A+');
  await page.locator('#register-emergency-contact-name').fill('Sipho Workflow');
  await page.locator('#register-emergency-contact-phone').fill('+27821234567');
  await page.locator('#register-emergency-contact-relationship').fill('Brother');
  await page.getByRole('button', { name: /register patient/i }).click();
  await expect(page.getByText(/registered|success|created/i).first()).toBeVisible({ timeout: 30000 });

  await settle(page, '/patients');
  await page.getByPlaceholder(/search/i).first().fill('Lerato');
  await expect(page.locator('main')).toContainText(name, { timeout: 20000 });
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
  await page.locator('#lab-entry-notes').fill(`Workflow result ${stamp()}`);
  await page.getByRole('button', { name: /submit for review/i }).click();
  await expect(page.getByText(/submitted|review/i).first()).toBeVisible({ timeout: 20000 });

  const doctor = await browser.newPage();
  await quickLogin(doctor, 'Doctor');
  await settle(doctor, '/lab-review');
  await expect(doctor.locator('main')).toContainText('Thandiwe', { timeout: 30000 });
  await doctor.getByRole('button', { name: /approve/i }).first().click();
  const confirm = doctor.getByRole('dialog').getByRole('button', { name: /approve|confirm/i });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(doctor.getByText(/approved/i).first()).toBeVisible({ timeout: 20000 });
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
  await page.getByRole('button', { name: /^generate$/i }).click();
  await page.getByRole('checkbox', { name: /the patient has this phrase/i }).check();
  await page.locator('#register-national-id').fill(`88020${String(Date.now()).slice(-8)}`);
  await page.locator('#register-blood-type').selectOption('Unknown');
  await page.locator('#register-emergency-contact-name').fill('Kin Workflow');
  await page.locator('#register-emergency-contact-phone').fill('+27821230000');
  await page.locator('#register-emergency-contact-relationship').fill('Sister');
  await page.getByRole('button', { name: /register patient/i }).click();
  await expect(page.getByText(/registered|success|created/i).first()).toBeVisible({ timeout: 30000 });

  await settle(page, '/patients');
  await page.getByPlaceholder(/search/i).first().fill('Untyped');
  const main = page.locator('main');
  await expect(main).toContainText(name, { timeout: 20000 });
  await expect(main).toContainText('Unknown');
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
