import { describe, expect, it } from 'vitest';
import {
  SOAP_FIELDS, emptySoapForm, soapFormReducer, toSoapNoteRequest,
  type SoapForm, type SoapFormAction,
} from './SOAPNotePage.form';

const after = (form: SoapForm, ...actions: SoapFormAction[]) => actions.reduce(soapFormReducer, form);

describe('soapFormReducer', () => {
  it('sets one field and leaves the rest, without mutating the previous form', () => {
    const before = emptySoapForm();
    const next = soapFormReducer(before, { type: 'set', field: 'chiefComplaint', value: 'Chest pain' });
    expect(next.chiefComplaint).toBe('Chest pain');
    expect(before.chiefComplaint).toBe('');
    expect({ ...next, chiefComplaint: '' }).toEqual(before);
  });

  it('reset is the empty form, including the defaults', () => {
    const typed = after(emptySoapForm(),
      { type: 'set', field: 'encounterType', value: 'follow-up' },
      { type: 'set', field: 'primaryStatus', value: 'rule-out' },
      { type: 'addMedication' });
    expect(soapFormReducer(typed, { type: 'reset' })).toEqual(emptySoapForm());
  });

  it('an inserted template is added to what was written, replacing nothing', () => {
    const typed = soapFormReducer(emptySoapForm(), { type: 'set', field: 'hpi', value: 'Tight chest since 07:00.' });
    const next = soapFormReducer(typed, {
      type: 'appendSections',
      sections: { subjective: 'Onset, character, radiation.', objective: '', assessment: '', plan: 'ECG, troponin.' },
    });
    expect(next.hpi).toBe('Tight chest since 07:00.\n\nOnset, character, radiation.');
    expect(next.treatmentPlan).toBe('ECG, troponin.'); // nothing was there: no leading blank lines
    expect(next.generalAppearance).toBe('');           // an empty section adds nothing
  });

  it('a template arriving with the page fills only the sections it has', () => {
    const typed = soapFormReducer(emptySoapForm(), { type: 'set', field: 'clinicalSummary', value: 'Kept' });
    const next = soapFormReducer(typed, { type: 'fillSections', sections: { subjective: 'S', assessment: '' } });
    expect(next.hpi).toBe('S');
    expect(next.clinicalSummary).toBe('Kept');
  });

  it('examination rows are added normal and empty, edited by index, and removed by index', () => {
    const form = after(emptySoapForm(),
      { type: 'addExam', system: 'Cardiovascular' },
      { type: 'addExam', system: 'Respiratory' },
      { type: 'updateExam', index: 1, field: 'findings', value: 'Wheeze' },
      { type: 'updateExam', index: 1, field: 'is_normal', value: false });
    expect(form.physicalExams).toEqual([
      { system: 'Cardiovascular', findings: '', is_normal: true },
      { system: 'Respiratory', findings: 'Wheeze', is_normal: false },
    ]);
    expect(soapFormReducer(form, { type: 'removeExam', index: 0 }).physicalExams.map((e) => e.system)).toEqual(['Respiratory']);
  });

  it('medication rows start oral and blank, and are edited and removed by index', () => {
    const form = after(emptySoapForm(),
      { type: 'addMedication' },
      { type: 'addMedication' },
      { type: 'updateMedication', index: 0, field: 'medication', value: 'Aspirin' });
    expect(form.medications[0]).toEqual({ medication: 'Aspirin', dosage: '', route: 'PO', frequency: '', duration: '' });
    expect(soapFormReducer(form, { type: 'removeMedication', index: 0 }).medications).toHaveLength(1);
  });

  it('lists every field once, in form order, for the draft', () => {
    expect(SOAP_FIELDS).toHaveLength(27);
    expect(SOAP_FIELDS[0]).toBe('encounterType');
    expect(new Set(SOAP_FIELDS).size).toBe(27);
  });
});

describe('toSoapNoteRequest', () => {
  it('an untouched form sends nothing it was not given', () => {
    expect(toSoapNoteRequest(emptySoapForm(), 'PAT-1')).toEqual({
      patient_id: 'PAT-1',
      encounter_type: 'initial',
      subjective: {
        chief_complaint: '', history_of_present_illness: '', symptoms: [],
        social_history: undefined, family_history: undefined, symptom_duration: undefined,
        review_of_systems: undefined, modifying_factors: undefined, previous_treatments: undefined,
      },
      objective: {
        vital_signs: null, general_appearance: undefined, physical_exam: [],
        lab_results: [], imaging_results: [], diagnostic_tests: [],
      },
      assessment: {
        primary_diagnosis: undefined, secondary_diagnoses: [], clinical_summary: '',
        severity: undefined, prognosis: undefined,
      },
      plan: {
        treatment_plan: '', medications: [], procedures: [], lab_orders: [], imaging_orders: [],
        referrals: [], patient_education: [], follow_up: undefined, return_precautions: [],
        activity_restrictions: undefined,
      },
    });
  });

  it('trims text, splits comma lists and drops blanks', () => {
    const form: SoapForm = {
      ...emptySoapForm(),
      chiefComplaint: '  Chest pain ', hpi: ' Since 07:00 ', symptoms: 'nausea, , sweating ,',
      symptomDuration: ' 2 hours ', labOrders: 'troponin,FBC', followUp: '   ',
    };
    const body = toSoapNoteRequest(form, 'PAT-1');
    expect(body.subjective.chief_complaint).toBe('Chest pain');
    expect(body.subjective.history_of_present_illness).toBe('Since 07:00');
    expect(body.subjective.symptoms).toEqual(['nausea', 'sweating']);
    expect(body.subjective.symptom_duration).toBe('2 hours');
    expect(body.plan.lab_orders).toEqual(['troponin', 'FBC']);
    expect(body.plan.follow_up).toBeUndefined(); // whitespace is not a follow-up
  });

  it('a diagnosis exists only if one was written, and carries its status', () => {
    const none = toSoapNoteRequest({ ...emptySoapForm(), primaryICD10: 'I21.9', primaryStatus: 'provisional' }, 'P');
    expect(none.assessment.primary_diagnosis).toBeUndefined(); // a code alone is not a diagnosis

    const some = toSoapNoteRequest(
      { ...emptySoapForm(), primaryDiagnosis: ' STEMI ', primaryICD10: ' ', primaryStatus: 'provisional' }, 'P');
    expect(some.assessment.primary_diagnosis).toEqual({ description: 'STEMI', icd10_code: undefined, status: 'provisional' });
  });

  it('sends only examination rows with findings and medication rows with a name', () => {
    const body = toSoapNoteRequest({
      ...emptySoapForm(),
      physicalExams: [
        { system: 'General', findings: '  ', is_normal: true },
        { system: 'Respiratory', findings: 'Wheeze', is_normal: false },
      ],
      medications: [
        { medication: ' ', dosage: '75 mg', route: 'PO', frequency: 'daily', duration: '30d' },
        { medication: 'Aspirin', dosage: '75 mg', route: 'PO', frequency: 'daily', duration: '30d' },
      ],
    }, 'P');
    expect(body.objective.physical_exam).toEqual([{ system: 'Respiratory', findings: 'Wheeze', is_normal: false }]);
    expect(body.plan.medications.map((m) => m.medication)).toEqual(['Aspirin']);
  });
});
