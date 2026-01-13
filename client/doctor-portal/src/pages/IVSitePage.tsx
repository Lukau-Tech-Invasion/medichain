import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createIvSite, getPatients } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  Syringe,
  Droplet,
  AlertTriangle,
  CheckCircle2,
  Save,
  Plus,
  Search,
  User,
  RefreshCw,
  MapPin,
  Eye,
  Activity,
  XCircle,
  History
} from 'lucide-react';

type SiteLocation = 
  | 'right-hand' | 'left-hand' 
  | 'right-forearm' | 'left-forearm'
  | 'right-ac' | 'left-ac'
  | 'right-upper-arm' | 'left-upper-arm'
  | 'right-foot' | 'left-foot'
  | 'right-ej' | 'left-ej'
  | 'other';

type CatheterType = 'peripheral' | 'midline' | 'picc' | 'central';
type CatheterGauge = '14G' | '16G' | '18G' | '20G' | '22G' | '24G';
type SiteCondition = 'clean-dry-intact' | 'redness' | 'swelling' | 'drainage' | 'tenderness' | 'warmth' | 'induration';
type DressingType = 'transparent' | 'gauze' | 'statlock' | 'biopatch';

interface IVSite {
  id: string;
  patientId: string;
  location: SiteLocation;
  locationDetail: string;
  catheterType: CatheterType;
  gauge: CatheterGauge;
  insertedBy: string;
  insertedAt: string;
  expiresAt: string;
  isActive: boolean;
  assessments: IVAssessment[];
  discontinuedAt?: string;
  discontinuedBy?: string;
  discontinuedReason?: string;
}

interface IVAssessment {
  id: string;
  assessedAt: string;
  assessedBy: string;
  conditions: SiteCondition[];
  dressingType: DressingType;
  dressingIntact: boolean;
  flushPatent: boolean;
  bloodReturn: boolean;
  infusing: string;
  infusionRate?: string;
  notes: string;
  phlebitisScore: number;
}

export default function IVSitePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'sites' | 'add-site' | 'assess'>('sites');

  // IV Sites data
  const [ivSites, setIvSites] = useState<IVSite[]>([]);
  const [selectedSite, setSelectedSite] = useState<IVSite | null>(null);
  const [showAssessmentForm, setShowAssessmentForm] = useState(false);

  // New site form
  const [newSite, setNewSite] = useState<Partial<IVSite>>({
    location: 'right-hand',
    locationDetail: '',
    catheterType: 'peripheral',
    gauge: '20G'
  });

  // New assessment form
  const [newAssessment, setNewAssessment] = useState<Partial<IVAssessment>>({
    conditions: ['clean-dry-intact'],
    dressingType: 'transparent',
    dressingIntact: true,
    flushPatent: true,
    bloodReturn: true,
    infusing: '',
    notes: ''
  });

  const locationLabels: Record<SiteLocation, string> = {
    'right-hand': 'Right Hand',
    'left-hand': 'Left Hand',
    'right-forearm': 'Right Forearm',
    'left-forearm': 'Left Forearm',
    'right-ac': 'Right AC (Antecubital)',
    'left-ac': 'Left AC (Antecubital)',
    'right-upper-arm': 'Right Upper Arm',
    'left-upper-arm': 'Left Upper Arm',
    'right-foot': 'Right Foot',
    'left-foot': 'Left Foot',
    'right-ej': 'Right External Jugular',
    'left-ej': 'Left External Jugular',
    'other': 'Other'
  };

  const catheterTypes: Record<CatheterType, string> = {
    'peripheral': 'Peripheral IV (PIV)',
    'midline': 'Midline Catheter',
    'picc': 'PICC Line',
    'central': 'Central Line (CVC)'
  };

  const conditionLabels: Record<SiteCondition, { label: string; severity: 'normal' | 'warning' | 'critical' }> = {
    'clean-dry-intact': { label: 'Clean, Dry & Intact', severity: 'normal' },
    'redness': { label: 'Redness/Erythema', severity: 'warning' },
    'swelling': { label: 'Swelling/Edema', severity: 'warning' },
    'drainage': { label: 'Drainage/Exudate', severity: 'critical' },
    'tenderness': { label: 'Tenderness/Pain', severity: 'warning' },
    'warmth': { label: 'Warmth', severity: 'warning' },
    'induration': { label: 'Induration (Hardness)', severity: 'critical' }
  };

  // Phlebitis scale (VIP Score)
  const phlebitisScores = [
    { score: 0, description: 'No symptoms', action: 'Continue monitoring' },
    { score: 1, description: 'Slight pain or redness near site', action: 'Continue monitoring' },
    { score: 2, description: 'Pain + redness and/or swelling', action: 'Consider reinsertion' },
    { score: 3, description: 'Pain + redness + streak formation', action: 'Resite cannula, consider treatment' },
    { score: 4, description: 'All above + palpable cord', action: 'Resite cannula, initiate treatment' },
    { score: 5, description: 'All above + pyrexia', action: 'Resite cannula, initiate treatment, blood cultures' }
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const patientData = await getPatients();
        setPatients(patientData || []);
        
        const patientId = searchParams.get('patientId');
        if (patientId) {
          const patient = patientData?.find((p: PatientProfile) => p.patient_id === patientId);
          if (patient) {
            setSelectedPatient(patient);
          }
        }
      } catch (err) {
        console.error('Failed to fetch patients', err);
      }
    };
    fetchData();
  }, [searchParams]);

  const filteredPatients = patients.filter(p => 
    p.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.patient_id?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const calculateDaysActive = (insertedAt: string) => {
    const inserted = new Date(insertedAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - inserted.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const isExpiringSoon = (expiresAt: string) => {
    const expires = new Date(expiresAt);
    const now = new Date();
    const diffTime = expires.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return daysRemaining <= 1 && daysRemaining >= 0;
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  const calculateExpiration = (catheterType: CatheterType) => {
    const now = new Date();
    switch (catheterType) {
      case 'peripheral': return new Date(now.setDate(now.getDate() + 4)).toISOString().split('T')[0];
      case 'midline': return new Date(now.setDate(now.getDate() + 28)).toISOString().split('T')[0];
      case 'picc': return new Date(now.setDate(now.getDate() + 90)).toISOString().split('T')[0];
      case 'central': return new Date(now.setDate(now.getDate() + 7)).toISOString().split('T')[0];
    }
  };

  const addNewSite = () => {
    if (!selectedPatient || !newSite.location) return;

    const site: IVSite = {
      id: `IV-${Date.now()}`,
      patientId: selectedPatient.patient_id,
      location: newSite.location,
      locationDetail: newSite.locationDetail || '',
      catheterType: newSite.catheterType || 'peripheral',
      gauge: newSite.gauge || '20G',
      insertedBy: user?.userId || 'Unknown',
      insertedAt: new Date().toISOString(),
      expiresAt: calculateExpiration(newSite.catheterType || 'peripheral'),
      isActive: true,
      assessments: []
    };

    setIvSites(prev => [...prev, site]);
    setNewSite({ location: 'right-hand', locationDetail: '', catheterType: 'peripheral', gauge: '20G' });
    setActiveTab('sites');
    setSuccess('IV site added successfully!');
    setTimeout(() => setSuccess(''), 3000);
  };

  const addAssessment = () => {
    if (!selectedSite) return;

    const assessment: IVAssessment = {
      id: `ASSESS-${Date.now()}`,
      assessedAt: new Date().toISOString(),
      assessedBy: user?.userId || 'Unknown',
      conditions: newAssessment.conditions || ['clean-dry-intact'],
      dressingType: newAssessment.dressingType || 'transparent',
      dressingIntact: newAssessment.dressingIntact ?? true,
      flushPatent: newAssessment.flushPatent ?? true,
      bloodReturn: newAssessment.bloodReturn ?? true,
      infusing: newAssessment.infusing || '',
      infusionRate: newAssessment.infusionRate,
      notes: newAssessment.notes || '',
      phlebitisScore: calculatePhlebitisScore(newAssessment.conditions || [])
    };

    setIvSites(prev => prev.map(site => 
      site.id === selectedSite.id 
        ? { ...site, assessments: [...site.assessments, assessment] }
        : site
    ));

    setShowAssessmentForm(false);
    setNewAssessment({
      conditions: ['clean-dry-intact'],
      dressingType: 'transparent',
      dressingIntact: true,
      flushPatent: true,
      bloodReturn: true,
      infusing: '',
      notes: ''
    });
    setSuccess('Assessment documented!');
    setTimeout(() => setSuccess(''), 3000);
  };

  const calculatePhlebitisScore = (conditions: SiteCondition[]) => {
    if (conditions.includes('clean-dry-intact') && conditions.length === 1) return 0;
    let score = 0;
    if (conditions.includes('tenderness')) score = Math.max(score, 1);
    if (conditions.includes('redness')) score = Math.max(score, 1);
    if (conditions.includes('swelling')) score = Math.max(score, 2);
    if (conditions.includes('warmth')) score = Math.max(score, 2);
    if (conditions.includes('induration')) score = Math.max(score, 3);
    if (conditions.includes('drainage')) score = Math.max(score, 4);
    return score;
  };

  const discontinueSite = (siteId: string, reason: string) => {
    setIvSites(prev => prev.map(site => 
      site.id === siteId 
        ? { 
            ...site, 
            isActive: false, 
            discontinuedAt: new Date().toISOString(),
            discontinuedBy: user?.userId || 'Unknown',
            discontinuedReason: reason
          }
        : site
    ));
  };

  const toggleCondition = (condition: SiteCondition) => {
    const current = newAssessment.conditions || [];
    if (condition === 'clean-dry-intact') {
      setNewAssessment({ ...newAssessment, conditions: ['clean-dry-intact'] });
    } else {
      const filtered = current.filter(c => c !== 'clean-dry-intact');
      if (filtered.includes(condition)) {
        const newConditions = filtered.filter(c => c !== condition);
        setNewAssessment({ ...newAssessment, conditions: newConditions.length ? newConditions : ['clean-dry-intact'] });
      } else {
        setNewAssessment({ ...newAssessment, conditions: [...filtered, condition] });
      }
    }
  };

  const handleSave = async () => {
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    if (ivSites.length === 0) {
      setError('Please add at least one IV site');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const ivSiteData = {
        record_id: `IVSITE-${Date.now()}`,
        patient_id: selectedPatient.patient_id,
        sites: ivSites,
        documented_by: user?.userId || 'unknown',
        documented_at: Math.floor(Date.now() / 1000)
      };

      await createIvSite(ivSiteData);
      setSuccess('IV site records saved successfully!');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to save IV site records. Please try again.');
      console.error('Failed to save IV site records', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeSites = ivSites.filter(s => s.isActive);
  const discontinuedSites = ivSites.filter(s => !s.isActive);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full">
                <Syringe className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">IV Site Management</h1>
                <p className="text-blue-100">Document and monitor intravenous access sites</p>
              </div>
            </div>
            {selectedPatient && (
              <div className="text-right text-white">
                <p className="font-medium">{selectedPatient.full_name}</p>
                <p className="text-sm opacity-75">{selectedPatient.patient_id}</p>
              </div>
            )}
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Patient Selection Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-bold text-gray-900 mb-4 flex items-center">
                <User className="h-5 w-5 mr-2 text-blue-500" />
                Select Patient
              </h2>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search patients..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {filteredPatients.map(patient => (
                  <button
                    key={patient.patient_id}
                    onClick={() => setSelectedPatient(patient)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedPatient?.patient_id === patient.patient_id
                        ? 'bg-blue-100 border-2 border-blue-500'
                        : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{patient.full_name}</p>
                    <p className="text-sm text-gray-500">{patient.patient_id}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Stats */}
            {selectedPatient && (
              <div className="bg-white rounded-lg shadow p-4 mt-4">
                <h3 className="font-bold text-gray-900 mb-3">IV Access Summary</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-2 bg-green-50 rounded">
                    <span className="text-sm text-green-700">Active Sites</span>
                    <span className="font-bold text-green-700">{activeSites.length}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-yellow-50 rounded">
                    <span className="text-sm text-yellow-700">Expiring Soon</span>
                    <span className="font-bold text-yellow-700">
                      {activeSites.filter(s => isExpiringSoon(s.expiresAt)).length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-red-50 rounded">
                    <span className="text-sm text-red-700">Expired</span>
                    <span className="font-bold text-red-700">
                      {activeSites.filter(s => isExpired(s.expiresAt)).length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <span className="text-sm text-gray-700">Discontinued</span>
                    <span className="font-bold text-gray-700">{discontinuedSites.length}</span>
                  </div>
                </div>
              </div>
            )}

            {/* VIP Score Reference */}
            <div className="bg-white rounded-lg shadow p-4 mt-4">
              <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                <Activity className="h-4 w-4 mr-2" />
                VIP Score Reference
              </h3>
              <div className="space-y-1 text-xs">
                {phlebitisScores.map(({ score, description }) => (
                  <div key={score} className={`flex items-center p-1 rounded ${
                    score === 0 ? 'bg-green-50' :
                    score <= 2 ? 'bg-yellow-50' :
                    'bg-red-50'
                  }`}>
                    <span className="font-bold w-6">{score}:</span>
                    <span className="text-gray-600">{description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {selectedPatient ? (
              <div className="bg-white rounded-lg shadow">
                {/* Tabs */}
                <div className="border-b">
                  <div className="flex">
                    {[
                      { id: 'sites', label: 'Active IV Sites', icon: Droplet },
                      { id: 'add-site', label: 'Add New Site', icon: Plus },
                      { id: 'assess', label: 'Site Assessment', icon: Eye }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        className={`flex-1 flex items-center justify-center space-x-2 py-4 px-4 font-medium transition-colors ${
                          activeTab === tab.id
                            ? 'border-b-2 border-blue-500 text-blue-600'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        <tab.icon className="h-5 w-5" />
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-6">
                  {/* Active Sites Tab */}
                  {activeTab === 'sites' && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-6">Active IV Sites</h2>
                      
                      <div className="space-y-4">
                        {activeSites.map(site => {
                          const daysActive = calculateDaysActive(site.insertedAt);
                          const expiringSoon = isExpiringSoon(site.expiresAt);
                          const expired = isExpired(site.expiresAt);
                          const latestAssessment = site.assessments[site.assessments.length - 1];
                          
                          return (
                            <div key={site.id} className={`p-4 rounded-lg border-2 ${
                              expired ? 'border-red-500 bg-red-50' :
                              expiringSoon ? 'border-yellow-500 bg-yellow-50' :
                              'border-green-300 bg-green-50'
                            }`}>
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="flex items-center space-x-3">
                                    <MapPin className="h-5 w-5 text-blue-500" />
                                    <h3 className="font-bold text-gray-900">{locationLabels[site.location]}</h3>
                                    <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
                                      {site.gauge}
                                    </span>
                                    <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700">
                                      {catheterTypes[site.catheterType]}
                                    </span>
                                  </div>
                                  {site.locationDetail && (
                                    <p className="text-sm text-gray-600 ml-8">{site.locationDetail}</p>
                                  )}
                                  <div className="mt-2 ml-8 grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                      <span className="text-gray-500">Inserted:</span>
                                      <span className="ml-2">{new Date(site.insertedAt).toLocaleDateString()}</span>
                                      <span className="ml-2 text-gray-400">({daysActive} days)</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Expires:</span>
                                      <span className={`ml-2 ${expired ? 'text-red-600 font-bold' : expiringSoon ? 'text-yellow-600 font-bold' : ''}`}>
                                        {new Date(site.expiresAt).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">By:</span>
                                      <span className="ml-2">{site.insertedBy}</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Assessments:</span>
                                      <span className="ml-2">{site.assessments.length}</span>
                                    </div>
                                  </div>
                                  {latestAssessment && (
                                    <div className="mt-3 ml-8 p-2 bg-white rounded text-sm">
                                      <p className="text-gray-500 text-xs">Latest Assessment ({new Date(latestAssessment.assessedAt).toLocaleString()}):</p>
                                      <div className="flex items-center space-x-2 mt-1">
                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                          latestAssessment.phlebitisScore === 0 ? 'bg-green-100 text-green-700' :
                                          latestAssessment.phlebitisScore <= 2 ? 'bg-yellow-100 text-yellow-700' :
                                          'bg-red-100 text-red-700'
                                        }`}>
                                          VIP Score: {latestAssessment.phlebitisScore}
                                        </span>
                                        {latestAssessment.conditions.map(c => (
                                          <span key={c} className={`text-xs px-2 py-0.5 rounded ${
                                            conditionLabels[c].severity === 'normal' ? 'bg-green-100 text-green-700' :
                                            conditionLabels[c].severity === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                                            'bg-red-100 text-red-700'
                                          }`}>
                                            {conditionLabels[c].label}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="flex space-x-2">
                                  <button
                                    onClick={() => { setSelectedSite(site); setShowAssessmentForm(true); setActiveTab('assess'); }}
                                    className="p-2 bg-blue-100 text-blue-600 rounded hover:bg-blue-200"
                                    title="Assess Site"
                                  >
                                    <Eye className="h-5 w-5" />
                                  </button>
                                  <button
                                    onClick={() => discontinueSite(site.id, 'Routine change')}
                                    className="p-2 bg-red-100 text-red-600 rounded hover:bg-red-200"
                                    title="Discontinue"
                                  >
                                    <XCircle className="h-5 w-5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {activeSites.length === 0 && (
                          <div className="text-center py-8 text-gray-500">
                            <Syringe className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>No active IV sites.</p>
                            <button
                              onClick={() => setActiveTab('add-site')}
                              className="mt-4 text-blue-600 hover:underline"
                            >
                              Add a new IV site
                            </button>
                          </div>
                        )}
                      </div>

                      {discontinuedSites.length > 0 && (
                        <div className="mt-8">
                          <h3 className="text-lg font-bold text-gray-700 mb-4 flex items-center">
                            <History className="h-5 w-5 mr-2" />
                            Discontinued Sites
                          </h3>
                          <div className="space-y-2">
                            {discontinuedSites.map(site => (
                              <div key={site.id} className="p-3 rounded-lg bg-gray-100 text-gray-600">
                                <div className="flex justify-between items-center">
                                  <div>
                                    <span className="font-medium">{locationLabels[site.location]}</span>
                                    <span className="mx-2">•</span>
                                    <span className="text-sm">{site.gauge} {catheterTypes[site.catheterType]}</span>
                                  </div>
                                  <div className="text-sm">
                                    Discontinued: {new Date(site.discontinuedAt!).toLocaleDateString()}
                                    <span className="ml-2 text-gray-400">({site.discontinuedReason})</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Add Site Tab */}
                  {activeTab === 'add-site' && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-6">Add New IV Site</h2>
                      
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                            <select
                              value={newSite.location}
                              onChange={(e) => setNewSite({ ...newSite, location: e.target.value as SiteLocation })}
                              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                              {Object.entries(locationLabels).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Location Detail</label>
                            <input
                              type="text"
                              value={newSite.locationDetail}
                              onChange={(e) => setNewSite({ ...newSite, locationDetail: e.target.value })}
                              placeholder="e.g., Dorsal vein, 2nd attempt"
                              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Catheter Type</label>
                            <select
                              value={newSite.catheterType}
                              onChange={(e) => setNewSite({ ...newSite, catheterType: e.target.value as CatheterType })}
                              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                              {Object.entries(catheterTypes).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Gauge</label>
                            <div className="flex flex-wrap gap-2">
                              {(['24G', '22G', '20G', '18G', '16G', '14G'] as CatheterGauge[]).map(g => (
                                <button
                                  key={g}
                                  type="button"
                                  onClick={() => setNewSite({ ...newSite, gauge: g })}
                                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                    newSite.gauge === g
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                  }`}
                                >
                                  {g}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="p-4 bg-blue-50 rounded-lg">
                          <h4 className="font-medium text-blue-800 mb-2">Expected Dwell Time</h4>
                          <p className="text-blue-600">
                            {newSite.catheterType === 'peripheral' && 'Peripheral IV: Up to 96 hours (4 days)'}
                            {newSite.catheterType === 'midline' && 'Midline Catheter: Up to 28 days'}
                            {newSite.catheterType === 'picc' && 'PICC Line: Up to 90 days or longer with proper care'}
                            {newSite.catheterType === 'central' && 'Central Line: 7 days recommended, assess daily'}
                          </p>
                        </div>

                        <button
                          onClick={addNewSite}
                          className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 flex items-center justify-center"
                        >
                          <Plus className="h-5 w-5 mr-2" />
                          Add IV Site
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Assessment Tab */}
                  {activeTab === 'assess' && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-6">Site Assessment</h2>

                      {!selectedSite ? (
                        <div>
                          <p className="text-gray-500 mb-4">Select an IV site to assess:</p>
                          <div className="space-y-2">
                            {activeSites.map(site => (
                              <button
                                key={site.id}
                                onClick={() => { setSelectedSite(site); setShowAssessmentForm(true); }}
                                className="w-full text-left p-4 bg-gray-50 rounded-lg hover:bg-gray-100 border"
                              >
                                <div className="flex justify-between items-center">
                                  <div>
                                    <span className="font-medium">{locationLabels[site.location]}</span>
                                    <span className="mx-2 text-gray-400">•</span>
                                    <span className="text-sm text-gray-600">{site.gauge} {catheterTypes[site.catheterType]}</span>
                                  </div>
                                  <span className="text-sm text-gray-500">
                                    {site.assessments.length} assessment(s)
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                          {activeSites.length === 0 && (
                            <div className="text-center py-8 text-gray-500">
                              <Eye className="h-12 w-12 mx-auto mb-2 opacity-50" />
                              <p>No active sites to assess.</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="mb-4 p-4 bg-blue-50 rounded-lg flex justify-between items-center">
                            <div>
                              <h3 className="font-bold text-blue-900">{locationLabels[selectedSite.location]}</h3>
                              <p className="text-sm text-blue-700">{selectedSite.gauge} • {catheterTypes[selectedSite.catheterType]}</p>
                            </div>
                            <button
                              onClick={() => { setSelectedSite(null); setShowAssessmentForm(false); }}
                              className="text-blue-600 hover:underline"
                            >
                              Change Site
                            </button>
                          </div>

                          {showAssessmentForm && (
                            <div className="space-y-6 p-4 bg-gray-50 rounded-lg">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Site Condition</label>
                                <div className="flex flex-wrap gap-2">
                                  {(Object.entries(conditionLabels) as [SiteCondition, { label: string; severity: string }][]).map(([key, { label, severity }]) => (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => toggleCondition(key)}
                                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                        newAssessment.conditions?.includes(key)
                                          ? severity === 'normal' ? 'bg-green-600 text-white' :
                                            severity === 'warning' ? 'bg-yellow-500 text-white' :
                                            'bg-red-600 text-white'
                                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Dressing Type</label>
                                  <select
                                    value={newAssessment.dressingType}
                                    onChange={(e) => setNewAssessment({ ...newAssessment, dressingType: e.target.value as DressingType })}
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                  >
                                    <option value="transparent">Transparent (Tegaderm)</option>
                                    <option value="gauze">Gauze</option>
                                    <option value="statlock">StatLock</option>
                                    <option value="biopatch">BioPatch</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Dressing Intact?</label>
                                  <div className="flex space-x-4">
                                    <label className="flex items-center space-x-2">
                                      <input
                                        type="radio"
                                        checked={newAssessment.dressingIntact === true}
                                        onChange={() => setNewAssessment({ ...newAssessment, dressingIntact: true })}
                                      />
                                      <span>Yes</span>
                                    </label>
                                    <label className="flex items-center space-x-2">
                                      <input
                                        type="radio"
                                        checked={newAssessment.dressingIntact === false}
                                        onChange={() => setNewAssessment({ ...newAssessment, dressingIntact: false })}
                                      />
                                      <span>No</span>
                                    </label>
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Flushes Patent?</label>
                                  <div className="flex space-x-4">
                                    <label className="flex items-center space-x-2">
                                      <input
                                        type="radio"
                                        checked={newAssessment.flushPatent === true}
                                        onChange={() => setNewAssessment({ ...newAssessment, flushPatent: true })}
                                      />
                                      <span>Yes</span>
                                    </label>
                                    <label className="flex items-center space-x-2">
                                      <input
                                        type="radio"
                                        checked={newAssessment.flushPatent === false}
                                        onChange={() => setNewAssessment({ ...newAssessment, flushPatent: false })}
                                      />
                                      <span>No</span>
                                    </label>
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Blood Return?</label>
                                  <div className="flex space-x-4">
                                    <label className="flex items-center space-x-2">
                                      <input
                                        type="radio"
                                        checked={newAssessment.bloodReturn === true}
                                        onChange={() => setNewAssessment({ ...newAssessment, bloodReturn: true })}
                                      />
                                      <span>Yes</span>
                                    </label>
                                    <label className="flex items-center space-x-2">
                                      <input
                                        type="radio"
                                        checked={newAssessment.bloodReturn === false}
                                        onChange={() => setNewAssessment({ ...newAssessment, bloodReturn: false })}
                                      />
                                      <span>No</span>
                                    </label>
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Currently Infusing</label>
                                  <input
                                    type="text"
                                    value={newAssessment.infusing}
                                    onChange={(e) => setNewAssessment({ ...newAssessment, infusing: e.target.value })}
                                    placeholder="e.g., NS, LR, D5W, Medication"
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Infusion Rate</label>
                                  <input
                                    type="text"
                                    value={newAssessment.infusionRate}
                                    onChange={(e) => setNewAssessment({ ...newAssessment, infusionRate: e.target.value })}
                                    placeholder="e.g., 125 mL/hr"
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                                <textarea
                                  value={newAssessment.notes}
                                  onChange={(e) => setNewAssessment({ ...newAssessment, notes: e.target.value })}
                                  rows={2}
                                  placeholder="Additional observations..."
                                  className="w-full p-3 border border-gray-300 rounded-lg"
                                />
                              </div>

                              <div className="p-4 bg-white rounded border">
                                <p className="text-sm font-medium text-gray-700 mb-1">Calculated VIP Score:</p>
                                <div className="flex items-center space-x-4">
                                  <span className={`text-2xl font-bold ${
                                    calculatePhlebitisScore(newAssessment.conditions || []) === 0 ? 'text-green-600' :
                                    calculatePhlebitisScore(newAssessment.conditions || []) <= 2 ? 'text-yellow-600' :
                                    'text-red-600'
                                  }`}>
                                    {calculatePhlebitisScore(newAssessment.conditions || [])}
                                  </span>
                                  <span className="text-gray-500">
                                    {phlebitisScores[calculatePhlebitisScore(newAssessment.conditions || [])]?.action}
                                  </span>
                                </div>
                              </div>

                              <button
                                onClick={addAssessment}
                                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 flex items-center justify-center"
                              >
                                <CheckCircle2 className="h-5 w-5 mr-2" />
                                Save Assessment
                              </button>
                            </div>
                          )}

                          {/* Assessment History */}
                          {selectedSite.assessments.length > 0 && (
                            <div className="mt-6">
                              <h4 className="font-medium text-gray-700 mb-3">Assessment History</h4>
                              <div className="space-y-2">
                                {[...selectedSite.assessments].reverse().map(a => (
                                  <div key={a.id} className="p-3 bg-white rounded border text-sm">
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <p className="text-gray-500">{new Date(a.assessedAt).toLocaleString()} by {a.assessedBy}</p>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {a.conditions.map(c => (
                                            <span key={c} className={`text-xs px-2 py-0.5 rounded ${
                                              conditionLabels[c].severity === 'normal' ? 'bg-green-100 text-green-700' :
                                              conditionLabels[c].severity === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-red-100 text-red-700'
                                            }`}>
                                              {conditionLabels[c].label}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                                        a.phlebitisScore === 0 ? 'bg-green-100 text-green-700' :
                                        a.phlebitisScore <= 2 ? 'bg-yellow-100 text-yellow-700' :
                                        'bg-red-100 text-red-700'
                                      }`}>
                                        VIP: {a.phlebitisScore}
                                      </span>
                                    </div>
                                    {a.notes && <p className="mt-2 text-gray-600">{a.notes}</p>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Save Button */}
                <div className="p-4 border-t bg-gray-50 flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={isSubmitting || ivSites.length === 0}
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="animate-spin h-4 w-4 mr-2" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save All IV Records
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <Syringe className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl font-bold text-gray-700 mb-2">Select a Patient</h2>
                <p className="text-gray-500">Choose a patient from the list to manage their IV sites.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
