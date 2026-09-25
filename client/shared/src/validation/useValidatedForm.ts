import { useCallback, useState } from 'react';
import type { z } from 'zod';

/**
 * Bind a zod schema to form state and per-field error messages.
 *
 * Deliberately small: it validates and reports, and owns nothing else. A full
 * form library would also own registration, refs and submission, which would
 * mean rewriting every existing form to adopt any validation at all. This drops
 * into a form that already manages its own state.
 *
 * The output shape is the `error` prop `Input`/`Select`/`Textarea` already
 * take, so wiring a field is `error={errors.systolic}` and nothing else — the
 * ARIA association, the announcement and the icon come free from those
 * components.
 */
export interface ValidatedForm<T> {
  /** Field errors, keyed by field name. Empty when valid. */
  errors: Partial<Record<keyof T & string, string>>;
  /** Validate everything. Returns parsed data, or null when invalid. */
  validate: (values: unknown) => T | null;
  /** Validate one field, typically on blur. */
  validateField: (field: keyof T & string, values: unknown) => void;
  /** Clear one field's error, typically on change. */
  clearField: (field: keyof T & string) => void;
  /** Drop every error. */
  reset: () => void;
  /** True when any field currently has an error. */
  hasErrors: boolean;
}

export function useValidatedForm<T>(schema: z.ZodType<T>): ValidatedForm<T> {
  const [errors, setErrors] = useState<Partial<Record<keyof T & string, string>>>({});

  const collect = useCallback((issues: z.ZodIssue[]) => {
    const next: Partial<Record<keyof T & string, string>> = {};
    for (const issue of issues) {
      // First issue per field wins. Stacking three messages under one input is
      // noise; the user fixes one thing at a time and revalidation surfaces the
      // next.
      const key = issue.path[0] as keyof T & string | undefined;
      if (key !== undefined && next[key] === undefined) {
        next[key] = issue.message;
      }
    }
    return next;
  }, []);

  const validate = useCallback(
    (values: unknown): T | null => {
      const result = schema.safeParse(values);
      if (result.success) {
        setErrors({});
        return result.data;
      }
      setErrors(collect(result.error.issues));
      return null;
    },
    [schema, collect]
  );

  const validateField = useCallback(
    (field: keyof T & string, values: unknown) => {
      const result = schema.safeParse(values);
      // Only this field's message is updated. Validating on blur must not
      // suddenly light up every other field the user has not reached yet —
      // that is how a form ends up scolding someone for a mistake they were
      // about to make anyway.
      const message = result.success
        ? undefined
        : collect(result.error.issues)[field];
      setErrors(previous => {
        const next = { ...previous };
        if (message) next[field] = message;
        else delete next[field];
        return next;
      });
    },
    [schema, collect]
  );

  const clearField = useCallback((field: keyof T & string) => {
    setErrors(previous => {
      if (previous[field] === undefined) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }, []);

  const reset = useCallback(() => setErrors({}), []);

  return {
    errors,
    validate,
    validateField,
    clearField,
    reset,
    hasErrors: Object.keys(errors).length > 0,
  };
}
