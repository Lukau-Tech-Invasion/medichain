import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RecordModal } from './RecordModal';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

/** Exercise the caller's open and close state through ordinary controls. */
function Example() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open record</button>
    {open && <RecordModal label="Record Details" onClose={() => setOpen(false)}>
      <button onClick={() => setOpen(false)}>Close record</button>
    </RecordModal>}</>;
}

describe('RecordModal', () => {
  it('returns to an explicit trigger when asynchronous loading moved focus elsewhere', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const view = render(<RecordModal label="Preview" onClose={() => {}} returnFocus={trigger}><button>Close preview</button></RecordModal>);
    screen.getByRole('button', { name: 'Close preview' }).focus();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('names the dialog and returns focus after native cancel', () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open record' });
    trigger.focus(); fireEvent.click(trigger);
    fireEvent(screen.getByRole('dialog', { name: 'Record Details' }), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
