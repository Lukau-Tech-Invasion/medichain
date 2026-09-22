import { useState } from 'react';
import {
  rotateCredentials,
  rotateStaffPassword,
  staffLogin,
  deriveCredential,
  getApiErrorMessage,
  useTranslation,
} from '@medichain/shared';
import { X, Loader2 } from 'lucide-react';

/**
 * Change the password behind an employee identifier.
 *
 * # Why this asks for the current password, and cannot offer a reset
 *
 * The password has two one-way branches: an auth proof the server keeps a
 * verifier for, and a keystore key that opens the clinician's signing key. The
 * server holds the verifier and an opaque blob, so it can check a password and
 * can never open the keystore. That is what stops a stolen database from being
 * able to sign as a doctor.
 *
 * The same property means only this browser can re-encrypt the keystore. So
 * the change happens here: fetch the current keystore, open it with the old
 * password, reseal it under the new one, and send the server proof of the old
 * password beside the new verifier and blob.
 *
 * A clinician who has forgotten their password cannot use this, and is
 * re-enrolled by an administrator against a fresh keypair. There is no reset,
 * because a server able to reset would be a server able to forge.
 */
export default function ChangePasswordDialog({
  loginId,
  onClose,
}: {
  /** The clinician's employee identifier; it is part of the key derivation. */
  loginId: string;
  onClose: () => void;
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
    if (next.length < 12) {
      // Long rather than complex: this password is the only thing standing
      // between an attacker and a key that signs clinical records, and it is
      // typed once a shift rather than constantly.
      setError(t('docSettings.pwTooShort'));
      return;
    }
    if (next !== confirm) {
      setError(t('docSettings.pwMismatch'));
      return;
    }

    setBusy(true);
    try {
      // The keystore is not kept after sign-in — the session holds an opened
      // signer, not the encrypted blob — so fetch the current one. This also
      // re-verifies the current password server-side before anything changes.
      const derived = await deriveCredential(current, identifier.trim());
      const session = await staffLogin({
        identifier: identifier.trim(),
        auth_proof: derived.authProof,
      });

      const body = await rotateStaffPassword(
        identifier.trim(),
        current,
        next,
        session.encrypted_keystore
      );
      await rotateCredentials(body);
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, t('docSettings.pwFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-content">
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
                {t('docSettings.pwIdentifier')}
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
                {t('docSettings.pwHint')}
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
              {t('docSettings.pwNoReset')}
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
      </div>
    </div>
  );
}
