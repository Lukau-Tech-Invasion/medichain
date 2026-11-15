import { describe, expect, it } from 'vitest';
import {
  emptySepsisForm, measured, sepsisFormReducer, toSepsisRequest,
  type SepsisForm, type SepsisFormAction,
} from './SepsisPage.form';

const after = (form: SepsisForm, ...actions: SepsisFormAction[]) => actions.reduce(sepsisFormReducer, form);
const filing = { patientId: 'PAT-1', protocolStartTime: '2026-11-12T08:00:00.000Z', elapsedMinutes: 42 };
const tick = (id: string, bundle: 'hour1' | 'hour3' = 'hour1'): SepsisFormAction =>
  ({ type: 'toggleBundleItem', bundle, id, at: '2026-11-12T08:05:00.000Z', by: 'nurse-1' });

describe('sepsisFormReducer', () => {
  it('a new assessment has no observations, no measurements and nothing ticked', () => {
    const form = emptySepsisForm();
    expect([form.respiratoryRate, form.systolicBP, form.gcsScore]).toEqual([null, null, null]);
    expect([form.pao2fio2, form.platelets, form.bilirubin, form.map, form.creatinine, form.urineOutput, form.noradrenaline])
      .toEqual(['', '', '', '', '', '', '']);
    expect([...form.hour1Bundle, ...form.hour3Bundle].some((item) => item.completed)).toBe(false);
  });

  it('sets one field without mutating the previous form', () => {
    const before = emptySepsisForm();
    const next = sepsisFormReducer(before, { type: 'set', field: 'respiratoryRate', value: 24 });
    expect(next.respiratoryRate).toBe(24);
    expect(before.respiratoryRate).toBeNull();
  });

  it('ticking a bundle item records who and when; unticking forgets both', () => {
    const ticked = after(emptySepsisForm(), tick('blood_cultures'));
    expect(ticked.hour1Bundle.find((item) => item.id === 'blood_cultures')).toMatchObject({
      completed: true, completedAt: '2026-11-12T08:05:00.000Z', completedBy: 'nurse-1',
    });
    expect(ticked.hour1Bundle.filter((item) => item.completed)).toHaveLength(1);

    const unticked = after(ticked, tick('blood_cultures'));
    expect(unticked.hour1Bundle.find((item) => item.id === 'blood_cultures')).toMatchObject({
      completed: false, completedAt: undefined, completedBy: undefined,
    });
  });

  it('an automatic completion ticks once and never un-ticks', () => {
    const done: SepsisFormAction = { type: 'completeBundleItem', bundle: 'hour1', id: 'fluids', at: 'T1', by: 'nurse-1' };
    const once = after(emptySepsisForm(), done);
    expect(once.hour1Bundle.find((item) => item.id === 'fluids')).toMatchObject({ completed: true, completedAt: 'T1', completedBy: 'nurse-1' });
    // A second qualifying change keeps the first time and the first person.
    const twice = after(once, { ...done, at: 'T2', by: 'nurse-2' });
    expect(twice.hour1Bundle.find((item) => item.id === 'fluids')).toMatchObject({ completed: true, completedAt: 'T1', completedBy: 'nurse-1' });
  });

  it('the two bundles are ticked independently', () => {
    const form = after(emptySepsisForm(), tick('repeat_lactate', 'hour3'));
    expect(form.hour3Bundle[0].completed).toBe(true);
    expect(form.hour1Bundle.some((item) => item.completed)).toBe(false);
  });

  it('adds the typed lactate as a venous reading and clears the box', () => {
    const form = after(emptySepsisForm(),
      { type: 'set', field: 'newLactate', value: '4.2' },
      { type: 'addLactate', timestamp: '2026-11-12T08:10:00.000Z' });
    expect(form.lactateReadings).toEqual([{ timestamp: '2026-11-12T08:10:00.000Z', value: 4.2, source: 'venous' }]);
    expect(form.newLactate).toBe('');
  });

  it('an empty lactate box adds no reading', () => {
    const before = emptySepsisForm();
    expect(sepsisFormReducer(before, { type: 'addLactate', timestamp: 'T' })).toBe(before);
  });
});

describe('measured', () => {
  it('an empty box is not a measurement, and zero is', () => {
    expect(measured('')).toBeUndefined();
    expect(measured('  ')).toBeUndefined();
    expect(measured('0')).toBe(0);
    expect(measured('1.5')).toBe(1.5);
  });
});

describe('toSepsisRequest', () => {
  it('sends no score, only what they are scored from', () => {
    const request: object = toSepsisRequest(emptySepsisForm(), filing);
    expect(request).not.toHaveProperty('qsofa_score');
    expect(request).not.toHaveProperty('sofa_score');
  });

  it('an unmeasured organ is absent, not a normal result', () => {
    const request = toSepsisRequest(emptySepsisForm(), filing);
    expect(request.sofa_inputs).toEqual({
      pao2_fio2: undefined, respiratory_support: false, platelets: undefined,
      bilirubin_umol_l: undefined, mean_arterial_pressure: undefined,
      creatinine_umol_l: undefined, urine_output_ml_24h: undefined,
      vasopressors: { noradrenaline_mcg_kg_min: undefined },
    });
    expect(request.vital_signs).toEqual({
      respiratory_rate: null, systolic_blood_pressure: null, glasgow_coma_scale: null,
      mean_arterial_pressure: undefined,
    });
  });

  it('an unclassified assessment with no fluid recorded sends neither', () => {
    const request = toSepsisRequest(emptySepsisForm(), filing);
    expect(request.severity).toBeUndefined();
    expect(request.treatment).toEqual({ fluid_volume_ml: undefined, vasopressor: '' });
  });

  it('files exactly what was entered', () => {
    const form = after(emptySepsisForm(),
      { type: 'set', field: 'respiratoryRate', value: 24 },
      { type: 'set', field: 'systolicBP', value: 88 },
      { type: 'set', field: 'gcsScore', value: 14 },
      { type: 'set', field: 'map', value: '60' },
      { type: 'set', field: 'platelets', value: '90' },
      { type: 'set', field: 'noradrenaline', value: '0.2' },
      { type: 'set', field: 'classification', value: 'septic_shock' },
      { type: 'set', field: 'infectionSource', value: 'Pneumonia' },
      { type: 'set', field: 'suspectedOrganism', value: 'S. pneumoniae' },
      { type: 'set', field: 'antibioticsGiven', value: ['Ceftriaxone'] },
      { type: 'set', field: 'fluidVolume', value: '2000' },
      { type: 'set', field: 'vasopressorType', value: 'norepinephrine' },
      { type: 'set', field: 'narrative', value: 'Deteriorating' });
    expect(toSepsisRequest(form, filing)).toEqual({
      patient_id: 'PAT-1',
      severity: 'septic_shock',
      suspected_source: 'Pneumonia',
      vital_signs: {
        respiratory_rate: 24, systolic_blood_pressure: 88, glasgow_coma_scale: 14, mean_arterial_pressure: 60,
      },
      sofa_inputs: {
        pao2_fio2: undefined, respiratory_support: false, platelets: 90, bilirubin_umol_l: undefined,
        mean_arterial_pressure: 60, creatinine_umol_l: undefined, urine_output_ml_24h: undefined,
        vasopressors: { noradrenaline_mcg_kg_min: 0.2 },
      },
      labs: { lactate_readings: [] },
      infection: { source: 'Pneumonia', suspected_organism: 'S. pneumoniae', antibiotics: ['Ceftriaxone'] },
      bundle_completion: {
        hour_1: form.hour1Bundle, hour_3: form.hour3Bundle,
        all_hour1_complete: false, all_hour3_complete: false,
      },
      treatment: { fluid_volume_ml: 2000, vasopressor: 'norepinephrine' },
      vasopressors_required: true,
      protocol_start_time: '2026-11-12T08:00:00.000Z',
      elapsed_minutes: 42,
      narrative: 'Deteriorating',
    });
  });

  it('a bundle is complete only when every item in it is ticked', () => {
    const form = after(emptySepsisForm(),
      tick('repeat_lactate', 'hour3'), tick('reassess_volume', 'hour3'), tick('perfusion_check', 'hour3'),
      tick('lactate'));
    const { bundle_completion } = toSepsisRequest(form, filing) as { bundle_completion: Record<string, unknown> };
    expect(bundle_completion.all_hour3_complete).toBe(true);
    expect(bundle_completion.all_hour1_complete).toBe(false);
  });
});
