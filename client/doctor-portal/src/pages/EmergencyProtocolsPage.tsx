import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { apiUrl, useTranslation } from '@medichain/shared';
import { 
  AlertCircle, 
  Activity, 
  Heart, 
  Brain, 
  Flame, 
  Siren, 
  ChevronLeft, 
  Plus,
  Clock,
  User
} from 'lucide-react';

interface CodeBlueRecord {
  code_blue_id: string;
  patient_id: string;
  initiated_at: number;
  initiated_by: string;
  location: string;
  initial_rhythm?: string;
  interventions: string[];
  outcome?: string;
  notes?: string;
}

interface TraumaAssessment {
  trauma_id: string;
  patient_id: string;
  assessed_at: number;
  assessed_by: string;
  mechanism_of_injury: string;
  trauma_level: number;
  injuries: string[];
  interventions: string[];
}

interface StrokeAssessment {
  stroke_id: string;
  patient_id: string;
  assessed_at: number;
  assessed_by: string;
  last_known_normal: number;
  nihss_score?: number;
  stroke_type?: string;
  tpa_given: boolean;
}

interface CardiacArrestProtocol {
  protocol_id: string;
  patient_id: string;
  started_at: number;
  cpr_started: boolean;
  defib_shocks: number;
  medications_given: string[];
  rosc_achieved: boolean;
}

interface SepsisAssessment {
  sepsis_id: string;
  patient_id: string;
  assessed_at: number;
  assessed_by: string;
  qsofa_score: number;
  lactate_level?: number;
  antibiotics_given: boolean;
  fluid_resuscitation: boolean;
}

type EmergencyType = 'code_blue' | 'trauma' | 'stroke' | 'cardiac' | 'sepsis';

function EmergencyProtocolsPage() {
  const { t } = useTranslation();
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [activeTab, setActiveTab] = useState<EmergencyType>('code_blue');
  const [codeBlueRecords, setCodeBlueRecords] = useState<CodeBlueRecord[]>([]);
  const [traumaRecords, setTraumaRecords] = useState<TraumaAssessment[]>([]);
  const [strokeRecords, setStrokeRecords] = useState<StrokeAssessment[]>([]);
  const [cardiacRecords, setCardiacRecords] = useState<CardiacArrestProtocol[]>([]);
  const [sepsisRecords, setSepsisRecords] = useState<SepsisAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (user) {
      fetchEmergencyRecords();
    }
  }, [patientId, activeTab, user]);

  const fetchEmergencyRecords = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const endpoints: Record<EmergencyType, string> = {
        code_blue: apiUrl(`/api/emergency/code-blue/patient/${patientId}`),
        trauma: apiUrl(`/api/emergency/trauma/patient/${patientId}`),
        stroke: apiUrl(`/api/emergency/stroke/patient/${patientId}`),
        cardiac: apiUrl(`/api/emergency/cardiac/patient/${patientId}`),
        sepsis: apiUrl(`/api/emergency/sepsis/patient/${patientId}`),
      };

      const response = await fetch(endpoints[activeTab], {
        headers: { 
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });

      if (response.ok) {
        const data = await response.json();
        
        switch (activeTab) {
          case 'code_blue':
            setCodeBlueRecords(Array.isArray(data) ? data : [data]);
            break;
          case 'trauma':
            setTraumaRecords(Array.isArray(data) ? data : [data]);
            break;
          case 'stroke':
            setStrokeRecords(Array.isArray(data) ? data : [data]);
            break;
          case 'cardiac':
            setCardiacRecords(Array.isArray(data) ? data : [data]);
            break;
          case 'sepsis':
            setSepsisRecords(Array.isArray(data) ? data : [data]);
            break;
        }
      }
    } catch (err) {
      console.error('Failed to fetch emergency records:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const tabs = [
    { id: 'code_blue' as EmergencyType, label: t('docEmergProto.tabCodeBlue'), icon: Siren, color: 'text-notice-subtle-fg' },
    { id: 'trauma' as EmergencyType, label: t('docEmergProto.tabTrauma'), icon: AlertCircle, color: 'text-orange-600' },
    { id: 'stroke' as EmergencyType, label: t('docEmergProto.tabStroke'), icon: Brain, color: 'text-purple-600' },
    { id: 'cardiac' as EmergencyType, label: t('docEmergProto.tabCardiac'), icon: Heart, color: 'text-critical-subtle-fg' },
    { id: 'sepsis' as EmergencyType, label: t('docEmergProto.tabSepsis'), icon: Flame, color: 'text-caution-subtle-fg' },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link to={`/patients/${patientId}`} className="p-2 hover:bg-surface-sunken rounded-lg transition-colors">
            <ChevronLeft size={24} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-content">{t('docEmergProto.title')}</h1>
            <p className="text-content-muted mt-1">{t('docEmergProto.patientId', { id: patientId ?? '' })}</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-6 py-3 bg-emergency-600 text-white rounded-lg hover:bg-emergency-700 transition-colors flex items-center gap-2"
        >
          <Plus size={20} />
          {t('docEmergProto.newRecord')}
        </button>
      </div>

      {/* Emergency Type Tabs */}
      <div className="bg-surface rounded-xl shadow mb-6">
        <div className="flex border-b border-border overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-b-2 border-emergency-600 text-emergency-600'
                    : 'text-content-muted hover:text-content-secondary'
                }`}
              >
                <Icon size={20} className={activeTab === tab.id ? tab.color : ''} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Code Blue Records */}
      {activeTab === 'code_blue' && (
        <div className="space-y-4">
          {codeBlueRecords.map((record) => (
            <div key={record.code_blue_id} className="bg-surface rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-notice-subtle rounded-lg">
                    <Siren className="text-notice-subtle-fg" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{t('docEmergProto.codeBlue')}</h3>
                    <p className="text-sm text-content-muted">{t('docEmergProto.idLabel', { id: record.code_blue_id })}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-content-muted">
                    <Clock size={16} />
                    {formatTimestamp(record.initiated_at)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-content-muted mt-1">
                    <User size={16} />
                    {record.initiated_by}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.location')}</span>
                  <p className="text-content">{record.location}</p>
                </div>
                {record.initial_rhythm && (
                  <div>
                    <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.initialRhythm')}</span>
                    <p className="text-content">{record.initial_rhythm}</p>
                  </div>
                )}
                {record.outcome && (
                  <div>
                    <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.outcome')}</span>
                    <p className={`font-semibold ${
                      record.outcome.toLowerCase().includes('rosc') ? 'text-ok-subtle-fg' : 'text-critical-subtle-fg'
                    }`}>
                      {record.outcome}
                    </p>
                  </div>
                )}
              </div>

              {record.interventions && record.interventions.length > 0 && (
                <div className="mb-4">
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.interventions')}</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {record.interventions.map((intervention, idx) => (
                      <span key={idx} className="px-3 py-1 bg-notice-subtle text-notice-subtle-fg rounded-full text-sm">
                        {intervention}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {record.notes && (
                <div className="border-t border-border pt-4 mt-4">
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.notes')}</span>
                  <p className="text-content-secondary mt-2">{record.notes}</p>
                </div>
              )}
            </div>
          ))}
          {codeBlueRecords.length === 0 && !loading && (
            <div className="bg-surface rounded-xl shadow p-12 text-center">
              <Siren className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-content-muted">{t('docEmergProto.noCodeBlue')}</p>
            </div>
          )}
        </div>
      )}

      {/* Trauma Records */}
      {activeTab === 'trauma' && (
        <div className="space-y-4">
          {traumaRecords.map((record) => (
            <div key={record.trauma_id} className="bg-surface rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-orange-100 rounded-lg">
                    <AlertCircle className="text-orange-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{t('docEmergProto.traumaAssessment')}</h3>
                    <p className="text-sm text-content-muted">{t('docEmergProto.level', { level: record.trauma_level })}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-content-muted">
                    <Clock size={16} />
                    {formatTimestamp(record.assessed_at)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-content-muted mt-1">
                    <User size={16} />
                    {record.assessed_by}
                  </div>
                </div>
              </div>
              
              <div className="mb-4">
                <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.mechanism')}</span>
                <p className="text-content mt-1">{record.mechanism_of_injury}</p>
              </div>

              {record.injuries && record.injuries.length > 0 && (
                <div className="mb-4">
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.injuries')}</span>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    {record.injuries.map((injury, idx) => (
                      <li key={idx} className="text-content-secondary">{injury}</li>
                    ))}
                  </ul>
                </div>
              )}

              {record.interventions && record.interventions.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.interventions')}</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {record.interventions.map((intervention, idx) => (
                      <span key={idx} className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm">
                        {intervention}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {traumaRecords.length === 0 && !loading && (
            <div className="bg-surface rounded-xl shadow p-12 text-center">
              <AlertCircle className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-content-muted">{t('docEmergProto.noTrauma')}</p>
            </div>
          )}
        </div>
      )}

      {/* Stroke Records */}
      {activeTab === 'stroke' && (
        <div className="space-y-4">
          {strokeRecords.map((record) => (
            <div key={record.stroke_id} className="bg-surface rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-100 rounded-lg">
                    <Brain className="text-purple-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{t('docEmergProto.strokeAssessment')}</h3>
                    {record.nihss_score !== undefined && (
                      <p className="text-sm text-content-muted">{t('docEmergProto.nihss', { score: record.nihss_score })}</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-content-muted">
                    <Clock size={16} />
                    {formatTimestamp(record.assessed_at)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-content-muted mt-1">
                    <User size={16} />
                    {record.assessed_by}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.lastKnownNormal')}</span>
                  <p className="text-content">{formatTimestamp(record.last_known_normal)}</p>
                </div>
                {record.stroke_type && (
                  <div>
                    <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.strokeType')}</span>
                    <p className="text-content">{record.stroke_type}</p>
                  </div>
                )}
                <div>
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.tpaGiven')}</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
                    record.tpa_given ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-surface-sunken text-content-secondary'
                  }`}>
                    {record.tpa_given ? t('docEmergProto.yes') : t('docEmergProto.no')}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {strokeRecords.length === 0 && !loading && (
            <div className="bg-surface rounded-xl shadow p-12 text-center">
              <Brain className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-content-muted">{t('docEmergProto.noStroke')}</p>
            </div>
          )}
        </div>
      )}

      {/* Cardiac Arrest Records */}
      {activeTab === 'cardiac' && (
        <div className="space-y-4">
          {cardiacRecords.map((record) => (
            <div key={record.protocol_id} className="bg-surface rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-critical-subtle rounded-lg">
                    <Heart className="text-critical-subtle-fg" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{t('docEmergProto.cardiacProtocol')}</h3>
                    <p className="text-sm text-content-muted">{t('docEmergProto.idLabel', { id: record.protocol_id })}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-content-muted">
                    <Clock size={16} />
                    {formatTimestamp(record.started_at)}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.cprStarted')}</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ml-2 ${
                    record.cpr_started ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-surface-sunken text-content-secondary'
                  }`}>
                    {record.cpr_started ? t('docEmergProto.yes') : t('docEmergProto.no')}
                  </span>
                </div>
                <div>
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.defibShocks')}</span>
                  <p className="text-content font-semibold">{record.defib_shocks}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.roscAchieved')}</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ml-2 ${
                    record.rosc_achieved ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-critical-subtle text-critical-subtle-fg'
                  }`}>
                    {record.rosc_achieved ? t('docEmergProto.yes') : t('docEmergProto.no')}
                  </span>
                </div>
              </div>

              {record.medications_given && record.medications_given.length > 0 && (
                <div className="mt-4">
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.medicationsGiven')}</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {record.medications_given.map((med, idx) => (
                      <span key={idx} className="px-3 py-1 bg-critical-subtle text-critical-subtle-fg rounded-full text-sm">
                        {med}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {cardiacRecords.length === 0 && !loading && (
            <div className="bg-surface rounded-xl shadow p-12 text-center">
              <Heart className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-content-muted">{t('docEmergProto.noCardiac')}</p>
            </div>
          )}
        </div>
      )}

      {/* Sepsis Records */}
      {activeTab === 'sepsis' && (
        <div className="space-y-4">
          {sepsisRecords.map((record) => (
            <div key={record.sepsis_id} className="bg-surface rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-caution-subtle rounded-lg">
                    <Flame className="text-caution-subtle-fg" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{t('docEmergProto.sepsisAssessment')}</h3>
                    <p className="text-sm text-content-muted">{t('docEmergProto.qsofa', { score: record.qsofa_score })}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-content-muted">
                    <Clock size={16} />
                    {formatTimestamp(record.assessed_at)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-content-muted mt-1">
                    <User size={16} />
                    {record.assessed_by}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                {record.lactate_level !== undefined && (
                  <div>
                    <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.lactateLevel')}</span>
                    <p className={`font-semibold ${record.lactate_level > 2 ? 'text-critical-subtle-fg' : 'text-ok-subtle-fg'}`}>
                      {t('docEmergProto.lactateValue', { value: record.lactate_level })}
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.antibioticsGiven')}</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ml-2 ${
                    record.antibiotics_given ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-critical-subtle text-critical-subtle-fg'
                  }`}>
                    {record.antibiotics_given ? t('docEmergProto.yes') : t('docEmergProto.no')}
                  </span>
                </div>
                <div>
                  <span className="text-sm font-medium text-content-secondary">{t('docEmergProto.fluidResuscitation')}</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ml-2 ${
                    record.fluid_resuscitation ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-critical-subtle text-critical-subtle-fg'
                  }`}>
                    {record.fluid_resuscitation ? t('docEmergProto.yes') : t('docEmergProto.no')}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {sepsisRecords.length === 0 && !loading && (
            <div className="bg-surface rounded-xl shadow p-12 text-center">
              <Flame className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-content-muted">{t('docEmergProto.noSepsis')}</p>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="bg-surface rounded-xl shadow p-12 text-center">
          <Activity className="mx-auto mb-3 text-primary-500 animate-spin" size={48} />
          <p className="text-content-muted">{t('docEmergProto.loading')}</p>
        </div>
      )}
    </div>
  );
}

export default EmergencyProtocolsPage;
