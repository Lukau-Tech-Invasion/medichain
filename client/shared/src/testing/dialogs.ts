/**
 * Answer the in-app dialog (`confirmDialog` / `promptDialog`) from a test.
 *
 * These replace `vi.spyOn(window, 'prompt')`. Stubbing the global proved only
 * that a page called it -- and a page calling it was the defect: a suppressed
 * native prompt returns `null`, which every handler read as "cancelled", so
 * the control did nothing. Driving the real dialog proves a person can answer
 * it.
 */
import { fireEvent, waitFor, within } from '@testing-library/react';

async function openDialog(): Promise<HTMLElement> {
  // Either role: a destructive confirmation is an `alertdialog`.
  return waitFor(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    if (!dialog) throw new Error('no dialog is open');
    return dialog;
  });
}

/** Type `answer` into the open prompt and submit it, or cancel with `null`. */
export async function answerPrompt(answer: string | null): Promise<void> {
  const dialog = await openDialog();
  if (answer === null) {
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    return;
  }
  const input = dialog.querySelector('input');
  if (!input) throw new Error('the open dialog is not a prompt: it has no input');
  fireEvent.change(input, { target: { value: answer } });
  const form = dialog.querySelector('form');
  if (!form) throw new Error('the open dialog has no form to submit');
  fireEvent.submit(form);
}

/** Confirm (`true`) or cancel (`false`) the open confirmation dialog. */
export async function answerConfirm(confirmed: boolean): Promise<void> {
  const dialog = await openDialog();
  const buttons = within(dialog).getAllByRole('button');
  const cancel = within(dialog).getByRole('button', { name: /cancel/i });
  const confirm = buttons.find((button) => button !== cancel);
  if (!confirm) throw new Error('the open dialog has no confirm button');
  fireEvent.click(confirmed ? confirm : cancel);
}
