import { describe, expect, it } from 'vitest';
import {
  allRisksAcknowledged, amaFormReducer, defaultRiskDisclosures, emptyAmaForm,
  readyForSignatures, signaturesComplete, toAmaDischargeRequest,
  type AmaForm, type AmaFormAction,
} from './AMAPage.form';

const after = (form: AmaForm, ...actions: AmaFormAction[]) => actions.reduce(amaFormReducer, form);
const acknowledgeAll = (form: AmaForm) =>
  after(form, ...form.riskDisclosures.map(({ id }): AmaFormAction => ({ type: 'acknowledgeRisk', id })));
const filing = { attendingPhysicianId: 'doc-1', dischargeDatetime: '2026-11-12T08:00:00.000Z' };

describe('amaFormReducer', () => {
  it('a new record discloses the standard risks, none acknowledged, nothing attested', () => {
    const form = emptyAmaForm();
    expect(form.riskDisclosures).toEqual(defaultRiskDisclosures());
    expect(allRisksAcknowledged(form)).toBe(false);
    expect([form.hasCapacity, form.amaFormSigned, form.witnessAttested, form.providerAttested]).toEqual([false, false, false, false]);
  });

  it('sets one field without mutating the previous form', () => {
    const before = emptyAmaForm();
    const next = amaFormReducer(before, { type: 'set', field: 'diagnosis', value: 'Pneumonia' });
    expect(next.diagnosis).toBe('Pneumonia');
    expect(before.diagnosis).toBe('');
  });

  it('toggles a tick box on and off', () => {
    const on = amaFormReducer(emptyAmaForm(), { type: 'toggle', field: 'followUpOffered' });
    expect(on.followUpOffered).toBe(true);
    expect(amaFormReducer(on, { type: 'toggle', field: 'followUpOffered' }).followUpOffered).toBe(false);
  });

  it('acknowledges one risk and leaves the others', () => {
    const form = amaFormReducer(emptyAmaForm(), { type: 'acknowledgeRisk', id: 'r2' });
    expect(form.riskDisclosures.filter((r) => r.acknowledged).map((r) => r.id)).toEqual(['r2']);
  });

  it('starting a new record clears who and what, and nothing else', () => {
    const filled = after(emptyAmaForm(),
      { type: 'set', field: 'formStep', value: 3 },
      { type: 'set', field: 'patientId', value: 'PAT-1' },
      { type: 'set', field: 'patientName', value: 'Jane Doe' },
      { type: 'set', field: 'mrn', value: 'MRN-9' },
      { type: 'set', field: 'diagnosis', value: 'Pneumonia' },
      { type: 'toggle', field: 'hasCapacity' },
      { type: 'acknowledgeRisk', id: 'r1' });
    const started = amaFormReducer(filled, { type: 'startNew' });
    expect(started).toEqual({ ...filled, formStep: 1, patientId: '', patientName: '', diagnosis: '' });
    expect(started.mrn).toBe('MRN-9');
    expect(started.hasCapacity).toBe(true);
  });

  it('reset clears everything, including the acknowledgements', () => {
    const filled = acknowledgeAll(after(emptyAmaForm(),
      { type: 'set', field: 'patientId', value: 'PAT-1' },
      { type: 'set', field: 'riskLevel', value: 'critical' },
      { type: 'toggle', field: 'hasCapacity' },
      { type: 'toggle', field: 'amaFormSigned' }));
    expect(amaFormReducer(filled, { type: 'reset' })).toEqual(emptyAmaForm());
  });
});

describe('signature rules', () => {
  it('signatures wait for every risk, capacity and the refusal of alternatives', () => {
    let form = acknowledgeAll(emptyAmaForm());
    expect(readyForSignatures(form)).toBe(false);
    form = after(form, { type: 'toggle', field: 'hasCapacity' });
    expect(readyForSignatures(form)).toBe(false);
    form = after(form, { type: 'toggle', field: 'patientRefusedAlternatives' });
    expect(readyForSignatures(form)).toBe(true);
    expect(readyForSignatures(after(form, { type: 'acknowledgeRisk', id: 'r1' }))).toBe(false);
  });

  it('signatures are complete only with a named witness', () => {
    const attested = after(emptyAmaForm(),
      { type: 'toggle', field: 'amaFormSigned' }, { type: 'toggle', field: 'witnessAttested' },
      { type: 'toggle', field: 'providerAttested' });
    expect(signaturesComplete(attested)).toBe(false);
    expect(signaturesComplete({ ...attested, witnessName: '   ' })).toBe(false);
    expect(signaturesComplete({ ...attested, witnessName: 'Nurse B' })).toBe(true);
  });
});

describe('toAmaDischargeRequest', () => {
  it('files exactly the request the page used to assemble by hand', () => {
    const form = after(emptyAmaForm(),
      { type: 'set', field: 'patientId', value: 'PAT-1' },
      { type: 'set', field: 'patientName', value: 'Jane Doe' },
      { type: 'set', field: 'mrn', value: 'MRN-9' },
      { type: 'set', field: 'diagnosis', value: 'Pneumonia' },
      { type: 'set', field: 'recommendedTreatment', value: 'IV antibiotics' },
      { type: 'set', field: 'patientStatement', value: 'I need to go home' },
      { type: 'set', field: 'capacityBasis', value: 'Oriented, repeats the risks back' },
      { type: 'set', field: 'witnessName', value: 'Nurse B' },
      { type: 'toggle', field: 'hasCapacity' },
      { type: 'toggle', field: 'patientRefusedAlternatives' },
      { type: 'toggle', field: 'amaFormSigned' },
      { type: 'toggle', field: 'witnessAttested' },
      { type: 'toggle', field: 'providerAttested' },
      { type: 'acknowledgeRisk', id: 'r1' },
      { type: 'acknowledgeRisk', id: 'r4' });
    expect(toAmaDischargeRequest(form, filing)).toEqual({
      patient_id: 'PAT-1',
      discharge_datetime: '2026-11-12T08:00:00.000Z',
      attending_physician_id: 'doc-1',
      reason_for_leaving: 'I need to go home',
      risks_explained: defaultRiskDisclosures().map(({ category, risk, id }) =>
        ({ category, risk, acknowledged: id === 'r1' || id === 'r4' })),
      specific_risks_discussed: 'Condition may worsen without treatment\nRisk of permanent disability or death',
      patient_verbalized_understanding: false,
      decision_making_capacity: true,
      capacity_assessment: 'Oriented, repeats the risks back',
      alternatives_offered: [{ diagnosis: 'Pneumonia', recommended_treatment: 'IV antibiotics' }],
      patient_refused_alternatives: true,
      ama_form_signed: true,
      witness_present: true,
      witness_name: 'Nurse B',
      follow_up_offered: false,
      patient_contact_info_verified: false,
      documentation_complete: true,
    });
  });

  it('understanding is recorded only when every risk was acknowledged', () => {
    expect(toAmaDischargeRequest(acknowledgeAll(emptyAmaForm()), filing).patient_verbalized_understanding).toBe(true);
  });

  it('an unnamed witness is absent, not an empty name', () => {
    expect(toAmaDischargeRequest(emptyAmaForm(), filing).witness_name).toBeUndefined();
  });
});
