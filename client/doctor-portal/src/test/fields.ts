import { fireEvent, screen } from '@testing-library/react';

/**
 * Set a form field the way a user would, whichever control it is now.
 *
 * Short option lists moved from `<select>` to `ChoiceChips` (a radio group in
 * a fieldset named by its legend). A test that names the field keeps working:
 * a group is answered by pressing its chip, anything else by typing. An empty
 * value on a group clears it, as pressing the chosen chip again does.
 */
export function fillField(name: string | RegExp, value: string): void {
  const group = screen.queryByRole('group', { name });
  if (group) {
    const checked = group.querySelector<HTMLInputElement>('input:checked');
    if (value === '') {
      if (checked) fireEvent.click(checked);
      return;
    }
    const chip = Array.from(group.querySelectorAll<HTMLInputElement>('input')).find((input) => input.value === value);
    if (!chip) throw new Error(`no "${value}" chip in group ${String(name)}`);
    if (!chip.checked) fireEvent.click(chip);
    return;
  }
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
}

/** The current value of a field by its name: the chosen chip, or the control's value. */
export function fieldValue(name: string | RegExp): string {
  const group = screen.queryByRole('group', { name });
  if (group) return group.querySelector<HTMLInputElement>('input:checked')?.value ?? '';
  return (screen.getByLabelText(name) as HTMLInputElement).value;
}
