import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Shield, Lock, Eye, EyeOff } from 'lucide-react';

/**
 * Patient Login Page
 * 
 * Secure authentication for patients to access their medical records.
 * Uses National Health ID or linked account credentials.
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    healthId: '',
    password: '',
    rememberMe: false,
  });
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Validate inputs
    if (!formData.healthId.trim()) {
      setError('Please enter your National Health ID');
      setIsLoading(false);
      return;
    }

    if (!formData.password.trim()) {
      setError('Please enter your password');
      setIsLoading(false);
      return;
    }

    try {
      // Simulate authentication delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Demo: Accept demo patient credentials
      if (formData.healthId === 'PAT-001-DEMO' || formData.healthId === 'MCHI-2026-DEMO') {
        // Store auth state
        localStorage.setItem('patient-auth', JSON.stringify({
          patientId: 'PAT-001-DEMO',
          healthId: 'MCHI-2026-DEMO-XXXX',
          name: 'John Doe',
          authenticated: true,
          timestamp: Date.now(),
        }));
        navigate('/dashboard');
      } else {
        setError('Invalid credentials. For demo, use: PAT-001-DEMO');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

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
              Welcome Back
            </h1>
            <p className="text-neutral-600">
              Access your medical records securely
            </p>
          </div>

          {/* Login card */}
          <div className="bg-white rounded-2xl shadow-card p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Error message */}
              {error && (
                <div className="bg-emergency-50 border border-emergency-200 text-emergency-700 px-4 py-3 rounded-xl text-sm animate-fade-in">
                  {error}
                </div>
              )}

              {/* Health ID input */}
              <div>
                <label htmlFor="healthId" className="block text-sm font-medium text-neutral-700 mb-2">
                  National Health ID
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Shield className="h-5 w-5 text-neutral-400" />
                  </div>
                  <input
                    type="text"
                    id="healthId"
                    value={formData.healthId}
                    onChange={(e) => setFormData({ ...formData, healthId: e.target.value })}
                    placeholder="MCHI-XXXX-XXXX or PAT-XXX"
                    className="block w-full pl-12 pr-4 py-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    disabled={isLoading}
                  />
                </div>
              </div>

              {/* Password input */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-neutral-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-neutral-400" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Enter your password"
                    className="block w-full pl-12 pr-12 py-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5 text-neutral-400 hover:text-neutral-600" />
                    ) : (
                      <Eye className="h-5 w-5 text-neutral-400 hover:text-neutral-600" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember me & Forgot password */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.rememberMe}
                    onChange={(e) => setFormData({ ...formData, rememberMe: e.target.checked })}
                    className="w-4 h-4 rounded border-neutral-300 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="text-sm text-neutral-600">Remember me</span>
                </label>
                <button type="button" className="text-sm text-primary-500 hover:text-primary-600 font-medium">
                  Forgot password?
                </button>
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
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

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

          {/* Demo credentials */}
          <div className="mt-6 bg-info-light border border-info/20 rounded-xl p-4 text-center">
            <p className="text-sm text-info-dark">
              <strong>Demo Credentials:</strong><br />
              Health ID: <code className="bg-white px-2 py-0.5 rounded">PAT-001-DEMO</code><br />
              Password: <code className="bg-white px-2 py-0.5 rounded">any value</code>
            </p>
          </div>

          {/* Security notice */}
          <div className="mt-6 flex items-center justify-center gap-2 text-neutral-500 text-sm">
            <Shield className="w-4 h-4" />
            <span>Your data is encrypted and secure</span>
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
