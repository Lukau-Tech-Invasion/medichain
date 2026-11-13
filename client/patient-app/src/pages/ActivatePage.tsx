import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { ActivationForm, LanguageSwitcher, useTranslation } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

/**
 * Activate a patient account.
 *
 * At registration the clinic hands the patient a one-time activation code
 * (XXXX-XXXX-XXXX) with their patient ID. Redeeming it here is how the patient
 * chooses their own username and password: the password is stretched in this
 * browser and only a proof of it is sent, so nobody at the clinic ever sees it.
 * If the code expires or is lost, an administrator issues a new one in person.
 */
export function ActivatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activate, isAuthenticated, isLoading, error, clearError } = usePatientAuthStore();

  useEffect(() => {
    clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard');
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-subtle via-app-bg to-app-bg flex flex-col">
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

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-content mb-2">{t('activate.patientTitle')}</h1>
            <p className="text-content-secondary">{t('activate.patientSubtitle')}</p>
          </div>
          <div className="bg-surface rounded-2xl shadow-card p-8">
            <ActivationForm
              audience="patient"
              isLoading={isLoading}
              error={error}
              onSubmit={({ identifier, code, username, password }) =>
                activate({ identifier, code, username: username ?? '', password })
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
      </main>

      <footer className="p-6 text-center text-sm text-content-secondary">{t('common.copyright')}</footer>
    </div>
  );
}

export default ActivatePage;
