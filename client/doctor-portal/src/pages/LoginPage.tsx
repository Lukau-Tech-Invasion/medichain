import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, type Role } from '../store';
import {
  Shield,
  KeyRound,
  AlertCircle,
  Loader2,
  UserCircle,
  ShieldCheck,
  Scale,
  Stethoscope,
  Syringe,
  FlaskConical,
  Pill,
  type LucideIcon,
} from 'lucide-react';
import { FEATURES, apiUrl, useTranslation } from '@medichain/shared';

/**
 * Demo sign-in shortcut.
 *
 * These are not a second way to authenticate. Each entry is a *seeded fixture
 * account*, and clicking one runs the ordinary employee-ID/password flow with
 * credentials the server hands back at runtime.
 *
 * The list used to be hardcoded here, with wallet addresses, and clicking an
 * entry called a wallet-lookup route that had been removed on purpose. Every
 * click reported "Wallet not registered" for accounts that were registered, and
 * even when that route existed the shortcut produced a session with no bearer
 * token behind it. There is no honest one-click session: `POST /api/auth/jwt`
 * verifies a real signature over a single-use challenge in every mode, so an
 * identity with no key cannot hold a session.
 *
 * Resolving the list from `GET /api/auth/demo-credentials` also settles
 * production containment without relying on the frontend to hide anything. That
 * endpoint answers only under `MEDICHAIN_DEV_MODE` *and* demo mode; anywhere
 * else it 403s, the list is empty, and the whole section is not rendered. No
 * fixture password ships in the bundle.
 */
interface DemoCredential {
  login_id: string;
  password: string;
  name: string;
  role: Role;
}

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
  const { login, loginWithCredentials, loginWithExtension, isLoading, error, clearError } =
    useAuthStore();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  /**
   * Login using Polkadot extension
   */
  const handleExtensionLogin = async () => {
    clearError();
    const success = await loginWithExtension();
    if (success) {
      navigate('/dashboard');
    }
  };

  /**
   * The normal way in: employee identifier and password.
   *
   * No wallet address is typed, seen, or remembered here — the account's key
   * is fetched encrypted and opened in the browser. See
   * `authStore.loginWithCredentials`.
   */
  const handleCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (!identifier.trim() || !password) return;
    const success = await loginWithCredentials(identifier.trim(), password);
    // Clear the password from component state either way; on failure the user
    // retypes it rather than leaving it sitting in memory behind an error.
    setPassword('');
    if (success) {
      navigate('/dashboard');
    }
  };

  /**
   * Quick login with a demo user's wallet address
   */
  const [demoAccounts, setDemoAccounts] = useState<DemoCredential[]>([]);

  useEffect(() => {
    // A 403 is the expected answer outside a demo deployment, and leaves the
    // section unrendered. Failures are silent for the same reason: the shortcut
    // is a convenience, and its absence is not an error worth showing.
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(apiUrl('/api/auth/demo-credentials'), {
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) return;
        const body = await resp.json();
        if (!cancelled && Array.isArray(body?.credentials)) {
          setDemoAccounts(body.credentials);
        }
      } catch {
        // No demo accounts available; the section stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Run the real credential sign-in with a seeded fixture's credentials.
   *
   * Deliberately `loginWithCredentials` and not a shortcut of its own: the
   * keystore is unlocked, a signer derived, the challenge signed and a genuine
   * session issued, exactly as when a clinician types the same values.
   */
  const handleDemoUserLogin = async (account: DemoCredential) => {
    clearError();
    const success = await loginWithCredentials(account.login_id, account.password);
    if (success) {
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-900 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-brand p-8 text-center">
          <div className="w-20 h-20 bg-surface/20 rounded-full mx-auto flex items-center justify-center mb-4">
            <Shield className="text-white" size={40} />
          </div>
          <h1 className="text-2xl font-bold text-white">MediChain</h1>
          <p className="text-brand-fg mt-1">{t('docLogin.portal')}</p>
        </div>

        {/* Staff sign-in. No wallet address is entered here by design: a
            clinician cannot be asked to type a 48-character SS58 string, and
            one typed into a box could never sign a request anyway. */}
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
              className="w-full px-4 py-3 border border-border-strong rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand"
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
              className="w-full px-4 py-3 border border-border-strong rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand"
              disabled={isLoading}
              required
            />
          </div>

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
            disabled={isLoading || !identifier.trim() || !password}
            className="w-full py-3 bg-brand text-brand-fg font-semibold rounded-lg hover:bg-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
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

          {/* The extension route stays available for staff who already hold a
              wallet, but it is no longer the primary path. */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="w-full text-xs text-content-muted hover:text-content-secondary underline underline-offset-2"
          >
            {t('docLogin.otherSignInOptions')}
          </button>

          {showAdvanced && (
            <button
              type="button"
              onClick={handleExtensionLogin}
              disabled={isLoading}
              className="mt-3 w-full py-3 bg-surface border-2 border-brand text-brand-subtle-fg font-semibold rounded-lg hover:bg-brand-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Shield size={18} aria-hidden="true" />
              {t('docLogin.loginExtension')}
            </button>
          )}
        </form>

        {/* Demo Users - Click to login instantly */}
        {FEATURES.DEMO_WALLET_GENERATION && (
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

            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {demoAccounts.map((account) => {
                const Icon = ROLE_ICONS[account.role] ?? Stethoscope;
                return (
                  <button
                    key={account.login_id}
                    onClick={() => handleDemoUserLogin(account)}
                    disabled={isLoading}
                    className={`p-2 border rounded-lg transition-all text-left disabled:opacity-50 ${ROLE_STYLES[account.role] ?? ROLE_STYLES.Doctor}`}
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
            © 2025 Lukau Invasion (Pty) Ltd • Rust Africa Hackathon 2026
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
