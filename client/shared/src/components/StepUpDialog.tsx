import { useState } from 'react';
import { useTranslation } from '../i18n/react';
import type { StepUpState } from '../hooks/useStepUp';

/**
 * Ask for a TOTP code so a refused privileged action can go through.
 *
 * Rendered by any page whose action can be met with `403 MFA_REQUIRED`. See
 * `useStepUp` for why this exists: the server names the remedy in its error
 * message, and until this dialog there was nothing a person could do with it.
 *
 * Two distinct demands, because they have different remedies:
 *   * `step_up` — enrolled, but this session is not freshly verified. A code
 *     fixes it here.
 *   * `enrollment` — no MFA at all. A code cannot fix that; the person has to
 *     enrol first, and saying "enter your code" to someone with no
 *     authenticator is a dead end dressed as a prompt.
 */
export function StepUpDialog({ state }: { state: StepUpState }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');

  if (!state.demand) return null;

  const enrolling = state.demand === 'enrollment';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-up-title"
    >
      <div className="bg-surface rounded-xl shadow-lg p-6 w-full max-w-sm">
        <h2 id="step-up-title" className="font-semibold text-content mb-1">
          {t('stepUp.title')}
        </h2>
        <p className="text-sm text-content-muted mb-4">
          {enrolling ? t('stepUp.enrollBody') : t('stepUp.body')}
        </p>

        {state.error && (
          <div role="alert" className="mb-4 bg-critical-subtle border border-critical rounded-lg p-3">
            <p className="text-sm text-critical-subtle-fg">{state.error}</p>
          </div>
        )}

        {!enrolling && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void state.submitCode(code.trim());
            }}
          >
            <label htmlFor="step-up-code" className="block text-sm font-medium text-content-secondary mb-1">
              {t('stepUp.codeLabel')}
            </label>
            <input
              id="step-up-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content min-h-[44px] mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={state.cancel}
                className="px-4 py-2 rounded-lg border border-border-interactive text-content-secondary min-h-[44px]"
              >
                {t('stepUp.cancel')}
              </button>
              <button
                type="submit"
                disabled={state.verifying}
                className="px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[44px]"
              >
                {state.verifying ? t('stepUp.verifying') : t('stepUp.confirm')}
              </button>
            </div>
          </form>
        )}

        {enrolling && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={state.cancel}
              className="px-4 py-2 rounded-lg border border-border-interactive text-content-secondary min-h-[44px]"
            >
              {t('stepUp.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default StepUpDialog;
