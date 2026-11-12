/**
 * POST the pathology and AMA pages' own payloads at a live server and read the
 * records back through the endpoints those pages list from.
 *
 * The payloads are built by the pages' own builders (`<Page>.form.ts`), not
 * retyped here: a probe that writes its own body proves the handler accepts
 * that body, which is how the role journey's AMA step came to pass with a
 * shape the page stopped sending.
 *
 * Synthetic fixtures only; `loadManifest` refuses a non-local endpoint.
 *
 *   cd client
 *   MEDICHAIN_API_URL=http://127.0.0.1:8093/api MEDICHAIN_FIXTURE_MANIFEST=<abs path> \
 *     ./node_modules/.bin/vite-node ../scripts/probe-form-payloads.ts
 */
import { http, loadManifest, signIn, type Json } from './lib/journey';
import { emptyPathologyOrder, toPathologyOrder } from '../client/doctor-portal/src/pages/PathologyPage.form';
import { amaFormReducer, emptyAmaForm, toAmaDischargeRequest, type AmaFormAction } from '../client/doctor-portal/src/pages/AMAPage.form';

let failed = 0;
function check(label: string, ok: boolean, detail: unknown = ''): void {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  -> ${JSON.stringify(detail).slice(0, 400)}`}`);
}
const rows = (body: Json | unknown[]): Json[] => (Array.isArray(body) ? body : (body.items ?? [])) as Json[];

async function main(): Promise<void> {
  const manifest = loadManifest();
  const doctorLogin = manifest.staff.find((s) => s.role === 'Doctor');
  if (!doctorLogin) throw new Error('no Doctor fixture');
  const doctor = await signIn(doctorLogin.login_id, 'doctor');
  const patientId = manifest.patient.linked_patient_id;
  if (!patientId) throw new Error('the patient fixture has no patient id');
  const stamp = Date.now();

  // --- Pathology: two orders, as two people accessioning at once ------------
  const site = `Left breast (probe ${stamp})`;
  const order = toPathologyOrder(
    { ...emptyPathologyOrder(), selectedPatientId: patientId, collectionDate: '2026-11-12', clinician: doctor.userId, site, specimenType: 'biopsy', priority: 'urgent' },
    { patientName: 'Probe Patient', receivedDate: '2026-11-12', receivedBy: doctor.userId },
  );
  check('the pathology order carries no accession number', !('specimenId' in order), order);
  const [first, second] = await Promise.all([
    http('POST', '/surgical/pathology', { token: doctor.token, body: order }),
    http('POST', '/surgical/pathology', { token: doctor.token, body: order }),
  ]);
  check('both simultaneous orders are stored', first.status === 201 && second.status === 201, [first, second]);
  const accessions = [first.json.id, second.json.id] as string[];
  check('each got its own server-minted number', /^S\d\d-[0-9A-Z]{8}$/.test(accessions[0] ?? '') && accessions[0] !== accessions[1], accessions);

  const worklist = rows((await http('GET', '/platform/list/pathology', { token: doctor.token })).json);
  const mine = worklist.filter((row) => accessions.includes(row.id));
  check('both are on the worklist under those numbers', mine.length === 2, worklist.map((row) => row.id));
  const row = mine[0] ?? {};
  check('the worklist row carries the site, type and priority entered', row.specimen_source === site && row.specimen_type === 'biopsy' && row.priority === 'urgent', row);
  check('laterality and fixative, never chosen, were not stored as answers', !row.laterality && !row.fixative, { laterality: row.laterality, fixative: row.fixative });
  check('the stored accession is the minted one, not a second spelling', row.specimenId === row.id, { id: row.id, specimenId: row.specimenId });

  // --- AMA: the form's request, risk level included ------------------------
  const fill: AmaFormAction[] = [
    { type: 'set', field: 'patientId', value: patientId },
    { type: 'set', field: 'diagnosis', value: 'Community-acquired pneumonia' },
    { type: 'set', field: 'recommendedTreatment', value: 'Admission for intravenous antibiotics' },
    { type: 'set', field: 'patientStatement', value: `I need to get home (probe ${stamp})` },
    { type: 'set', field: 'riskLevel', value: 'high' },
    { type: 'set', field: 'capacityBasis', value: 'Alert and oriented; repeats the risks back.' },
    { type: 'set', field: 'witnessName', value: 'Probe Witness' },
    { type: 'toggle', field: 'hasCapacity' },
    { type: 'toggle', field: 'patientRefusedAlternatives' },
  ];
  const filing = { attendingPhysicianId: doctor.userId, dischargeDatetime: new Date().toISOString() };
  const request = toAmaDischargeRequest(fill.reduce(amaFormReducer, emptyAmaForm()), filing);
  const ama = await http('POST', '/clinical/ama', { token: doctor.token, body: request });
  check('the AMA discharge is filed', ama.status === 201, ama);

  const register = rows((await http('GET', '/platform/list/ama-discharges', { token: doctor.token })).json);
  const filed = register.find((r) => r.id === ama.json.ama_id) ?? {};
  check('the register row carries the risk level', filed.risk_level === 'high', filed);
  // What the register page reads off each row. Reported, not asserted: these
  // are the names `AMAPage` renders, and this shows which of them arrive.
  const read = ['patientName', 'mrn', 'status', 'dateCreated', 'provider', 'diagnosis', 'patientStatement'];
  console.log('  INFO  fields AMAPage reads from a register row that are absent:', read.filter((key) => filed[key] === undefined).join(', ') || 'none');

  const invalid = await http('POST', '/clinical/ama', { token: doctor.token, body: { ...request, risk_level: 'hgih' } });
  check('a risk level outside the list is refused', invalid.status === 400 && (invalid.json.error?.code ?? invalid.json.code) === 'INVALID_RISK_LEVEL', invalid);

  console.log(failed === 0 ? '\nprobe: all checks passed' : `\nprobe: ${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
