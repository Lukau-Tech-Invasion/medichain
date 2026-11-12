import { describe, expect, it } from 'vitest';
import {
  emptyPathologyOrder, emptyPathologyReport, finalizeBlocker, pathologyOrderReducer,
  pathologyReportReducer, toPathologyOrder, toPathologyReportUpdate,
  type PathologyReportAction, type PathologyReportForm, type PathologySpecimen,
} from './PathologyPage.form';

const report = (form: PathologyReportForm, ...actions: PathologyReportAction[]) =>
  actions.reduce(pathologyReportReducer, form);

describe('pathologyOrderReducer', () => {
  it('sets one field without mutating the previous order', () => {
    const before = emptyPathologyOrder();
    const next = pathologyOrderReducer(before, { type: 'set', field: 'site', value: 'Left breast' });
    expect(next.site).toBe('Left breast');
    expect(before.site).toBe('');
  });

  it('reset clears the order but keeps the specimen type', () => {
    let order = emptyPathologyOrder();
    order = pathologyOrderReducer(order, { type: 'set', field: 'specimenType', value: 'biopsy' });
    order = pathologyOrderReducer(order, { type: 'set', field: 'site', value: 'Liver' });
    order = pathologyOrderReducer(order, { type: 'set', field: 'priority', value: 'stat' });
    expect(pathologyOrderReducer(order, { type: 'reset' }))
      .toEqual({ ...emptyPathologyOrder(), specimenType: 'biopsy' });
  });
});

describe('toPathologyOrder', () => {
  it('submits exactly the specimen the page used to assemble by hand', () => {
    const order = {
      ...emptyPathologyOrder(),
      selectedPatientId: 'PAT-1', collectionDate: '2026-11-12', collectionTime: '09:30',
      clinician: 'Dr A', site: 'Left breast', laterality: 'left' as const,
      clinicalHistory: 'Lump', clinicalDiagnosis: 'Query carcinoma', container: 'Pot A',
    };
    const receipt = { specimenId: 'S24-004', patientName: 'Jane Doe', receivedDate: '2026-11-12', receivedBy: 'lab-1' };
    expect(toPathologyOrder(order, receipt)).toEqual({
      specimenId: 'S24-004', patientId: 'PAT-1', patientName: 'Jane Doe',
      collectionDate: '2026-11-12', collectionTime: '09:30', clinician: 'Dr A',
      specimenType: 'surgical', site: 'Left breast', laterality: 'left',
      clinicalHistory: 'Lump', clinicalDiagnosis: 'Query carcinoma', priority: 'routine',
      status: 'received', receivedDate: '2026-11-12', receivedBy: 'lab-1',
      container: 'Pot A', fixative: '10% formalin',
    });
  });

  it('does not send the form-only name of the patient id', () => {
    const receipt = { specimenId: 'S', patientName: 'N', receivedDate: 'D', receivedBy: 'B' };
    expect(toPathologyOrder(emptyPathologyOrder(), receipt)).not.toHaveProperty('selectedPatientId');
  });
});

describe('pathologyReportReducer', () => {
  it('adds a trimmed block and clears the box; a blank box adds nothing', () => {
    let form = report(emptyPathologyReport(),
      { type: 'set', field: 'newBlock', value: '  A1 ' }, { type: 'addBlock' });
    expect(form.blocks).toEqual(['A1']);
    expect(form.newBlock).toBe('');
    form = report(form, { type: 'set', field: 'newBlock', value: '   ' }, { type: 'addBlock' });
    expect(form.blocks).toEqual(['A1']);
  });

  it('adds slides the same way, independently of blocks', () => {
    const form = report(emptyPathologyReport(),
      { type: 'set', field: 'newSlide', value: 'A1-1' }, { type: 'addSlide' });
    expect(form.slides).toEqual(['A1-1']);
    expect(form.blocks).toEqual([]);
  });

  it('toggles a stain and a marker on and off', () => {
    let form = report(emptyPathologyReport(),
      { type: 'toggleStain', stain: 'PAS' }, { type: 'toggleMarker', marker: 'ER' });
    expect(form.specialStains).toEqual(['PAS']);
    expect(form.ihcMarkers).toEqual(['ER']);
    form = report(form, { type: 'toggleStain', stain: 'PAS' });
    expect(form.specialStains).toEqual([]);
    expect(form.ihcMarkers).toEqual(['ER']);
  });

  it('opening a specimen loads its report and replaces the previous one', () => {
    const specimen = {
      grossDescription: 'Tan nodule', blocks: ['A1'], diagnosis: 'Benign', isCritical: true,
    } as PathologySpecimen;
    const previous = report(emptyPathologyReport(),
      { type: 'set', field: 'snomedCode', value: '12345' }, { type: 'toggleStain', stain: 'PAS' });
    expect(report(previous, { type: 'open', specimen })).toEqual({
      ...emptyPathologyReport(),
      grossDescription: 'Tan nodule', blocks: ['A1'], diagnosis: 'Benign', isCritical: true,
    });
  });
});

describe('finalizeBlocker', () => {
  const complete = { ...emptyPathologyReport(), diagnosis: 'Benign', microscopicDescription: 'Normal ducts' };

  it('needs a diagnosis and a microscopic description', () => {
    expect(finalizeBlocker(emptyPathologyReport())).toBe('missingFields');
    expect(finalizeBlocker({ ...complete, microscopicDescription: '' })).toBe('missingFields');
    expect(finalizeBlocker(complete)).toBeNull();
  });

  it('a critical result must say who was told', () => {
    expect(finalizeBlocker({ ...complete, isCritical: true })).toBe('criticalNotCommunicated');
    expect(finalizeBlocker({ ...complete, isCritical: true, communicatedTo: 'Dr A' })).toBeNull();
  });
});

describe('toPathologyReportUpdate', () => {
  it('saves exactly the report the page used to assemble by hand', () => {
    const form: PathologyReportForm = {
      grossDescription: 'Tan nodule', blocks: ['A1'], newBlock: 'typed, not added', slides: ['A1-1'], newSlide: '',
      specialStains: ['PAS'], ihcMarkers: ['ER'], microscopicDescription: 'Normal ducts',
      diagnosis: 'Benign', snomedCode: '12345', isCritical: true, communicatedTo: 'Dr A',
    };
    expect(toPathologyReportUpdate(form, false)).toEqual({
      gross_description: 'Tan nodule', microscopic_description: 'Normal ducts', diagnosis: 'Benign',
      blocks: ['A1'], slides: ['A1-1'], special_stains: ['PAS'], ihc_markers: ['ER'],
      snomed_code: '12345', is_critical: true, communicated_to: 'Dr A', status: 'prelim',
    });
  });

  it('is final only when it is being signed out', () => {
    expect(toPathologyReportUpdate(emptyPathologyReport(), true).status).toBe('final');
  });
});
