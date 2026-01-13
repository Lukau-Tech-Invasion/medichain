import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { apiUrl } from '@medichain/shared';
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
        code_blue: `${apiUrl}/api/clinical/code-blue/${patientId}`,
        trauma: `${apiUrl}/api/clinical/trauma/${patientId}`,
        stroke: `${apiUrl}/api/clinical/stroke/${patientId}`,
        cardiac: `${apiUrl}/api/clinical/cardiac-arrest/${patientId}`,
        sepsis: `${apiUrl}/api/clinical/sepsis/${patientId}`,
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
    { id: 'code_blue' as EmergencyType, label: 'Code Blue', icon: Siren, color: 'text-blue-600' },
    { id: 'trauma' as EmergencyType, label: 'Trauma', icon: AlertCircle, color: 'text-orange-600' },
    { id: 'stroke' as EmergencyType, label: 'Stroke', icon: Brain, color: 'text-purple-600' },
    { id: 'cardiac' as EmergencyType, label: 'Cardiac Arrest', icon: Heart, color: 'text-red-600' },
    { id: 'sepsis' as EmergencyType, label: 'Sepsis', icon: Flame, color: 'text-yellow-600' },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link to={`/patients/${patientId}`} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronLeft size={24} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Emergency Protocols</h1>
            <p className="text-gray-500 mt-1">Patient ID: {patientId}</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-6 py-3 bg-emergency-600 text-white rounded-lg hover:bg-emergency-700 transition-colors flex items-center gap-2"
        >
          <Plus size={20} />
          New Emergency Record
        </button>
      </div>

      {/* Emergency Type Tabs */}
      <div className="bg-white rounded-xl shadow mb-6">
        <div className="flex border-b border-gray-200 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-b-2 border-emergency-600 text-emergency-600'
                    : 'text-gray-500 hover:text-gray-700'
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
            <div key={record.code_blue_id} className="bg-white rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-100 rounded-lg">
                    <Siren className="text-blue-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Code Blue</h3>
                    <p className="text-sm text-gray-500">ID: {record.code_blue_id}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock size={16} />
                    {formatTimestamp(record.initiated_at)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                    <User size={16} />
                    {record.initiated_by}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <span className="text-sm font-medium text-gray-700">Location:</span>
                  <p className="text-gray-900">{record.location}</p>
                </div>
                {record.initial_rhythm && (
                  <div>
                    <span className="text-sm font-medium text-gray-700">Initial Rhythm:</span>
                    <p className="text-gray-900">{record.initial_rhythm}</p>
                  </div>
                )}
                {record.outcome && (
                  <div>
                    <span className="text-sm font-medium text-gray-700">Outcome:</span>
                    <p className={`font-semibold ${
                      record.outcome.toLowerCase().includes('rosc') ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {record.outcome}
                    </p>
                  </div>
                )}
              </div>

              {record.interventions && record.interventions.length > 0 && (
                <div className="mb-4">
                  <span className="text-sm font-medium text-gray-700">Interventions:</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {record.interventions.map((intervention, idx) => (
                      <span key={idx} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                        {intervention}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {record.notes && (
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <span className="text-sm font-medium text-gray-700">Notes:</span>
                  <p className="text-gray-700 mt-2">{record.notes}</p>
                </div>
              )}
            </div>
          ))}
          {codeBlueRecords.length === 0 && !loading && (
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <Siren className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-gray-500">No Code Blue records found</p>
            </div>
          )}
        </div>
      )}

      {/* Trauma Records */}
      {activeTab === 'trauma' && (
        <div className="space-y-4">
          {traumaRecords.map((record) => (
            <div key={record.trauma_id} className="bg-white rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-orange-100 rounded-lg">
                    <AlertCircle className="text-orange-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Trauma Assessment</h3>
                    <p className="text-sm text-gray-500">Level {record.trauma_level}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock size={16} />
                    {formatTimestamp(record.assessed_at)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                    <User size={16} />
                    {record.assessed_by}
                  </div>
                </div>
              </div>
              
              <div className="mb-4">
                <span className="text-sm font-medium text-gray-700">Mechanism of Injury:</span>
                <p className="text-gray-900 mt-1">{record.mechanism_of_injury}</p>
              </div>

              {record.injuries && record.injuries.length > 0 && (
                <div className="mb-4">
                  <span className="text-sm font-medium text-gray-700">Injuries:</span>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    {record.injuries.map((injury, idx) => (
                      <li key={idx} className="text-gray-700">{injury}</li>
                    ))}
                  </ul>
                </div>
              )}

              {record.interventions && record.interventions.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-gray-700">Interventions:</span>
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
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <AlertCircle className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-gray-500">No trauma assessments found</p>
            </div>
          )}
        </div>
      )}

      {/* Stroke Records */}
      {activeTab === 'stroke' && (
        <div className="space-y-4">
          {strokeRecords.map((record) => (
            <div key={record.stroke_id} className="bg-white rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-100 rounded-lg">
                    <Brain className="text-purple-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Stroke Assessment</h3>
                    {record.nihss_score !== undefined && (
                      <p className="text-sm text-gray-500">NIHSS: {record.nihss_score}</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock size={16} />
                    {formatTimestamp(record.assessed_at)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                    <User size={16} />
                    {record.assessed_by}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <span className="text-sm font-medium text-gray-700">Last Known Normal:</span>
                  <p className="text-gray-900">{formatTimestamp(record.last_known_normal)}</p>
                </div>
                {record.stroke_type && (
                  <div>
                    <span className="text-sm font-medium text-gray-700">Stroke Type:</span>
                    <p className="text-gray-900">{record.stroke_type}</p>
                  </div>
                )}
                <div>
                  <span className="text-sm font-medium text-gray-700">tPA Given:</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
                    record.tpa_given ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {record.tpa_given ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {strokeRecords.length === 0 && !loading && (
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <Brain className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-gray-500">No stroke assessments found</p>
            </div>
          )}
        </div>
      )}

      {/* Cardiac Arrest Records */}
      {activeTab === 'cardiac' && (
        <div className="space-y-4">
          {cardiacRecords.map((record) => (
            <div key={record.protocol_id} className="bg-white rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-red-100 rounded-lg">
                    <Heart className="text-red-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Cardiac Arrest Protocol</h3>
                    <p className="text-sm text-gray-500">ID: {record.protocol_id}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock size={16} />
                    {formatTimestamp(record.started_at)}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="text-sm font-medium text-gray-700">CPR Started:</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ml-2 ${
                    record.cpr_started ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {record.cpr_started ? 'Yes' : 'No'}
                  </span>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-700">Defibrillation Shocks:</span>
                  <p className="text-gray-900 font-semibold">{record.defib_shocks}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-700">ROSC Achieved:</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ml-2 ${
                    record.rosc_achieved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {record.rosc_achieved ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>

              {record.medications_given && record.medications_given.length > 0 && (
                <div className="mt-4">
                  <span className="text-sm font-medium text-gray-700">Medications Given:</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {record.medications_given.map((med, idx) => (
                      <span key={idx} className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
                        {med}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {cardiacRecords.length === 0 && !loading && (
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <Heart className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-gray-500">No cardiac arrest protocols found</p>
            </div>
          )}
        </div>
      )}

      {/* Sepsis Records */}
      {activeTab === 'sepsis' && (
        <div className="space-y-4">
          {sepsisRecords.map((record) => (
            <div key={record.sepsis_id} className="bg-white rounded-xl shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-yellow-100 rounded-lg">
                    <Flame className="text-yellow-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Sepsis Assessment</h3>
                    <p className="text-sm text-gray-500">qSOFA: {record.qsofa_score}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock size={16} />
                    {formatTimestamp(record.assessed_at)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                    <User size={16} />
                    {record.assessed_by}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                {record.lactate_level !== undefined && (
                  <div>
                    <span className="text-sm font-medium text-gray-700">Lactate Level:</span>
                    <p className={`font-semibold ${record.lactate_level > 2 ? 'text-red-600' : 'text-green-600'}`}>
                      {record.lactate_level} mmol/L
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-sm font-medium text-gray-700">Antibiotics Given:</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ml-2 ${
                    record.antibiotics_given ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {record.antibiotics_given ? 'Yes' : 'No'}
                  </span>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-700">Fluid Resuscitation:</span>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ml-2 ${
                    record.fluid_resuscitation ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {record.fluid_resuscitation ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {sepsisRecords.length === 0 && !loading && (
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <Flame className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-gray-500">No sepsis assessments found</p>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-xl shadow p-12 text-center">
          <Activity className="mx-auto mb-3 text-primary-500 animate-spin" size={48} />
          <p className="text-gray-500">Loading emergency records...</p>
        </div>
      )}
    </div>
  );
}

export default EmergencyProtocolsPage;
