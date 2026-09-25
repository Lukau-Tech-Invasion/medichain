import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { confirmDialog, promptDialog, DialogHost } from '@medichain/shared';

/**
 * The shared confirm/prompt dialog that replaced `window.confirm` and
 * `window.prompt`. Rendered through the app's own host, as in production.
 */
describe('in-app dialog', () => {
  it('resolves a prompt with what was typed, and focuses the field', async () => {
    render(<DialogHost />);
    const answer = promptDialog({ message: 'Quantity to dispense', inputType: 'number' });

    const input = await screen.findByRole('spinbutton', { name: 'Quantity to dispense' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await expect(answer).resolves.toBe('21');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('will not submit a required prompt left blank', async () => {
    render(<DialogHost />);
    void promptDialog({ message: 'Reason', required: true });

    const ok = await screen.findByRole('button', { name: 'OK' });
    expect(ok).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: '   ' } });
    expect(ok).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('treats Escape as cancel: null for a prompt, false for a confirm', async () => {
    render(<DialogHost />);
    const prompted = promptDialog('Reason');
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await expect(prompted).resolves.toBeNull();

    const confirmed = confirmDialog({ message: 'Retire this rule?', destructive: true });
    fireEvent.keyDown(await screen.findByRole('alertdialog'), { key: 'Escape' });
    await expect(confirmed).resolves.toBe(false);
  });

  it('puts focus on Cancel for a destructive confirmation', async () => {
    render(<DialogHost />);
    const confirmed = confirmDialog({ message: 'Remove this member?', destructive: true });

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(confirmed).resolves.toBe(true);
  });

  it('shows one dialog at a time, in the order they were asked', async () => {
    render(<DialogHost />);
    const first = confirmDialog('First?');
    const second = confirmDialog('Second?');

    expect(await screen.findByText('First?')).toBeInTheDocument();
    expect(screen.queryByText('Second?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(first).resolves.toBe(true);

    expect(await screen.findByText('Second?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(second).resolves.toBe(false);
  });
});
