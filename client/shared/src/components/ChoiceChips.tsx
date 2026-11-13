/**
 * A short fixed list as one-tap chips instead of a dropdown.
 *
 * 143 `<select>` elements here offered 2–6 fixed options: open, scan, pick —
 * three actions where one will do, with the options hidden until opened. Chips
 * show every option and take one tap. They are native radios/checkboxes under
 * the styling, so arrow keys, Space and screen readers work without ARIA
 * reinvention, and the whole chip is the target (≥ 44 px; WCAG 2.5.8 asks 24).
 *
 * Nothing is pre-selected: an unanswered question stays unanswered (rule 9).
 */
import { useId } from 'react';

// ux-allow(no-form): a field component; the page that uses it supplies the <form>.

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
}

interface BaseProps<V extends string> {
  /** Visible group label. */
  label: string;
  options: ReadonlyArray<ChoiceOption<V>>;
  /** Optional hint under the label. */
  hint?: string;
  /** A validation message; also marks the group invalid. */
  error?: string;
  id?: string;
}

const chip =
  'mc-press relative inline-flex min-h-[44px] cursor-pointer select-none items-center rounded-full border px-4 text-sm ' +
  'border-border-strong text-content-secondary hover:bg-surface-sunken ' +
  'has-[:checked]:border-brand has-[:checked]:bg-selected has-[:checked]:font-semibold has-[:checked]:text-selected-fg ' +
  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus';

function Group<V extends string>({ label, hint, error, id, children }: BaseProps<V> & { children: React.ReactNode }) {
  const generated = useId();
  const groupId = id ?? generated;
  return (
    <fieldset
      id={groupId}
      tabIndex={-1}
      aria-invalid={error ? true : undefined}
      aria-describedby={[hint ? `${groupId}-hint` : '', error ? `${groupId}-error` : ''].filter(Boolean).join(' ') || undefined}
      className="min-w-0 focus:outline-none"
    >
      <legend className="mb-2 text-sm font-semibold text-content-secondary">{label}</legend>
      {hint && <p id={`${groupId}-hint`} className="-mt-1 mb-2 text-xs text-content-muted">{hint}</p>}
      <div className="flex flex-wrap gap-2">{children}</div>
      {error && <p id={`${groupId}-error`} className="mt-1 text-sm text-critical-subtle-fg">{error}</p>}
    </fieldset>
  );
}

/** Pick one. Tapping the chosen chip again clears it, so "not answered" stays reachable. */
export function ChoiceChips<V extends string>({ value, onChange, ...base }: BaseProps<V> & {
  value: V | undefined;
  onChange: (value: V | undefined) => void;
}) {
  const name = useId();
  return (
    <Group {...base}>
      {base.options.map((o) => (
        <label key={o.value} className={chip}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            onClick={() => { if (value === o.value) onChange(undefined); }}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </Group>
  );
}

/** Pick any number. */
export function MultiChoiceChips<V extends string>({ values, onChange, ...base }: BaseProps<V> & {
  values: ReadonlyArray<V>;
  onChange: (values: V[]) => void;
}) {
  return (
    <Group {...base}>
      {base.options.map((o) => (
        <label key={o.value} className={chip}>
          <input
            type="checkbox"
            value={o.value}
            checked={values.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...values, o.value] : values.filter((v) => v !== o.value))}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </Group>
  );
}
