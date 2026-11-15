import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModalPanel } from '@medichain/shared';

/**
 * Escape closes the dialog wherever focus is. The specimen detail did not:
 * its Reject button was replaced by the result, focus fell to <body>, and a
 * listener on the panel never heard the key.
 */
describe('ModalPanel', () => {
  it('closes on Escape when focus has fallen out of the panel', () => {
    const onClose = vi.fn();
    render(
      <ModalPanel label="Specimen" onClose={onClose}>
        <button type="button">Reject</button>
      </ModalPanel>
    );
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes only the topmost of two open dialogs', () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(
      <>
        <ModalPanel label="Form" onClose={closeOuter}>
          <button type="button">Save</button>
        </ModalPanel>
        <ModalPanel label="Confirm" alert onClose={closeInner}>
          <button type="button">OK</button>
        </ModalPanel>
      </>
    );

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });
});
