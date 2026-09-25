/**
 * Form controls.
 *
 * All three share `useFieldA11y` for id generation and ARIA wiring, and
 * `FieldLabel`/`FieldError`/`FieldHelp` for the surrounding chrome. See
 * `field.ts` for the three defects that shared wiring exists to prevent —
 * chiefly that ids used to be derived from label text, so two fields with the
 * same label collided and the label focused the wrong control.
 */

import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { useFieldA11y, fieldBorderClass, FIELD_BASE_CLASS } from './field';
import { FieldLabel, FieldError, FieldHelp } from './FieldParts';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, leftIcon, rightIcon, className, id, required, ...props }, ref) => {
    const field = useFieldA11y({ id, error, helperText, required });

    return (
      <div className="w-full">
        {label && (
          <FieldLabel htmlFor={field.controlId} required={required}>
            {label}
          </FieldLabel>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            required={required}
            className={clsx(
              FIELD_BASE_CLASS,
              fieldBorderClass(Boolean(error)),
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              className
            )}
            {...field.controlProps}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none">
              {rightIcon}
            </div>
          )}
        </div>
        {error && field.errorId && <FieldError id={field.errorId}>{error}</FieldError>}
        {helperText && !error && field.helperId && (
          <FieldHelp id={field.helperId}>{helperText}</FieldHelp>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, options, className, id, required, ...props }, ref) => {
    const field = useFieldA11y({ id, error, helperText, required });

    return (
      <div className="w-full">
        {label && (
          <FieldLabel htmlFor={field.controlId} required={required}>
            {label}
          </FieldLabel>
        )}
        <select
          ref={ref}
          required={required}
          className={clsx(FIELD_BASE_CLASS, 'appearance-none', fieldBorderClass(Boolean(error)), className)}
          {...field.controlProps}
          {...props}
        >
          {options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && field.errorId && <FieldError id={field.errorId}>{error}</FieldError>}
        {helperText && !error && field.helperId && (
          <FieldHelp id={field.helperId}>{helperText}</FieldHelp>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, rows = 3, className, id, required, ...props }, ref) => {
    const field = useFieldA11y({ id, error, helperText, required });

    return (
      <div className="w-full">
        {label && (
          <FieldLabel htmlFor={field.controlId} required={required}>
            {label}
          </FieldLabel>
        )}
        <textarea
          ref={ref}
          rows={rows}
          required={required}
          className={clsx(FIELD_BASE_CLASS, 'resize-none', fieldBorderClass(Boolean(error)), className)}
          {...field.controlProps}
          {...props}
        />
        {error && field.errorId && <FieldError id={field.errorId}>{error}</FieldError>}
        {helperText && !error && field.helperId && (
          <FieldHelp id={field.helperId}>{helperText}</FieldHelp>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
