import { useState } from 'react';
import { useTranslation } from '@medichain/shared';
import { NFCTapSimulator, EmergencyPatientCard } from '../components';
import { usePatientStore } from '../store';
import { AlertTriangle, Shield, Clock, FileText } from 'lucide-react';

/**
 * EmergencyAccessPage - Core feature for hackathon demo
 * 
 * Allows healthcare providers to quickly access patient emergency info
 * via NFC tap, QR code scan, or manual ID entry.
 */
function EmergencyAccessPage() {
  const { t } = useTranslation();
  const { currentEmergency, clearEmergencyAccess } = usePatientStore();
  const [accessGrantedAt, setAccessGrantedAt] = useState<Date | null>(null);

  const handleEmergencyAccess = (info: { patientId: string; emergencyInfo: any }) => {
    // Use the info parameter to log the access
    console.log('Emergency access granted for patient:', info.patientId);
    setAccessGrantedAt(new Date());
  };

  const handleClearAccess = () => {
    clearEmergencyAccess();
    setAccessGrantedAt(null);
  };

  // Calculate time remaining (15 minute window)
  const getTimeRemaining = () => {
    if (!accessGrantedAt) return null;
    const elapsed = Date.now() - accessGrantedAt.getTime();
    const remaining = 15 * 60 * 1000 - elapsed; // 15 minutes
    if (remaining <= 0) return t('docEmergencyAccess.expired');
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-emergency-100 rounded-lg flex items-center justify-center">
            <AlertTriangle className="text-emergency-600" size={24} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('docEmergencyAccess.title')}</h1>
        </div>
        <p className="text-gray-500">
          {t('docEmergencyAccess.subtitle')}
        </p>
      </div>

      {/* Security Notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8">
        <div className="flex items-start gap-3">
          <Shield className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-medium text-amber-800">{t('docEmergencyAccess.securityTitle')}</p>
            <p className="text-sm text-amber-700 mt-1">
              {t('docEmergencyAccess.securityBody')}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - NFC Simulator */}
        <div>
          <NFCTapSimulator onEmergencyAccess={handleEmergencyAccess} />
        </div>

        {/* Right Column - Patient Info or Instructions */}
        <div>
          {currentEmergency ? (
            <div className="space-y-4">
              {/* Access Timer */}
              <div className="bg-white rounded-xl shadow p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="text-primary-600" size={20} />
                    <span className="font-medium text-gray-700">{t('docEmergencyAccess.timeRemaining')}</span>
                  </div>
                  <span className="text-2xl font-mono font-bold text-primary-600">
                    {getTimeRemaining()}
                  </span>
                </div>
              </div>

              {/* Emergency Patient Card */}
              <EmergencyPatientCard
                patient={currentEmergency}
                showFullDetails={true}
              />

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handleClearAccess}
                  className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                >
                  {t('docEmergencyAccess.endAccess')}
                </button>
                <button
                  className="flex-1 py-3 px-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center justify-center gap-2"
                >
                  <FileText size={18} />
                  {t('docEmergencyAccess.viewRecords')}
                </button>
              </div>
            </div>
          ) : (
            /* Instructions when no patient loaded */
            <div className="bg-white rounded-xl shadow p-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {t('docEmergencyAccess.howToTitle')}
              </h3>
              
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="font-bold text-primary-600">1</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{t('docEmergencyAccess.step1Title')}</p>
                    <p className="text-sm text-gray-500">
                      {t('docEmergencyAccess.step1Body')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="font-bold text-primary-600">2</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{t('docEmergencyAccess.step2Title')}</p>
                    <p className="text-sm text-gray-500">
                      {t('docEmergencyAccess.step2Body')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="font-bold text-primary-600">3</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{t('docEmergencyAccess.step3Title')}</p>
                    <p className="text-sm text-gray-500">
                      {t('docEmergencyAccess.step3Body')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">
                  <strong>{t('docEmergencyAccess.noteLabel')}</strong> {t('docEmergencyAccess.noteBody')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EmergencyAccessPage;
