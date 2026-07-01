import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, type Role } from '../store';
import {
  Shield,
  Wallet,
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
  { username: 'admin', displayName: 'System Admin', role: 'Admin', walletAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', icon: ShieldCheck, color: 'bg-purple-100 border-purple-300 hover:bg-purple-200' },
  { username: 'judge', displayName: 'Hackathon Judge', role: 'Admin', walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y', icon: Scale, color: 'bg-purple-100 border-purple-300 hover:bg-purple-200' },
  // Doctors
  { username: 'dr.mbeki', displayName: 'Dr. Thandi Mbeki', role: 'Doctor', walletAddress: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', icon: Stethoscope, color: 'bg-blue-100 border-blue-300 hover:bg-blue-200' },
  { username: 'dr.nkosi', displayName: 'Dr. Sipho Nkosi', role: 'Doctor', walletAddress: '5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw', icon: Stethoscope, color: 'bg-blue-100 border-blue-300 hover:bg-blue-200' },
  { username: 'dr.khumalo', displayName: 'Dr. Zama Khumalo', role: 'Doctor', walletAddress: '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy', icon: Stethoscope, color: 'bg-blue-100 border-blue-300 hover:bg-blue-200' },
  // Nurses
  { username: 'nurse.dlamini', displayName: 'Nurse Nomvula Dlamini', role: 'Nurse', walletAddress: '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL', icon: Syringe, color: 'bg-green-100 border-green-300 hover:bg-green-200' },
  { username: 'nurse.molefe', displayName: 'Nurse Kagiso Molefe', role: 'Nurse', walletAddress: '5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY', icon: Syringe, color: 'bg-green-100 border-green-300 hover:bg-green-200' },
  // Lab Technician
  { username: 'lab.mokoena', displayName: 'Lab Tech Lerato Mokoena', role: 'LabTechnician', walletAddress: '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc', icon: FlaskConical, color: 'bg-amber-100 border-amber-300 hover:bg-amber-200' },
  // Pharmacist
  { username: 'pharm.sithole', displayName: 'Pharm. Bongani Sithole', role: 'Pharmacist', walletAddress: '5Ew3MyB15VprZrjQVkpQFj8okmc9xLDSEdNhqMMS5cXsqxoW', icon: Pill, color: 'bg-pink-100 border-pink-300 hover:bg-pink-200' },
  // Patients (linked to demo patient records)
  { username: 'patient.mokoena', displayName: 'Thabo Mokoena (Patient)', role: 'Patient', walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z', icon: UserRound, color: 'bg-teal-100 border-teal-300 hover:bg-teal-200' },
  { username: 'patient.dlamini', displayName: 'Nomvula Dlamini (Patient)', role: 'Patient', walletAddress: '5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZZ', icon: UserRound, color: 'bg-teal-100 border-teal-300 hover:bg-teal-200' },
  { username: 'patient.nkosi', displayName: 'Sipho Nkosi (Patient)', role: 'Patient', walletAddress: '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFZ', icon: UserRound, color: 'bg-teal-100 border-teal-300 hover:bg-teal-200' },
];

function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, loginWithExtension, isLoading, error, clearError } = useAuthStore();
  const [walletAddress, setWalletAddress] = useState('');

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
   * Login with an existing wallet address
   */
  const handleWalletLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    
    if (!walletAddress.trim()) return;
    
    const success = await login(walletAddress.trim());
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-primary-600 p-8 text-center">
          <div className="w-20 h-20 bg-white/20 rounded-full mx-auto flex items-center justify-center mb-4">
            <Shield className="text-white" size={40} />
          </div>
          <h1 className="text-2xl font-bold text-white">MediChain</h1>
          <p className="text-primary-100 mt-1">{t('docLogin.portal')}</p>
        </div>

        {/* Wallet Login Form */}
        <form onSubmit={handleWalletLogin} className="p-8">
          <div className="mb-6">
            <label htmlFor="walletAddress" className="block text-sm font-medium text-gray-700 mb-2">
              <Wallet size={16} className="inline mr-2" />
              {t('docLogin.walletAddress')}
            </label>
            <input
              id="walletAddress"
              type="text"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              placeholder={t('docLogin.walletPlaceholder')}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
              disabled={isLoading}
            />
            <p className="mt-1 text-xs text-gray-500">
              {t('docLogin.ss58Hint')}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
              <AlertCircle size={18} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !walletAddress.trim()}
            className="w-full py-3 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {t('docLogin.connecting')}
              </>
            ) : (
              <>
                <Wallet size={18} />
                {t('docLogin.connectWallet')}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExtensionLogin}
            disabled={isLoading}
            className="w-full py-3 bg-white border-2 border-primary-600 text-primary-600 font-semibold rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Shield size={18} />
            {t('docLogin.loginExtension')}
          </button>
        </form>

        {/* Demo Users - Click to login instantly */}
        {FEATURES.DEMO_WALLET_GENERATION && (
          <div className="px-6 pb-6">
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500 flex items-center gap-1">
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
                    <Icon className="mx-auto mb-1 text-gray-700" size={22} aria-hidden="true" />
                    <span className="block text-xs font-semibold text-gray-800 truncate text-center">{user.displayName.split(' ').slice(-1)[0]}</span>
                    <span className="block text-xs text-gray-600 text-center">{t(`docRoles.${user.role}`)}</span>
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-xs text-center text-gray-400">
              {t('docLogin.clickToLogin')}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-500">
            © 2025 Trustware • Rust Africa Hackathon 2026
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
