import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore, type Role } from '../store';
import {
  Shield,
  KeyRound,
  AlertCircle,
  Loader2,
  UserCircle,
  ShieldCheck,
  Stethoscope,
  Syringe,
  FlaskConical,
  Pill,
  type LucideIcon,
} from 'lucide-react';
import { FEATURES, getDemoCredentials, useTranslation, type DemoCredential as DemoCredentialRow } from '@medichain/shared';

/**
 * Demo sign-in shortcut.
 *
 * These are not a second way to authenticate. Each entry is a *seeded fixture
 * account*, and clicking one runs the ordinary employee-ID/password flow with
 * credentials the server hands back at runtime.
 *
 * The list used to be hardcoded here, and clicking an entry produced a session
 * with no bearer token behind it. There is no honest one-click session: every
 * session comes from `POST /api/auth/login` with a real credential.
 *
 * Resolving the list from `GET /api/auth/demo-credentials` also settles
 * production containment without relying on the frontend to hide anything. That
 * endpoint answers only under `MEDICHAIN_DEV_MODE` *and* demo mode; anywhere
 * else it 403s, the list is empty, and the whole section is not rendered. No
 * fixture password ships in the bundle.
 */
type DemoCredential = DemoCredentialRow & { role: Role };

const ROLE_ICONS: Record<string, LucideIcon> = {
  Admin: ShieldCheck,
  Doctor: Stethoscope,
  Nurse: Syringe,
  LabTechnician: FlaskConical,
  Pharmacist: Pill,
};

const ROLE_STYLES: Record<string, string> = {
  Admin: 'bg-surface-sunken border-purple-300 hover:bg-purple-200',
  Doctor: 'bg-notice-subtle border-notice hover:bg-blue-200',
  Nurse: 'bg-ok-subtle border-ok hover:bg-green-200',
  LabTechnician: 'bg-caution-subtle border-caution hover:bg-amber-200',
  Pharmacist: 'bg-surface-sunken border-pink-300 hover:bg-pink-200',
};

function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loginWithCredentials, isLoading, error, mfaRequired, clearError } = useAuthStore();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');

  /**
   * The way in: Employee ID and password.
   *
   * An account with an authenticator answers "code needed" on the first
   * attempt; the code field then appears and the same form is submitted again
   * with it. See `authStore.loginWithCredentials`.
   */
  const handleCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (!identifier.trim() || !password) return;
    const code = mfaRequired ? totpCode.trim() : undefined;
    if (mfaRequired && !code) return;
    const result = await loginWithCredentials(identifier.trim(), password, code);
    setTotpCode('');
    // Keep the password only while the account is waiting for its code: the
    // second submit needs it again. Otherwise clear it from component state; on
    // failure the user retypes it rather than leaving it sitting behind an error.
    if (result !== 'mfa_required') setPassword('');
    if (result === true) {
      navigate('/dashboard');
    }
  };

  /**
   * Quick login with a demo user's seeded credentials
   */
  const [demoAccounts, setDemoAccounts] = useState<DemoCredential[]>([]);

  useEffect(() => {
    // Not a demo build: never ask. A production bundle makes no request for
    // demo accounts at all, so there is nothing for the server to refuse.
    if (!FEATURES.QUICK_LOGIN) return;
    let cancelled = false;
    (async () => {
      try {
        const { credentials } = await getDemoCredentials();
        if (!cancelled && Array.isArray(credentials)) {
          setDemoAccounts(credentials as DemoCredential[]);
        }
      } catch (err) {
        // A demo build talking to an API that is not in dev+demo mode gets a
        // 403 here. The section then stays hidden, which is the right outcome,
        // but the reason is logged so a presenter can see why it is missing.
        console.warn('[MediChain] Demo accounts unavailable; quick login hidden.', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Run the real credential sign-in with a seeded fixture's credentials.
   *
   * Deliberately `loginWithCredentials` and not a shortcut of its own: a
   * genuine session is issued, exactly as when a clinician types the same
   * values.
   */
  const handleDemoUserLogin = async (account: DemoCredential) => {
    clearError();
    const success = await loginWithCredentials(account.login_id, account.password);
    if (success) {
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-700 to-primary-900 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-brand p-8 text-center">
          <div className="w-20 h-20 bg-surface/20 rounded-full mx-auto flex items-center justify-center mb-4">
            <Shield className="text-white" size={40} />
          </div>
          <h1 className="text-2xl font-bold text-white">MediChain</h1>
          <p className="text-white mt-1">{t('docLogin.portal')}</p>
        </div>

        {/* Staff sign-in: Employee ID and password. */}
        <form onSubmit={handleCredentialLogin} className="p-8">
          <div className="mb-4">
            <label htmlFor="identifier" className="block text-sm font-medium text-content-secondary mb-2">
              <UserCircle size={16} className="inline mr-2" aria-hidden="true" />
              {t('docLogin.identifier')}
            </label>
            <input
              id="identifier"
              name="username"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t('docLogin.identifierPlaceholder')}
              className="w-full px-4 py-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand"
              disabled={isLoading}
              required
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className="block text-sm font-medium text-content-secondary mb-2">
              <KeyRound size={16} className="inline mr-2" aria-hidden="true" />
              {t('docLogin.password')}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand"
              disabled={isLoading}
              required
            />
          </div>

          {mfaRequired && (
            <div className="mb-6">
              <label htmlFor="totp-code" className="block text-sm font-medium text-content-secondary mb-2">
                <ShieldCheck size={16} className="inline mr-2" aria-hidden="true" />
                {t('docLogin.totpLabel')}
              </label>
              <input
                id="totp-code"
                name="totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="w-full px-4 py-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand"
                disabled={isLoading}
                required
              />
              <p className="mt-1 text-xs text-content-muted">{t('docLogin.totpHint')}</p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-4 p-3 bg-critical-subtle border border-critical rounded-lg flex items-center gap-2 text-critical-subtle-fg"
            >
              <AlertCircle size={18} aria-hidden="true" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !identifier.trim() || !password || (mfaRequired && !totpCode.trim())}
            className="w-full py-3 bg-brand text-brand-fg font-semibold rounded-lg hover:bg-brand transition-colors disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                {t('docLogin.signingIn')}
              </>
            ) : (
              t('docLogin.signIn')
            )}
          </button>

          <p className="text-center text-sm text-content-muted">
            <Link to="/activate" className="underline underline-offset-2 hover:text-content-secondary">
              {t('docLogin.activateLink')}
            </Link>
          </p>
        </form>

        {/* Demo accounts. Two independent gates: the build must be a demo build
            (VITE_DEMO_MODE=true), and the server must actually offer fixture
            accounts -- outside a dev-mode demo deployment the resolver 403s,
            the list stays empty and the section disappears. */}
        {FEATURES.QUICK_LOGIN && demoAccounts.length > 0 && (
          <div className="px-6 pb-6">
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-surface text-content-muted flex items-center gap-1">
                  <UserCircle size={14} />
                  {t('docLogin.quickLogin')}
                </span>
              </div>
            </div>

            {/* Said in words, not implied by styling: anyone watching a demo
                should know these buttons do not exist in a real deployment. */}
            <p className="mb-3 text-xs text-center font-medium text-caution-subtle-fg bg-caution-subtle border border-caution rounded-md px-2 py-1">
              {t('docLogin.demoAccountsLabel')}
            </p>

            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {demoAccounts.map((account) => {
                const Icon = ROLE_ICONS[account.role] ?? Stethoscope;
                return (
                  <button
                    key={account.login_id}
                    onClick={() => handleDemoUserLogin(account)}
                    disabled={isLoading}
                    className={`p-2 border rounded-lg transition-all text-left disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 ${ROLE_STYLES[account.role] ?? ROLE_STYLES.Doctor}`}
                  >
                    <Icon className="mx-auto mb-1 text-content-secondary" size={22} aria-hidden="true" />
                    <span className="block text-xs font-semibold text-content-secondary truncate text-center">{account.name.split(' ').slice(-1)[0]}</span>
                    <span className="block text-xs text-content-muted text-center">{t(`docRoles.${account.role}`)}</span>
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-xs text-center text-content-muted">
              {t('docLogin.clickToLogin')}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="px-8 py-4 bg-surface-sunken border-t border-border text-center">
          <p className="text-xs text-content-muted">
            {t('common.copyright')}
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
