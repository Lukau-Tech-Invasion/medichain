import { useState } from 'react';
import { changePassword } from '../api/endpoints';
import { getApiErrorMessage } from '../api/client';
import { deriveAuthProof } from '../auth/proof';
import { MIN_PASSWORD_LENGTH } from '../auth/session';
import { rememberLoginId } from '../auth/loginId';
import { useTranslation } from '../i18n/react';
import { ModalPanel } from './ModalPanel';
import { X, Loader2 } from 'lucide-react';

/**
 * Change the password behind a login id (Employee ID for staff, username for
 * patients). Used by both portals.
 *
 * # What travels
 *
 * The current password is stretched locally into a proof (`deriveAuthProof`)
 * and only the proof is sent. The new password is sent once, to
 * `POST /api/auth/credentials/change`, so the server can refuse a weak one; it
 * derives the new proof itself, stores Argon2id over it, and ends every other
 * session.
 *
 * # Forgotten passwords
 *
 * This needs the CURRENT password. Someone who has forgotten theirs asks for a
 * credential reset: a one-time code they redeem at /activate.
 */
export function ChangePasswordDialog({
  loginId,
  onClose,
  identifierLabel,
  forgottenHint,
}: {
  /** The login id; it is part of the proof derivation. */
  loginId: string;
  onClose: () => void;
  /** Label for the login-id field; defaults to the staff wording. */
  identifierLabel?: string;
  /** What to do after forgetting the password; defaults to the staff wording. */
  forgottenHint?: string;
}) {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState(loginId);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!identifier.trim()) {
      setError(t('docSettings.pwIdentifierRequired'));
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      // Long rather than complex: this password is typed once a shift rather
      // than constantly, and length is what resists guessing.
      setError(t('docSettings.pwTooShort', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (next !== confirm) {
      setError(t('docSettings.pwMismatch'));
      return;
    }
    if (next === current) {
      setError(t('docSettings.pwSame'));
      return;
    }

    setBusy(true);
    try {
      const id = identifier.trim();
      // The current password is proved; the new one is sent for the server's
      // strength check, whose refusal reason getApiErrorMessage shows.
      const currentProof = await deriveAuthProof(current, id);
      await changePassword({ current_auth_proof: currentProof, new_password: next });
      rememberLoginId(id);
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, t('docSettings.pwFailed')));
    } finally {
      setBusy(false);
      setCurrent('');
      setNext('');
      setConfirm('');
    }
  };

  return (
    <ModalPanel labelledBy="change-password-dialog-title" closeOnBackdrop={false} onClose={onClose} overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" className="bg-surface rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 id="change-password-dialog-title" className="text-lg font-semibold text-content">
            {t('docSettings.changePassword')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1 rounded hover:bg-surface-sunken"
          >
            <X size={18} className="text-content-muted" />
          </button>
        </div>

        {done ? (
          <div className="p-6 space-y-4">
            <p className="text-content">{t('docSettings.pwChanged')}</p>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2 bg-brand text-brand-fg rounded-lg"
            >
              {t('common.close')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6 space-y-4">
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-critical-subtle-fg/20 bg-critical-subtle p-3 text-sm text-critical-subtle-fg"
              >
                {error}
              </p>
            )}

            <div>
              <label
                htmlFor="pw-identifier"
                className="block text-sm font-medium text-content-secondary mb-1"
              >
                {identifierLabel ?? t('docSettings.pwIdentifier')}
              </label>
              <input
                id="pw-identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content"
              />
            </div>

            <div>
              <label
                htmlFor="pw-current"
                className="block text-sm font-medium text-content-secondary mb-1"
              >
                {t('docSettings.pwCurrent')}
              </label>
              <input
                id="pw-current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content"
              />
            </div>

            <div>
              <label
                htmlFor="pw-new"
                className="block text-sm font-medium text-content-secondary mb-1"
              >
                {t('docSettings.pwNew')}
              </label>
              <input
                id="pw-new"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content"
              />
              <p className="mt-1 text-xs text-content-muted">
                {t('docSettings.pwHint', { min: MIN_PASSWORD_LENGTH })}
              </p>
            </div>

            <div>
              <label
                htmlFor="pw-confirm"
                className="block text-sm font-medium text-content-secondary mb-1"
              >
                {t('docSettings.pwConfirm')}
              </label>
              <input
                id="pw-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content"
              />
            </div>

            <p className="text-xs text-content-muted">
              {forgottenHint ?? t('docSettings.pwNoReset')}
            </p>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-border rounded-lg text-content"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:bg-disabled disabled:text-disabled-fg flex items-center justify-center gap-2"
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                {t('docSettings.pwSubmit')}
              </button>
            </div>
          </form>
        )}
      </ModalPanel>
  );
}
