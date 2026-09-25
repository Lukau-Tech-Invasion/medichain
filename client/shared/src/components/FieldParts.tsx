import { AlertCircle } from 'lucide-react';

/**
 * The label, error and helper text of a form control.
 *
 * Split out so `Input`, `Select` and `Textarea` render an identical field
 * chrome instead of three near-copies that drift.
 */

export function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-content-secondary mb-1">
      {children}
      {/*
        A visible marker as well as the `required` attribute. The attribute
        alone is invisible to a sighted user until they submit and are rejected,
        which is the error this is meant to prevent (WCAG 3.3.2 Labels or
        Instructions: say the rule before the failure, not after).

        The asterisk is aria-hidden because `aria-required` on the control
        already carries this to assistive technology; announcing "star" as well
        is noise.
      */}
      {required && (
        <>
          <span aria-hidden="true" className="text-critical-subtle-fg ml-0.5">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      )}
    </label>
  );
}

export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    /*
      `role="alert"` so the message is announced when it appears — an error
      rendered after submit is otherwise never spoken.

      The icon is not decoration. WCAG 1.4.1 forbids colour as the only carrier
      of meaning: a red border and red text are invisible as *errors* to a
      reader with deuteranopia, in greyscale, or on a dimmed screen. The icon
      plus the text give two further channels.
    */
    <p
      id={id}
      role="alert"
      className="mt-1 text-sm text-critical-subtle-fg flex items-start gap-1.5"
    >
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function FieldHelp({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1 text-sm text-content-muted">
      {children}
    </p>
  );
}
