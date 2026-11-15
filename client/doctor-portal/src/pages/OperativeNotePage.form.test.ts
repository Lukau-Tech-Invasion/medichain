import { describe, expect, it } from 'vitest';
import {
  emptyOperativeForm, measured, operativeFormReducer, toOperativeNote,
  type OperativeForm,
} from './OperativeNotePage.form';

const defaults = { surgeon: 'surgeon-1', today: '2026-11-12' };
const filing = { patientId: 'PAT-1', patientName: 'John Doe', createdAt: '2026-11-12T08:00:00.000Z' };

describe('operativeFormReducer', () => {
  it('a new note starts with the surgeon and today, and nothing else chosen', () => {
    const form = emptyOperativeForm(defaults);
    expect(form.surgeon).toBe('surgeon-1');
    expect(form.procedureDate).toBe('2026-11-12');
    expect(form.anesthesiaType).toBe('');
    expect(form.woundClass).toBe('');
    expect([form.ebl, form.urineOutput, form.fluidIn]).toEqual(['', '', '']);
  });

  it('sets one field without mutating the previous form', () => {
    const before = emptyOperativeForm(defaults);
    const next = operativeFormReducer(before, { type: 'set', field: 'procedureName', value: 'Appendectomy' });
    expect(next.procedureName).toBe('Appendectomy');
    expect(before.procedureName).toBe('');
  });

  it('adds and removes specimens by id', () => {
    let form = emptyOperativeForm(defaults);
    form = operativeFormReducer(form, { type: 'addSpecimen', specimen: { id: 'S1', description: 'Appendix', disposition: 'pathology' } });
    form = operativeFormReducer(form, { type: 'addSpecimen', specimen: { id: 'S2', description: 'Fluid', disposition: 'culture' } });
    expect(operativeFormReducer(form, { type: 'removeSpecimen', id: 'S1' }).specimens.map((s) => s.id)).toEqual(['S2']);
  });

  it('reset clears the note and takes the defaults it is given', () => {
    let form = emptyOperativeForm(defaults);
    form = operativeFormReducer(form, { type: 'set', field: 'findings', value: 'Inflamed appendix' });
    form = operativeFormReducer(form, { type: 'set', field: 'woundClass', value: 'contaminated' });
    expect(operativeFormReducer(form, { type: 'reset', surgeon: 'surgeon-1', today: '2026-11-13' }))
      .toEqual(emptyOperativeForm({ surgeon: 'surgeon-1', today: '2026-11-13' }));
  });
});

describe('measured', () => {
  it('an empty or non-numeric box is not a measurement', () => {
    expect(measured('')).toBeUndefined();
    expect(measured('abc')).toBeUndefined();
  });

  it('zero is a measurement', () => {
    expect(measured('0')).toBe(0);
    expect(measured('250')).toBe(250);
  });
});

describe('toOperativeNote', () => {
  it('an untouched note files no anaesthetic, no wound class and no volumes', () => {
    const note = toOperativeNote(emptyOperativeForm(defaults), filing);
    expect(note.anesthesiaType).toBeUndefined();
    expect(note.woundClass).toBeUndefined();
    expect(note.ebl).toBeUndefined();
    expect(note.urineOutput).toBeUndefined();
    expect(note.fluidIn).toBeUndefined();
  });

  it('files exactly the record the page used to assemble by hand', () => {
    const form: OperativeForm = {
      ...emptyOperativeForm(defaults),
      assistant: 'A', anesthesiologist: 'An', scrubNurse: 'Sn', circulator: 'C',
      preOpDiagnosis: 'Appendicitis', postOpDiagnosis: 'Perforated appendicitis',
      procedureName: 'Appendectomy', cptCodes: '44950', anesthesiaType: 'general',
      incision: 'McBurney', findings: 'Perforation', procedureText: 'Appendix removed', closure: 'Layers',
      drains: 'None', ebl: '50', urineOutput: '0', fluidIn: '',
      specimens: [{ id: 'S1', description: 'Appendix', disposition: 'pathology' }],
      woundClass: 'contaminated', implants: '', complications: 'None', disposition: 'PACU',
    };
    expect(toOperativeNote(form, filing)).toEqual({
      id: '',
      patientId: 'PAT-1',
      patientName: 'John Doe',
      surgeon: 'surgeon-1', assistant: 'A', anesthesiologist: 'An', scrubNurse: 'Sn', circulator: 'C',
      procedureDate: '2026-11-12', preOpDiagnosis: 'Appendicitis', postOpDiagnosis: 'Perforated appendicitis',
      procedureName: 'Appendectomy', cptCodes: '44950',
      anesthesiaType: 'general', incision: 'McBurney', findings: 'Perforation', procedure: 'Appendix removed',
      closure: 'Layers', drains: 'None', ebl: 50, urineOutput: 0, fluidIn: undefined,
      specimens: [{ id: 'S1', description: 'Appendix', disposition: 'pathology' }],
      woundClass: 'contaminated', implants: '', complications: 'None', disposition: 'PACU',
      createdAt: '2026-11-12T08:00:00.000Z',
    });
  });

  it('does not send the form-only name of the procedure text', () => {
    expect(toOperativeNote(emptyOperativeForm(defaults), filing)).not.toHaveProperty('procedureText');
  });
});
