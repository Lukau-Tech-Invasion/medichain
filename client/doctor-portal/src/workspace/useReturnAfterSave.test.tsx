import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PatientWorkspaceContext } from './PatientWorkspaceContext';
import { useReturnAfterSave } from './useReturnAfterSave';

function Form() {
  const done = useReturnAfterSave();
  return <button type="button" onClick={done}>Save</button>;
}

function Where() {
  const location = useLocation();
  return <output data-testid="at">{location.pathname}|{JSON.stringify(location.state)}</output>;
}

function app(form: JSX.Element, entry: { pathname: string; state?: unknown }) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<>{form}<Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return screen.getByTestId('at').textContent;
}

describe('useReturnAfterSave', () => {
  it("returns to the open patient's chart, keeping the workspace's own state", () => {
    const at = app(
      <PatientWorkspaceContext.Provider value={{ patientId: 'PAT-1', patient: null }}><Form /></PatientWorkspaceContext.Provider>,
      { pathname: '/patients/PAT-1/burn', state: { from: { pathname: '/ems-incoming' } } },
    );
    expect(at).toBe('/patients/PAT-1|{"from":{"pathname":"/ems-incoming"}}');
  });

  it('outside a workspace returns to where the form was opened from', () => {
    expect(app(<Form />, { pathname: '/burn', state: { from: { pathname: '/nursing' } } })).toBe('/nursing|null');
  });

  it('falls back to the dashboard', () => {
    expect(app(<Form />, { pathname: '/burn' })).toBe('/dashboard|null');
  });
});
