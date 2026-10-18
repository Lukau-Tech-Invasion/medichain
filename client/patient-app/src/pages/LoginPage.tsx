import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation, LanguageSwitcher, returnPathFrom } from '@medichain/shared';
import { Heart, Shield, User, KeyRound } from 'lucide-react';
import { usePatientAuthStore } from '../store/authStore';

/*
 * There are no hardcoded demo patients on this page. A patient authenticates
 * with a username and password they chose themselves when they redeemed the
 * activation code from registration (see `ActivatePage`); there is no shortcut
 * past that which is not a bypass. `scripts/check-quick-login-identities.py`
 * fails the build if a hardcoded identity list reappears on a sign-in path.
 */

/**
 * Patient Login Page
 *
 * Username and password sign-in for patients to access their medical records.
 * A patient with an authenticator app is asked for its code after the
 * password; a patient who has not activated yet follows the activation link.
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function LoginPage() {
  const navigate = useNavigate();
  // The page a protected route was asked for before sign-in, or the dashboard.
  const destination = returnPathFrom(useLocation().state);
  const { t } = useTranslation();
  const { login, isAuthenticated, isLoading, error, mfaRequired, clearError } = usePatientAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [localError, setLocalError] = useState('');

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate(destination, { replace: true });
    }
  }, [isAuthenticated, navigate, destination]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError('');

    if (!username.trim() || !password) {
      setLocalError(t('auth.errEnterCredentials'));
      return;
    }
    if (mfaRequired && !totpCode.trim()) {
      setLocalError(t('auth.errEnterCode'));
      return;
    }

    const result = await login(username.trim(), password, mfaRequired ? totpCode.trim() : undefined);
    setTotpCode('');
    // Keep the password only while the account waits for its code (the second
    // submit needs it again); a failed password is retyped, never left in state.
    if (result !== 'mfa_required') setPassword('');
    if (result === true) {
      navigate(destination, { replace: true });
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-subtle via-app-bg to-app-bg flex flex-col">
      {/* Header */}
      <header className="p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary-500 rounded-xl flex items-center justify-center">
              <Heart className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-semibold text-content-secondary">MediChain</span>
          </div>
          <LanguageSwitcher className="text-sm border border-border rounded-lg px-2 py-1 bg-surface" />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Welcome text */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-content mb-2">
              {t('auth.welcomeTitle')}
            </h1>
            {/* Secondary, not muted: this sits on the brand-tinted gradient,
                where muted text measured 4.08:1 in dark mode. */}
            <p className="text-content-secondary">
              {t('auth.welcomeSubtitle')}
            </p>
          </div>

          {/* Login card */}
          <div className="bg-surface rounded-2xl shadow-card p-8">
            <form onSubmit={handleLogin} className="space-y-6">
              {/* Error message */}
              {displayError && (
                <div role="alert" className="bg-critical-subtle border border-critical-subtle-fg/20 text-critical-subtle-fg px-4 py-3 rounded-xl text-sm animate-fade-in">
                  {displayError}
                </div>
              )}

              {/* Username */}
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-content-secondary mb-2">
                  {t('auth.usernameLabel')}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-content-muted" />
                  </div>
                  <input
                    type="text"
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="block w-full pl-12 pr-4 py-3 border border-border-interactive rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-brand transition-colors text-sm"
                    disabled={isLoading}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-content-secondary mb-2">
                  {t('auth.passwordLabel')}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <KeyRound className="h-5 w-5 text-content-muted" />
                  </div>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-12 pr-4 py-3 border border-border-interactive rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-brand transition-colors text-sm"
                    disabled={isLoading}
                  />
                </div>
                <p className="mt-1 text-xs text-content-muted">{t('auth.forgotPasswordHint')}</p>
              </div>

              {/* Authenticator code, once the account has asked for it */}
              {mfaRequired && (
                <div>
                  <label htmlFor="totp-code" className="block text-sm font-medium text-content-secondary mb-2">
                    {t('auth.totpLabel')}
                  </label>
                  <input
                    type="text"
                    id="totp-code"
                    name="totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    className="block w-full px-4 py-3 border border-border-interactive rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-brand transition-colors text-sm"
                    disabled={isLoading}
                  />
                  <p className="mt-1 text-xs text-content-muted">{t('auth.totpHint')}</p>
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-primary-500 text-brand-fg py-3 px-4 rounded-xl font-medium hover:bg-brand focus:ring-4 focus:ring-primary-200 transition-all disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {t('auth.connecting')}
                  </>
                ) : (
                  t('auth.signIn')
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-surface text-content-muted">{t('common.or')}</span>
              </div>
            </div>

            {/* A patient who has just been registered holds an activation code
                and no password yet. */}
            <Link
              to="/activate"
              className="block w-full rounded-xl border border-border-interactive px-4 py-3 text-center text-sm font-medium text-content hover:bg-surface-sunken"
            >
              {t('auth.activateLink')}
            </Link>

            {/* NFC card verification is self-scoped and requires an authenticated
                patient. QR verification is a provider emergency-access action.
                Neither endpoint can authenticate a patient, so do not expose them
                as dead alternative sign-in controls. */}
            <p className="mt-4 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-center text-sm text-content-muted">
              {t('auth.cardVerificationAfterLogin')}
            </p>
          </div>

          {/* Security notice */}
          <div className="mt-6 flex items-center justify-center gap-2 text-content-secondary text-sm">
            <Shield className="w-4 h-4" />
            <span>{t('auth.securityNotice')}</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center text-sm text-content-secondary">
        {t('common.copyright')}
      </footer>
    </div>
  );
}
