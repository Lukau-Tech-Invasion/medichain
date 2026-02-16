import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, IS_DEVELOPMENT, FEATURES } from '@medichain/shared';
import { Heart, Shield, Lock, Eye, EyeOff, Wallet, UserPlus, Zap, UserCircle } from 'lucide-react';
import { usePatientAuthStore } from '../store/authStore';

/**
 * Demo patient accounts with actual wallet addresses from the database
 * These are pre-registered accounts for testing and hackathon demos
 */
interface DemoPatient {
  name: string;
  displayName: string;
  walletAddress: string;
  icon: string;
  condition: string;
}

const DEMO_PATIENTS: DemoPatient[] = [
  { 
    name: 'Thabo Mokoena', 
    displayName: 'Thabo (Cardiac)', 
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z', 
    icon: '🧑', 
    condition: 'Cardiac' 
  },
  { 
    name: 'Nomvula Dlamini', 
    displayName: 'Nomvula (Diabetic)', 
    walletAddress: '5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZZ', 
    icon: '👩', 
    condition: 'Diabetic' 
  },
  { 
    name: 'Sipho Nkosi', 
    displayName: 'Sipho (Asthma)', 
    walletAddress: '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFZ', 
    icon: '👨', 
    condition: 'Asthma' 
  },
  { 
    name: 'Lerato Khumalo', 
    displayName: 'Lerato (Allergies)', 
    walletAddress: '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjZ', 
    icon: '👧', 
    condition: 'Allergies' 
  },
  { 
    name: 'Bongani Zulu', 
    displayName: 'Bongani (Elderly)', 
    walletAddress: '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFZ', 
    icon: '👴', 
    condition: 'Cardiac/DNR' 
  },
];

/**
 * Patient Login Page
 * 
 * Wallet-based authentication for patients to access their medical records.
 * Supports wallet connection and demo wallet generation.
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { 
    login, 
    loginWithDemoWallet, 
    isAuthenticated, 
    isLoading, 
    error, 
    clearError 
  } = usePatientAuthStore();
  
  const [walletAddress, setWalletAddress] = useState('');
  const [demoName, setDemoName] = useState('');
  const [showDemoForm, setShowDemoForm] = useState(false);
  const [localError, setLocalError] = useState('');

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const handleWalletLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError('');

    if (!walletAddress.trim()) {
      setLocalError('Please enter your wallet address');
      return;
    }

    // Basic validation - should start with 5 and be 48 chars
    if (!walletAddress.startsWith('5') || walletAddress.length !== 48) {
      setLocalError('Invalid wallet address format. Must be 48 characters starting with "5".');
      return;
    }

    const success = await login(walletAddress);
    if (success) {
      navigate('/dashboard');
    }
  };

  /**
   * Quick login with a demo patient's wallet address
   */
  const handleDemoPatientLogin = async (patient: DemoPatient) => {
    clearError();
    setLocalError('');
    const success = await login(patient.walletAddress);
    if (success) {
      navigate('/dashboard');
    }
  };

  const handleDemoLogin = async () => {
    clearError();
    setLocalError('');
    
    const name = demoName.trim() || undefined;
    const success = await loginWithDemoWallet(name);
    if (success) {
      navigate('/dashboard');
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-success-50 flex flex-col">
      {/* Header */}
      <header className="p-6">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-primary-500 rounded-xl flex items-center justify-center">
            <Heart className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-semibold text-neutral-800">MediChain</span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Welcome text */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-neutral-900 mb-2">
              Welcome to MediChain
            </h1>
            <p className="text-neutral-600">
              Connect your wallet to access your medical records
            </p>
          </div>

          {/* Login card */}
          <div className="bg-white rounded-2xl shadow-card p-8">
            <form onSubmit={handleWalletLogin} className="space-y-6">
              {/* Error message */}
              {displayError && (
                <div className="bg-emergency-50 border border-emergency-200 text-emergency-700 px-4 py-3 rounded-xl text-sm animate-fade-in">
                  {displayError}
                </div>
              )}

              {/* Wallet Address input */}
              <div>
                <label htmlFor="walletAddress" className="block text-sm font-medium text-neutral-700 mb-2">
                  Wallet Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Wallet className="h-5 w-5 text-neutral-400" />
                  </div>
                  <input
                    type="text"
                    id="walletAddress"
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    placeholder="5ABC...XYZ (48 characters)"
                    className="block w-full pl-12 pr-4 py-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors font-mono text-sm"
                    disabled={isLoading}
                  />
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  Your Substrate wallet address (SS58 format)
                </p>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-primary-500 text-white py-3 px-4 rounded-xl font-medium hover:bg-primary-600 focus:ring-4 focus:ring-primary-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Wallet className="w-5 h-5" />
                    Connect Wallet
                  </>
                )}
              </button>
            </form>

            {/* Demo Patients - Quick Login Section */}
            {FEATURES.DEMO_WALLET_GENERATION && (
              <>
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-neutral-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-4 bg-white text-neutral-500 flex items-center gap-1">
                      <UserCircle className="w-4 h-4" />
                      Quick Login - Demo Patients
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {DEMO_PATIENTS.map((patient) => (
                    <button
                      key={patient.walletAddress}
                      onClick={() => handleDemoPatientLogin(patient)}
                      disabled={isLoading}
                      className="p-3 border border-teal-200 rounded-xl bg-teal-50 hover:bg-teal-100 transition-all text-center disabled:opacity-50"
                    >
                      <span className="block text-2xl mb-1">{patient.icon}</span>
                      <span className="block text-xs font-semibold text-gray-800 truncate">{patient.name.split(' ')[0]}</span>
                      <span className="block text-xs text-teal-600">{patient.condition}</span>
                    </button>
                  ))}
                </div>

                <p className="mt-3 text-xs text-center text-neutral-400">
                  Click any patient to instantly login with their wallet
                </p>
              </>
            )}

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-neutral-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white text-neutral-500">or</span>
              </div>
            </div>

            {/* Alternative login options */}
            <div className="space-y-3">
              <button
                type="button"
                className="w-full border border-neutral-200 text-neutral-700 py-3 px-4 rounded-xl font-medium hover:bg-neutral-50 transition-colors flex items-center justify-center gap-2"
              >
                <img src="/nfc-icon.svg" alt="" className="w-5 h-5" onError={(e) => e.currentTarget.style.display = 'none'} />
                Sign in with NFC Card
              </button>
              <button
                type="button"
                className="w-full border border-neutral-200 text-neutral-700 py-3 px-4 rounded-xl font-medium hover:bg-neutral-50 transition-colors flex items-center justify-center gap-2"
              >
                <img src="/qr-icon.svg" alt="" className="w-5 h-5" onError={(e) => e.currentTarget.style.display = 'none'} />
                Scan QR Code
              </button>
            </div>
          </div>

          {/* Demo Wallet Section (Development Only) */}
          {IS_DEVELOPMENT && (
            <div className="mt-6 bg-warning-50 border border-warning-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-5 h-5 text-warning-600" />
                <span className="font-medium text-warning-800">Development Mode</span>
              </div>
              
              {!showDemoForm ? (
                <button
                  onClick={() => setShowDemoForm(true)}
                  className="w-full bg-warning-100 text-warning-800 py-2 px-4 rounded-lg font-medium hover:bg-warning-200 transition-colors flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  Create Demo Wallet
                </button>
              ) : (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={demoName}
                    onChange={(e) => setDemoName(e.target.value)}
                    placeholder="Enter your name (optional)"
                    className="block w-full px-4 py-2 border border-warning-200 rounded-lg focus:ring-2 focus:ring-warning-500 focus:border-warning-500 transition-colors"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleDemoLogin}
                      disabled={isLoading}
                      className="flex-1 bg-warning-500 text-white py-2 px-4 rounded-lg font-medium hover:bg-warning-600 transition-colors disabled:opacity-50"
                    >
                      {isLoading ? 'Creating...' : 'Create & Login'}
                    </button>
                    <button
                      onClick={() => setShowDemoForm(false)}
                      className="px-4 py-2 border border-warning-200 text-warning-700 rounded-lg hover:bg-warning-100 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Security notice */}
          <div className="mt-6 flex items-center justify-center gap-2 text-neutral-500 text-sm">
            <Shield className="w-4 h-4" />
            <span>Blockchain-secured authentication</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center text-sm text-neutral-500">
        © 2025 Trustware. All rights reserved.
      </footer>
    </div>
  );
}
