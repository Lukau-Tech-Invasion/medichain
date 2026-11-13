import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { ActivationForm, useTranslation } from '@medichain/shared';
import { useAuthStore } from '../store';

/**
 * First sign-in for a staff account.
 *
 * An administrator creates the account and hands over a one-time credential
 * code (shown once, on their screen). Redeeming it here is how the person
 * chooses their own password: nobody else ever sees it, and the account stays
 * `pending` until an administrator activates it.
 */
function ActivatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activateWithCredentialCode, isLoading, error, clearError, isAuthenticated } = useAuthStore();

  useEffect(() => {
    clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard');
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-700 to-primary-900 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-brand p-8 text-center">
          <div className="w-20 h-20 bg-surface/20 rounded-full mx-auto flex items-center justify-center mb-4">
            <Shield className="text-white" size={40} />
          </div>
          <h1 className="text-2xl font-bold text-white">{t('activate.staffTitle')}</h1>
          <p className="text-white mt-1">{t('activate.staffSubtitle')}</p>
        </div>
        <div className="p-8">
          <ActivationForm
            audience="staff"
            isLoading={isLoading}
            error={error}
            onSubmit={({ identifier, code, password }) =>
              activateWithCredentialCode({ identifier, code, password })
            }
            footer={
              <p className="text-center text-sm text-content-muted">
                <Link to="/login" className="underline underline-offset-2 hover:text-content-secondary">
                  {t('activate.backToSignIn')}
                </Link>
              </p>
            }
          />
        </div>
      </div>
    </div>
  );
}

export default ActivatePage;
