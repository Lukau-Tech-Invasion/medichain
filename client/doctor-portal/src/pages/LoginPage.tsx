import { useState } from 'react';
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
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { FEATURES, useTranslation } from '@medichain/shared';

/**
 * Demo users with actual wallet addresses from the database
 * These are pre-registered accounts for testing and hackathon demos
 */
interface DemoUser {
  username: string;
  displayName: string;
  role: Role;
  walletAddress: string;
  icon: LucideIcon;
  color: string;
}

const DEMO_USERS: DemoUser[] = [
  // Administrators
  { username: 'admin', displayName: 'System Admin', role: 'Admin', walletAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', icon: ShieldCheck, color: 'bg-surface-sunken border-purple-300 hover:bg-purple-200' },
  { username: 'judge', displayName: 'Hackathon Judge', role: 'Admin', walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y', icon: Scale, color: 'bg-surface-sunken border-purple-300 hover:bg-purple-200' },
  // Doctors
  { username: 'dr.mbeki', displayName: 'Dr. Thandi Mbeki', role: 'Doctor', walletAddress: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', icon: Stethoscope, color: 'bg-notice-subtle border-notice hover:bg-blue-200' },
  { username: 'dr.nkosi', displayName: 'Dr. Sipho Nkosi', role: 'Doctor', walletAddress: '5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw', icon: Stethoscope, color: 'bg-notice-subtle border-notice hover:bg-blue-200' },
  { username: 'dr.khumalo', displayName: 'Dr. Zama Khumalo', role: 'Doctor', walletAddress: '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy', icon: Stethoscope, color: 'bg-notice-subtle border-notice hover:bg-blue-200' },
  // Nurses
  { username: 'nurse.dlamini', displayName: 'Nurse Nomvula Dlamini', role: 'Nurse', walletAddress: '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL', icon: Syringe, color: 'bg-ok-subtle border-ok hover:bg-green-200' },
  { username: 'nurse.molefe', displayName: 'Nurse Kagiso Molefe', role: 'Nurse', walletAddress: '5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY', icon: Syringe, color: 'bg-ok-subtle border-ok hover:bg-green-200' },
  // Lab Technician
  { username: 'lab.mokoena', displayName: 'Lab Tech Lerato Mokoena', role: 'LabTechnician', walletAddress: '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc', icon: FlaskConical, color: 'bg-caution-subtle border-caution hover:bg-amber-200' },
  // Pharmacist
  { username: 'pharm.sithole', displayName: 'Pharm. Bongani Sithole', role: 'Pharmacist', walletAddress: '5Ew3MyB15VprZrjQVkpQFj8okmc9xLDSEdNhqMMS5cXsqxoW', icon: Pill, color: 'bg-surface-sunken border-pink-300 hover:bg-pink-200' },
  // Patients (linked to demo patient records)
  { username: 'patient.mokoena', displayName: 'Thabo Mokoena (Patient)', role: 'Patient', walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z', icon: UserRound, color: 'bg-surface-sunken border-teal-300 hover:bg-teal-200' },
  { username: 'patient.dlamini', displayName: 'Nomvula Dlamini (Patient)', role: 'Patient', walletAddress: '5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZZ', icon: UserRound, color: 'bg-surface-sunken border-teal-300 hover:bg-teal-200' },
  { username: 'patient.nkosi', displayName: 'Sipho Nkosi (Patient)', role: 'Patient', walletAddress: '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFZ', icon: UserRound, color: 'bg-surface-sunken border-teal-300 hover:bg-teal-200' },
];

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
  const handleDemoUserLogin = async (user: DemoUser) => {
    clearError();
    const success = await login(user.walletAddress);
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
              {DEMO_USERS.map((user) => {
                const Icon = user.icon;
                return (
                  <button
                    key={user.username}
                    onClick={() => handleDemoUserLogin(user)}
                    disabled={isLoading}
                    className={`p-2 border rounded-lg transition-all text-left disabled:opacity-50 ${user.color}`}
                  >
                    <Icon className="mx-auto mb-1 text-content-secondary" size={22} aria-hidden="true" />
                    <span className="block text-xs font-semibold text-content-secondary truncate text-center">{user.displayName.split(' ').slice(-1)[0]}</span>
                    <span className="block text-xs text-content-muted text-center">{t(`docRoles.${user.role}`)}</span>
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
