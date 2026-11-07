import { act, render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Link } from 'react-router-dom';
import {
  DialogHost, I18nProvider, NavigationGuard, clearAllDrafts, clearUnsavedForms, draftsForPatient,
  unsavedForms, useDraftFields, useUnsavedChanges,
} from '@medichain/shared';

/** A two-field form the way the clinical pages are built: separate useStates. */
function Note({ patientId, onSaved }: { patientId?: string; onSaved?: (markSaved: () => void) => void }) {
  const [subjective, setSubjective] = useState('');
  const [plan, setPlan] = useState('');
  const draft = useDraftFields('note', patientId, 'Note', { subjective: [subjective, setSubjective], plan: [plan, setPlan] });
  return (
    <form>
      <label>Subjective<input value={subjective} onChange={(e) => setSubjective(e.target.value)} /></label>
      <label>Plan<input value={plan} onChange={(e) => setPlan(e.target.value)} /></label>
      <span>{draft.dirty ? 'dirty' : 'clean'}</span>
      <button type="button" onClick={() => onSaved?.(draft.markSaved)}>Save</button>
    </form>
  );
}

describe('useDraftFields', () => {
  beforeEach(() => {
    clearAllDrafts();
    clearUnsavedForms();
  });

  it('is clean until typed in, then keeps a draft that a remount restores', () => {
    const first = render(<Note patientId="PAT-1" />);
    expect(screen.getByText('clean')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Subjective'), { target: { value: 'Chest tightness' } });
    expect(screen.getByText('dirty')).toBeInTheDocument();
    expect(draftsForPatient('PAT-1')).toEqual(['note']);
    expect(unsavedForms()).toEqual(['Note']);
    first.unmount();
    render(<Note patientId="PAT-1" />);
    expect(screen.getByDisplayValue('Chest tightness')).toBeInTheDocument();
  });

  it('restores the draft when the patient arrives after the first render', () => {
    const first = render(<Note patientId="PAT-2" />);
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'Repeat ECG' } });
    first.unmount();
    // Inside the workspace a page learns its patient a render after mounting.
    const view = render(<Note patientId={undefined} />);
    view.rerender(<Note patientId="PAT-2" />);
    expect(screen.getByDisplayValue('Repeat ECG')).toBeInTheDocument();
  });

  it('does not stop a move to another screen for a kept draft, but does for unsaved work without one', async () => {
    function Plain() {
      const [text, setText] = useState('');
      useUnsavedChanges(text !== '', 'Plain form');
      return <label>Plain<input value={text} onChange={(e) => setText(e.target.value)} /></label>;
    }
    const view = render(
      <I18nProvider>
        <MemoryRouter><NavigationGuard /><Note patientId="PAT-4" /><Plain /><Link to="/b">Elsewhere</Link></MemoryRouter>
        <DialogHost />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'Admit' } });
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(draftsForPatient('PAT-4')).toEqual(['note']);

    fireEvent.change(screen.getByLabelText('Plain'), { target: { value: 'typed' } });
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    const ask = await screen.findByRole('alertdialog');
    // Only the work that would be lost is named.
    expect(ask).toHaveTextContent('Plain form');
    expect(ask).not.toHaveTextContent('Note');
    view.unmount();
  });

  it('drops the draft once saved', () => {
    let save: (() => void) | undefined;
    render(<Note patientId="PAT-3" onSaved={(markSaved) => { save = markSaved; }} />);
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'Discharge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    act(() => save?.());
    expect(draftsForPatient('PAT-3')).toEqual([]);
  });
});
