import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { Shield, User, Lock, AlertCircle } from 'lucide-react';

/**
 * Demo users for hackathon presentation
 */
const DEMO_USERS = [
  { userId: 'DOC-001', username: 'dr.smith', role: 'Doctor', label: '👨‍⚕️ Doctor' },
  { userId: 'NURSE-001', username: 'nurse.johnson', role: 'Nurse', label: '👩‍⚕️ Nurse' },
  { userId: 'ADMIN-001', username: 'admin', role: 'Admin', label: '🔐 Admin' },
  { userId: 'LAB-001', username: 'lab.tech', role: 'LabTechnician', label: '🔬 Lab Tech' },
];

function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error } = useAuthStore();
  const [userId, setUserId] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await login(userId);
    if (success) {
      navigate('/dashboard');
    }
  };

  const handleDemoLogin = async (demoUserId: string) => {
    setUserId(demoUserId);
    const success = await login(demoUserId);
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

        {/* Login Form */}
        <form onSubmit={handleLogin} className="p-8">
          <div className="mb-6">
            <label htmlFor="userId" className="block text-sm font-medium text-gray-700 mb-2">
              <User size={16} className="inline mr-2" />
              User ID
            </label>
            <input
              id="userId"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Enter your User ID"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
              <AlertCircle size={18} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !userId.trim()}
            className="w-full py-3 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Lock size={18} />
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Demo Users */}
        <div className="px-8 pb-8">
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">Demo Login</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {DEMO_USERS.map((user) => (
              <button
                key={user.userId}
                onClick={() => handleDemoLogin(user.userId)}
                disabled={isLoading}
                className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-left disabled:opacity-50"
              >
                <span className="block text-sm font-medium">{user.label}</span>
                <span className="block text-xs text-gray-500">{user.userId}</span>
              </button>
            ))}
          </div>
        </div>

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
