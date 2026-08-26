import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, IS_DEVELOPMENT, useTranslation, LanguageSwitcher } from '@medichain/shared';
import { Heart, Shield, Lock, Eye, EyeOff, Wallet, UserPlus, Zap } from 'lucide-react';
import { usePatientAuthStore } from '../store/authStore';

/**
 * Demo patient accounts with actual wallet addresses from the database
 * These are pre-registered accounts for testing and hackathon demos
 */
/*
 * The five hardcoded "Quick Login - Demo Patients" identities were removed
 * on 2026-08-26.
 *
 * They could not work and never had. Each called `login(walletAddress)` with
 * no signer, against an invented SS58 address present in no wallet extension
 * and in no database, so the flow died at `signMessage`. The label under them
 * read "Click any patient to instantly login with their wallet", which
 * promised the opposite of what happened.
 *
 * The clinician portal reached the same conclusion earlier and answered it
 * properly (2e389f7, 91b171f): patient accounts left that sign-in and quick
 * login was rebuilt on the real credential path behind a demo-gated resolver.
 * A patient authenticates by proving control of a key, and there is no
 * shortcut past that which is not a bypass.
 *
 * Deterministic test identities remain available through "Create Demo Wallet"
 * below, which generates a real keypair and runs the genuine
 * challenge/signature flow. It is gated on IS_DEVELOPMENT, which now fails
 * closed, and scripts/check-quick-login-identities.py fails the build if a
 * hardcoded identity list reappears on a sign-in path.
 */

/**
 * Patient Login Page
 * 
 * Wallet-based authentication for patients to access their medical records.
 * Supports wallet connection and demo wallet generation.
 * 
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
      setLocalError(t('auth.errEnterWallet'));
      return;
    }

    // Basic validation - should start with 5 and be 48 chars
    if (!walletAddress.startsWith('5') || walletAddress.length !== 48) {
      setLocalError(t('auth.errInvalidWallet'));
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
            <p className="text-content-muted">
              {t('auth.welcomeSubtitle')}
            </p>
          </div>

          {/* Login card */}
          <div className="bg-surface rounded-2xl shadow-card p-8">
            <form onSubmit={handleWalletLogin} className="space-y-6">
              {/* Error message */}
              {displayError && (
                <div className="bg-emergency-50 border border-emergency-200 text-critical-subtle-fg px-4 py-3 rounded-xl text-sm animate-fade-in">
                  {displayError}
                </div>
              )}

              {/* Wallet Address input */}
              <div>
                <label htmlFor="walletAddress" className="block text-sm font-medium text-content-secondary mb-2">
                  {t('auth.walletAddressLabel')}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Wallet className="h-5 w-5 text-content-muted" />
                  </div>
                  <input
                    type="text"
                    id="walletAddress"
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    placeholder={t('auth.walletPlaceholder')}
                    className="block w-full pl-12 pr-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-brand transition-colors font-mono text-sm"
                    disabled={isLoading}
                  />
                </div>
                <p className="mt-1 text-xs text-content-muted">
                  {t('auth.walletHint')}
                </p>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-primary-500 text-brand-fg py-3 px-4 rounded-xl font-medium hover:bg-brand focus:ring-4 focus:ring-primary-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {t('auth.connecting')}
                  </>
                ) : (
                  <>
                    <Wallet className="w-5 h-5" />
                    {t('auth.connectWallet')}
                  </>
                )}
              </button>
            </form>

            {/* Quick-login demo patients removed 2026-08-26 — see the block comment
                at the top of this file. */}

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-surface text-content-muted">{t('common.or')}</span>
              </div>
            </div>

            {/* Alternative login options */}
            <div className="space-y-3">
              <button
                type="button"
                className="w-full border border-border text-content-secondary py-3 px-4 rounded-xl font-medium hover:bg-surface-sunken transition-colors flex items-center justify-center gap-2"
              >
                <img src="/nfc-icon.svg" alt="" className="w-5 h-5" onError={(e) => e.currentTarget.style.display = 'none'} />
                {t('auth.signInNfc')}
              </button>
              <button
                type="button"
                className="w-full border border-border text-content-secondary py-3 px-4 rounded-xl font-medium hover:bg-surface-sunken transition-colors flex items-center justify-center gap-2"
              >
                <img src="/qr-icon.svg" alt="" className="w-5 h-5" onError={(e) => e.currentTarget.style.display = 'none'} />
                {t('auth.scanQr')}
              </button>
            </div>
          </div>

          {/* Demo Wallet Section (Development Only) */}
          {IS_DEVELOPMENT && (
            <div className="mt-6 bg-warning-50 border border-warning-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-5 h-5 text-warning-600" />
                <span className="font-medium text-warning-800">{t('auth.devMode')}</span>
              </div>
              
              {!showDemoForm ? (
                <button
                  onClick={() => setShowDemoForm(true)}
                  className="w-full bg-warning-100 text-warning-800 py-2 px-4 rounded-lg font-medium hover:bg-warning-200 transition-colors flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  {t('auth.createDemoWallet')}
                </button>
              ) : (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={demoName}
                    onChange={(e) => setDemoName(e.target.value)}
                    placeholder={t('auth.demoNamePlaceholder')}
                    className="block w-full px-4 py-2 border border-warning-200 rounded-lg focus:ring-2 focus:ring-warning-500 focus:border-warning-500 transition-colors"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleDemoLogin}
                      disabled={isLoading}
                      className="flex-1 bg-warning-500 text-white py-2 px-4 rounded-lg font-medium hover:bg-warning-600 transition-colors disabled:opacity-50"
                    >
                      {isLoading ? t('auth.creating') : t('auth.createAndLogin')}
                    </button>
                    <button
                      onClick={() => setShowDemoForm(false)}
                      className="px-4 py-2 border border-warning-200 text-warning-700 rounded-lg hover:bg-warning-100 transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Security notice */}
          <div className="mt-6 flex items-center justify-center gap-2 text-content-muted text-sm">
            <Shield className="w-4 h-4" />
            <span>{t('auth.securityNotice')}</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center text-sm text-content-muted">
        © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
      </footer>
    </div>
  );
}
