import { afterEach, describe, expect, it, vi } from 'vitest';
import { crewBody, readCrewDetails, saveCrewDetails } from './crewDetails';

describe('crew details', () => {
  afterEach(() => {
    vi.mocked(localStorage.getItem).mockReset();
    vi.mocked(localStorage.setItem).mockReset();
  });

  it('sends nothing for blank fields', () => {
    expect(crewBody({ unit: '  ', crew: ' , ' })).toEqual({});
  });

  it('sends the unit and each named crew member', () => {
    expect(crewBody({ unit: ' 14 ', crew: 'P. Mokoena, , T. Dube ' })).toEqual({ unit_number: '14', crew: ['P. Mokoena', 'T. Dube'] });
  });

  it('keeps at most ten names, as the server accepts', () => {
    const names = Array.from({ length: 12 }, (_, i) => `M${i}`).join(',');
    expect(crewBody({ unit: '', crew: names }).crew).toHaveLength(10);
  });

  it('remembers what this crew member entered, per account', () => {
    const store = new Map<string, string>();
    vi.mocked(localStorage.setItem).mockImplementation((k, v) => { store.set(k, v); });
    vi.mocked(localStorage.getItem).mockImplementation((k) => store.get(k) ?? null);
    saveCrewDetails('U1', { unit: '14', crew: 'P. Mokoena' });
    expect(readCrewDetails('U1')).toEqual({ unit: '14', crew: 'P. Mokoena' });
    expect(readCrewDetails('U2')).toEqual({ unit: '', crew: '' });
  });

  it('starts empty when storage is unreadable', () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('blocked'); });
    expect(readCrewDetails('U1')).toEqual({ unit: '', crew: '' });
  });
});
