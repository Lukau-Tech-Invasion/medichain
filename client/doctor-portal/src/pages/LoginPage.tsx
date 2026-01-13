import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, type Role } from '../store';
import { Shield, Wallet, AlertCircle, Loader2 } from 'lucide-react';
import { FEATURES } from '@medichain/shared';

/**
 * Demo roles for quick wallet generation (development only)
 */
const DEMO_ROLES: { role: Role; label: string; icon: string }[] = [
  { role: 'Doctor', label: 'Doctor', icon: '👨‍⚕️' },
  { role: 'Nurse', label: 'Nurse', icon: '👩‍⚕️' },
  { role: 'Admin', label: 'Admin', icon: '🔐' },
  { role: 'LabTechnician', label: 'Lab Tech', icon: '🔬' },
  { role: 'Pharmacist', label: 'Pharmacist', icon: '💊' },
];

function LoginPage() {
  const navigate = useNavigate();
  const { login, loginWithDemoWallet, isLoading, error, clearError } = useAuthStore();
  const [walletAddress, setWalletAddress] = useState('');

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
   * Generate a demo wallet with specified role (development only)
   */
  const handleDemoLogin = async (role: Role) => {
    clearError();
    const success = await loginWithDemoWallet(role);
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
          <p className="text-primary-100 mt-1">Doctor Portal</p>
        </div>

        {/* Wallet Login Form */}
        <form onSubmit={handleWalletLogin} className="p-8">
          <div className="mb-6">
            <label htmlFor="walletAddress" className="block text-sm font-medium text-gray-700 mb-2">
              <Wallet size={16} className="inline mr-2" />
              Wallet Address
            </label>
            <input
              id="walletAddress"
              type="text"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              placeholder="Enter your Substrate wallet address"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
              disabled={isLoading}
            />
            <p className="mt-1 text-xs text-gray-500">
              SS58 format (starts with 5...)
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
            className="w-full py-3 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Wallet size={18} />
                Connect Wallet
              </>
            )}
          </button>
        </form>

        {/* Demo Wallet Generation - Only shown in development mode */}
        {FEATURES.DEMO_WALLET_GENERATION && (
          <div className="px-8 pb-8">
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Demo Mode - Generate Wallet</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {DEMO_ROLES.map(({ role, label, icon }) => (
                <button
                  key={role}
                  onClick={() => handleDemoLogin(role)}
                  disabled={isLoading}
                  className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-left disabled:opacity-50"
                >
                  <span className="block text-lg">{icon}</span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-gray-500">Generate wallet</span>
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs text-center text-gray-400">
              Demo wallets are generated using Substrate sr25519 keypairs
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
