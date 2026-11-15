import { useState } from 'react';
import { useTranslation } from '../i18n/react';
import { MIN_PASSWORD_LENGTH, normalizeActivationCode } from '../auth/session';

export interface ActivationValues {
  identifier: string;
  code: string;
  password: string;
  /** Present only when the form asks the person to choose one (patients). */
  username?: string;
}

interface ActivationFormProps {
  /** `patient` also asks for a username to sign in with. */
  audience: 'staff' | 'patient';
  /** Runs the redemption. Resolves true when the person is now signed in. */
  onSubmit: (values: ActivationValues) => Promise<boolean>;
  isLoading: boolean;
  /** A server or store error to show above the form. */
  error?: string | null;
  /** Rendered under the submit button, e.g. a link back to sign-in. */
  footer?: React.ReactNode;
}

const inputClass =
  'w-full px-4 py-3 border border-border-interactive rounded-lg bg-surface text-content focus:ring-2 focus:ring-primary-500 focus:border-brand';
const labelClass = 'block text-sm font-medium text-content-secondary mb-2';

/**
 * Turn a one-time code into a password.
 *
 * Shared by the staff and patient activation pages so the checks that guard a
 * new password (length, confirmation) and the code's formatting live once. The
 * password is stretched in the browser and only its proof is sent; nobody at the
 * clinic, and no server log, ever sees it.
 */
export function ActivationForm({ audience, onSubmit, isLoading, error, footer }: ActivationFormProps) {
  const { t } = useTranslation();
  const isPatient = audience === 'patient';
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isLoading) return;
    setLocalError('');
    // The button is never greyed out to say "not yet": it names what is missing.
    const missing = [
      !identifier.trim() && (isPatient ? t('activate.patientIdLabel') : t('activate.employeeIdLabel')),
      !code.trim() && t('activate.codeLabel'),
      isPatient && !username.trim() && t('activate.usernameLabel'),
      !password && t('activate.passwordLabel'),
      !confirm && t('activate.confirmLabel'),
    ].filter(Boolean);
    if (missing.length > 0) {
      setLocalError(t('activate.errMissing', { fields: missing.join(', ') }));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(t('activate.errPasswordShort', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setLocalError(t('activate.errPasswordMismatch'));
      return;
    }
    await onSubmit({
      identifier: identifier.trim(),
      code: normalizeActivationCode(code),
      password,
      ...(isPatient ? { username: username.trim() } : {}),
    });
    // Never leave the password in component state behind a failure message.
    setPassword('');
    setConfirm('');
  };

  const shownError = localError || error;

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {shownError && (
        <div role="alert" className="bg-critical-subtle border border-critical rounded-lg p-3">
          <p className="text-sm text-critical-subtle-fg">{shownError}</p>
        </div>
      )}

      <div>
        <label htmlFor="activate-identifier" className={labelClass}>
          {isPatient ? t('activate.patientIdLabel') : t('activate.employeeIdLabel')}
        </label>
        <input
          id="activate-identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className={inputClass}
          disabled={isLoading}
          required
        />
        <p className="mt-1 text-xs text-content-muted">
          {isPatient ? t('activate.patientIdHint') : t('activate.employeeIdHint')}
        </p>
      </div>

      <div>
        <label htmlFor="activate-code" className={labelClass}>
          {t('activate.codeLabel')}
        </label>
        <input
          id="activate-code"
          name="code"
          type="text"
          autoComplete="one-time-code"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(normalizeActivationCode(e.target.value))}
          placeholder="XXXX-XXXX-XXXX"
          className={`${inputClass} font-mono tracking-wider`}
          disabled={isLoading}
          required
        />
      </div>

      {isPatient && (
        <div>
          <label htmlFor="activate-username" className={labelClass}>
            {t('activate.usernameLabel')}
          </label>
          <input
            id="activate-username"
            name="new-username"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
            disabled={isLoading}
            required
          />
          <p className="mt-1 text-xs text-content-muted">{t('activate.usernameHint')}</p>
        </div>
      )}

      <div>
        <label htmlFor="activate-password" className={labelClass}>
          {t('activate.passwordLabel')}
        </label>
        <input
          id="activate-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          disabled={isLoading}
          required
        />
        <p className="mt-1 text-xs text-content-muted">
          {t('activate.passwordHint', { min: MIN_PASSWORD_LENGTH })}
        </p>
      </div>

      <div>
        <label htmlFor="activate-confirm" className={labelClass}>
          {t('activate.confirmLabel')}
        </label>
        <input
          id="activate-confirm"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
          disabled={isLoading}
          required
        />
      </div>

      <button
        type="submit"
        aria-disabled={isLoading || undefined}
        className="w-full py-3 bg-brand text-brand-fg font-semibold rounded-lg aria-disabled:cursor-wait min-h-[44px]"
      >
        {isLoading ? t('activate.activating') : t('activate.submit')}
      </button>

      {footer}
    </form>
  );
}

export default ActivationForm;
