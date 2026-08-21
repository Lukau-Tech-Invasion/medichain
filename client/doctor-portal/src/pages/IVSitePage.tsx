import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createIvSite, getPatients, apiUrl, useTranslation } from '@medichain/shared';
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
type SiteCondition =
  | 'clean-dry-intact'
  | 'redness'
  | 'swelling'
  | 'drainage'
  | 'tenderness'
  | 'warmth'
  | 'induration'
  // Infiltration signs. The site assessment previously offered only the
  // inflammatory signs that drive the VIP phlebitis score, so a leaking
  // cannula presented as 'swelling' — which the score reads as phlebitis
  // grade 2. Coolness and blanching are what separate the two, and they had
  // nowhere to be recorded.
  | 'coolness'
  | 'blanching'
  | 'leakage';
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
  infiltrationGrade: number;
}

export default function IVSitePage() {
  const { t } = useTranslation();
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
    'right-hand': t('docIVSite.location_right-hand'),
    'left-hand': t('docIVSite.location_left-hand'),
    'right-forearm': t('docIVSite.location_right-forearm'),
    'left-forearm': t('docIVSite.location_left-forearm'),
    'right-ac': t('docIVSite.location_right-ac'),
    'left-ac': t('docIVSite.location_left-ac'),
    'right-upper-arm': t('docIVSite.location_right-upper-arm'),
    'left-upper-arm': t('docIVSite.location_left-upper-arm'),
    'right-foot': t('docIVSite.location_right-foot'),
    'left-foot': t('docIVSite.location_left-foot'),
    'right-ej': t('docIVSite.location_right-ej'),
    'left-ej': t('docIVSite.location_left-ej'),
    'other': t('docIVSite.location_other')
  };

  const catheterTypes: Record<CatheterType, string> = {
    'peripheral': t('docIVSite.catheter_peripheral'),
    'midline': t('docIVSite.catheter_midline'),
    'picc': t('docIVSite.catheter_picc'),
    'central': t('docIVSite.catheter_central')
  };

  const conditionLabels: Record<SiteCondition, { label: string; severity: 'normal' | 'warning' | 'critical' }> = {
    'clean-dry-intact': { label: t('docIVSite.condition_clean-dry-intact'), severity: 'normal' },
    'redness': { label: t('docIVSite.condition_redness'), severity: 'warning' },
    'swelling': { label: t('docIVSite.condition_swelling'), severity: 'warning' },
    'drainage': { label: t('docIVSite.condition_drainage'), severity: 'critical' },
    'tenderness': { label: t('docIVSite.condition_tenderness'), severity: 'warning' },
    'warmth': { label: t('docIVSite.condition_warmth'), severity: 'warning' },
    'induration': { label: t('docIVSite.condition_induration'), severity: 'critical' },
    'coolness': { label: t('docIVSite.condition_coolness'), severity: 'warning' },
    'blanching': { label: t('docIVSite.condition_blanching'), severity: 'warning' },
    'leakage': { label: t('docIVSite.condition_leakage'), severity: 'critical' }
  };

  /**
   * INS Infiltration Scale (0–4).
   *
   * Graded by the clinician rather than derived from the condition flags: the
   * grade turns on the measured extent of oedema (<1 inch, 1–6 inches, >6
   * inches), which no checkbox records. Deriving it from flags would invent a
   * measurement nobody took.
   */
  const infiltrationGrades = [
    { grade: 0, description: t('docIVSite.infiltrationDesc_0') },
    { grade: 1, description: t('docIVSite.infiltrationDesc_1') },
    { grade: 2, description: t('docIVSite.infiltrationDesc_2') },
    { grade: 3, description: t('docIVSite.infiltrationDesc_3') },
    { grade: 4, description: t('docIVSite.infiltrationDesc_4') }
  ];

  // Phlebitis scale (VIP Score)
  const phlebitisScores = [
    { score: 0, description: t('docIVSite.scoreDesc_0'), action: t('docIVSite.scoreAction_0') },
    { score: 1, description: t('docIVSite.scoreDesc_1'), action: t('docIVSite.scoreAction_1') },
    { score: 2, description: t('docIVSite.scoreDesc_2'), action: t('docIVSite.scoreAction_2') },
    { score: 3, description: t('docIVSite.scoreDesc_3'), action: t('docIVSite.scoreAction_3') },
    { score: 4, description: t('docIVSite.scoreDesc_4'), action: t('docIVSite.scoreAction_4') },
    { score: 5, description: t('docIVSite.scoreDesc_5'), action: t('docIVSite.scoreAction_5') }
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

  // Fetch IV site history when patient is selected
  useEffect(() => {
    if (!selectedPatient || !user) return;
    const fetchIVSites = async () => {
      try {
        const response = await fetch(apiUrl(`/api/clinical/iv-sites/${selectedPatient.patient_id}`), {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Nurse',
          },
        });
        if (response.ok) {
          const data = await response.json();
          const sites = Array.isArray(data) ? data : (data.sites || data.iv_sites || []);
          if (sites.length > 0) {
            setIvSites(sites);
          }
        }
      } catch (err) {
        console.error('Failed to fetch IV site history:', err);
      }
    };
    fetchIVSites();
  }, [selectedPatient, user]);

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
    setSuccess(t('docIVSite.successSiteAdded'));
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
      phlebitisScore: calculatePhlebitisScore(newAssessment.conditions || []),
      infiltrationGrade: newAssessment.infiltrationGrade ?? 0
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
    setSuccess(t('docIVSite.successAssessmentDocumented'));
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
      setError(t('docIVSite.errorSelectPatient'));
      return;
    }

    if (ivSites.length === 0) {
      setError(t('docIVSite.errorAddSite'));
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
      setSuccess(t('docIVSite.successRecordsSaved'));
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError(t('docIVSite.errorSaveRecords'));
      console.error('Failed to save IV site records', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeSites = ivSites.filter(s => s.isActive);
  const discontinuedSites = ivSites.filter(s => !s.isActive);

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-surface/20 rounded-full">
                <Syringe className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{t('docIVSite.title')}</h1>
                <p className="text-blue-100">{t('docIVSite.subtitle')}</p>
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
          <div className="mb-6 bg-ok-subtle border border-ok text-ok-subtle-fg p-4 rounded-lg flex items-center">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-critical-subtle border border-critical text-critical-subtle-fg p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Patient Selection Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-bold text-content mb-4 flex items-center">
                <User className="h-5 w-5 mr-2 text-blue-500" />
                {t('docIVSite.selectPatientTitle')}
              </h2>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-content-muted" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('docIVSite.searchPatientsPh')}
                  className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {filteredPatients.map(patient => (
                  <button
                    key={patient.patient_id}
                    onClick={() => setSelectedPatient(patient)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedPatient?.patient_id === patient.patient_id
                        ? 'bg-notice-subtle border-2 border-blue-500'
                        : 'bg-surface-sunken hover:bg-surface-sunken border-2 border-transparent'
                    }`}
                  >
                    <p className="font-medium text-content">{patient.full_name}</p>
                    <p className="text-sm text-content-muted">{patient.patient_id}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Stats */}
            {selectedPatient && (
              <div className="bg-surface rounded-lg shadow p-4 mt-4">
                <h3 className="font-bold text-content mb-3">{t('docIVSite.ivAccessSummary')}</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-2 bg-ok-subtle rounded">
                    <span className="text-sm text-ok-subtle-fg">{t('docIVSite.activeSitesLabel')}</span>
                    <span className="font-bold text-ok-subtle-fg">{activeSites.length}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-caution-subtle rounded">
                    <span className="text-sm text-caution-subtle-fg">{t('docIVSite.expiringSoonLabel')}</span>
                    <span className="font-bold text-caution-subtle-fg">
                      {activeSites.filter(s => isExpiringSoon(s.expiresAt)).length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-critical-subtle rounded">
                    <span className="text-sm text-critical-subtle-fg">{t('docIVSite.expiredLabel')}</span>
                    <span className="font-bold text-critical-subtle-fg">
                      {activeSites.filter(s => isExpired(s.expiresAt)).length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-surface-sunken rounded">
                    <span className="text-sm text-content-secondary">{t('docIVSite.discontinuedLabel')}</span>
                    <span className="font-bold text-content-secondary">{discontinuedSites.length}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Infiltration Scale Reference */}
            <div className="bg-surface rounded-lg shadow p-4 mt-4">
              <h3 className="font-bold text-content mb-3 flex items-center">
                <Droplet className="h-4 w-4 mr-2" />
                {t('docIVSite.infiltrationScaleReference')}
              </h3>
              <div className="space-y-1 text-xs">
                {infiltrationGrades.map(({ grade, description }) => (
                  <div key={grade} className={`flex items-start p-1 rounded ${
                    grade === 0 ? 'bg-ok-subtle' :
                    grade <= 2 ? 'bg-caution-subtle' :
                    'bg-critical-subtle'
                  }`}>
                    <span className="font-bold w-6 flex-shrink-0">{grade}:</span>
                    <span className="text-content-muted">{description}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* VIP Score Reference */}
            <div className="bg-surface rounded-lg shadow p-4 mt-4">
              <h3 className="font-bold text-content mb-3 flex items-center">
                <Activity className="h-4 w-4 mr-2" />
                {t('docIVSite.vipScoreReference')}
              </h3>
              <div className="space-y-1 text-xs">
                {phlebitisScores.map(({ score, description }) => (
                  <div key={score} className={`flex items-center p-1 rounded ${
                    score === 0 ? 'bg-ok-subtle' :
                    score <= 2 ? 'bg-caution-subtle' :
                    'bg-critical-subtle'
                  }`}>
                    <span className="font-bold w-6">{score}:</span>
                    <span className="text-content-muted">{description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {selectedPatient ? (
              <div className="bg-surface rounded-lg shadow">
                {/* Tabs */}
                <div className="border-b">
                  <div className="flex">
                    {[
                      { id: 'sites', label: t('docIVSite.tabActiveSites'), icon: Droplet },
                      { id: 'add-site', label: t('docIVSite.tabAddSite'), icon: Plus },
                      { id: 'assess', label: t('docIVSite.tabAssess'), icon: Eye }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        className={`flex-1 flex items-center justify-center space-x-2 py-4 px-4 font-medium transition-colors ${
                          activeTab === tab.id
                            ? 'border-b-2 border-blue-500 text-notice-subtle-fg'
                            : 'text-content-muted hover:text-content-secondary'
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
                      <h2 className="text-xl font-bold text-content mb-6">{t('docIVSite.activeIvSitesHeading')}</h2>
                      
                      <div className="space-y-4">
                        {activeSites.map(site => {
                          const daysActive = calculateDaysActive(site.insertedAt);
                          const expiringSoon = isExpiringSoon(site.expiresAt);
                          const expired = isExpired(site.expiresAt);
                          const latestAssessment = site.assessments[site.assessments.length - 1];
                          
                          return (
                            <div key={site.id} className={`p-4 rounded-lg border-2 ${
                              expired ? 'border-red-500 bg-critical-subtle' :
                              expiringSoon ? 'border-yellow-500 bg-caution-subtle' :
                              'border-ok bg-ok-subtle'
                            }`}>
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="flex items-center space-x-3">
                                    <MapPin className="h-5 w-5 text-blue-500" />
                                    <h3 className="font-bold text-content">{locationLabels[site.location]}</h3>
                                    <span className="text-xs px-2 py-1 rounded bg-notice-subtle text-notice-subtle-fg">
                                      {site.gauge}
                                    </span>
                                    <span className="text-xs px-2 py-1 rounded bg-surface-sunken text-content-secondary">
                                      {catheterTypes[site.catheterType]}
                                    </span>
                                  </div>
                                  {site.locationDetail && (
                                    <p className="text-sm text-content-muted ml-8">{site.locationDetail}</p>
                                  )}
                                  <div className="mt-2 ml-8 grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                      <span className="text-content-muted">{t('docIVSite.insertedLabel')}</span>
                                      <span className="ml-2">{new Date(site.insertedAt).toLocaleDateString()}</span>
                                      <span className="ml-2 text-content-muted">{t('docIVSite.daysActiveSuffix', { days: daysActive })}</span>
                                    </div>
                                    <div>
                                      <span className="text-content-muted">{t('docIVSite.expiresLabel')}</span>
                                      <span className={`ml-2 ${expired ? 'text-critical-subtle-fg font-bold' : expiringSoon ? 'text-caution-subtle-fg font-bold' : ''}`}>
                                        {new Date(site.expiresAt).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-content-muted">{t('docIVSite.byLabel')}</span>
                                      <span className="ml-2">{site.insertedBy}</span>
                                    </div>
                                    <div>
                                      <span className="text-content-muted">{t('docIVSite.assessmentsLabel')}</span>
                                      <span className="ml-2">{site.assessments.length}</span>
                                    </div>
                                  </div>
                                  {latestAssessment && (
                                    <div className="mt-3 ml-8 p-2 bg-surface rounded text-sm">
                                      <p className="text-content-muted text-xs">{t('docIVSite.latestAssessmentLine', { date: new Date(latestAssessment.assessedAt).toLocaleString() })}</p>
                                      <div className="flex items-center space-x-2 mt-1">
                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                          latestAssessment.phlebitisScore === 0 ? 'bg-ok-subtle text-ok-subtle-fg' :
                                          latestAssessment.phlebitisScore <= 2 ? 'bg-caution-subtle text-caution-subtle-fg' :
                                          'bg-critical-subtle text-critical-subtle-fg'
                                        }`}>
                                          {t('docIVSite.vipScoreLine', { score: latestAssessment.phlebitisScore })}
                                        </span>
                                        {latestAssessment.conditions.map(c => (
                                          <span key={c} className={`text-xs px-2 py-0.5 rounded ${
                                            conditionLabels[c].severity === 'normal' ? 'bg-ok-subtle text-ok-subtle-fg' :
                                            conditionLabels[c].severity === 'warning' ? 'bg-caution-subtle text-caution-subtle-fg' :
                                            'bg-critical-subtle text-critical-subtle-fg'
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
                                    className="p-2 bg-notice-subtle text-notice-subtle-fg rounded hover:bg-blue-200"
                                    title="Assess Site"
                                  >
                                    <Eye className="h-5 w-5" />
                                  </button>
                                  <button
                                    onClick={() => discontinueSite(site.id, 'Routine change')}
                                    className="p-2 bg-critical-subtle text-critical-subtle-fg rounded hover:bg-red-200"
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
                          <div className="text-center py-8 text-content-muted">
                            <Syringe className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>{t('docIVSite.noActiveSites')}</p>
                            <button
                              onClick={() => setActiveTab('add-site')}
                              className="mt-4 text-notice-subtle-fg hover:underline"
                            >
                              {t('docIVSite.addNewIvSiteLink')}
                            </button>
                          </div>
                        )}
                      </div>

                      {discontinuedSites.length > 0 && (
                        <div className="mt-8">
                          <h3 className="text-lg font-bold text-content-secondary mb-4 flex items-center">
                            <History className="h-5 w-5 mr-2" />
                            {t('docIVSite.discontinuedSitesHeading')}
                          </h3>
                          <div className="space-y-2">
                            {discontinuedSites.map(site => (
                              <div key={site.id} className="p-3 rounded-lg bg-surface-sunken text-content-muted">
                                <div className="flex justify-between items-center">
                                  <div>
                                    <span className="font-medium">{locationLabels[site.location]}</span>
                                    <span className="mx-2">•</span>
                                    <span className="text-sm">{site.gauge} {catheterTypes[site.catheterType]}</span>
                                  </div>
                                  <div className="text-sm">
                                    {t('docIVSite.discontinuedLine', { date: new Date(site.discontinuedAt!).toLocaleDateString() })}
                                    <span className="ml-2 text-content-muted">{t('docIVSite.discontinuedReasonSuffix', { reason: site.discontinuedReason || '' })}</span>
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
                      <h2 className="text-xl font-bold text-content mb-6">{t('docIVSite.addNewIvSiteHeading')}</h2>

                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <label htmlFor="iv-location" className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.locationLabel')}</label>
                            <select
                              id="iv-location"
                              value={newSite.location}
                              onChange={(e) => setNewSite({ ...newSite, location: e.target.value as SiteLocation })}
                              className="w-full p-3 border border-border-strong rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                              {Object.entries(locationLabels).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor="iv-location-detail" className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.locationDetailLabel')}</label>
                            <input
                              id="iv-location-detail"
                              type="text"
                              value={newSite.locationDetail}
                              onChange={(e) => setNewSite({ ...newSite, locationDetail: e.target.value })}
                              placeholder={t('docIVSite.locationDetailPh')}
                              className="w-full p-3 border border-border-strong rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <label htmlFor="iv-catheter-type" className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.catheterTypeLabel')}</label>
                            <select
                              id="iv-catheter-type"
                              value={newSite.catheterType}
                              onChange={(e) => setNewSite({ ...newSite, catheterType: e.target.value as CatheterType })}
                              className="w-full p-3 border border-border-strong rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                              {Object.entries(catheterTypes).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.gaugeLabel')}</label>
                            <div className="flex flex-wrap gap-2">
                              {(['24G', '22G', '20G', '18G', '16G', '14G'] as CatheterGauge[]).map(g => (
                                <button
                                  key={g}
                                  type="button"
                                  onClick={() => setNewSite({ ...newSite, gauge: g })}
                                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                    newSite.gauge === g
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
                                  }`}
                                >
                                  {g}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="p-4 bg-notice-subtle rounded-lg">
                          <h4 className="font-medium text-notice-subtle-fg mb-2">{t('docIVSite.expectedDwellTimeHeading')}</h4>
                          <p className="text-notice-subtle-fg">
                            {newSite.catheterType === 'peripheral' && t('docIVSite.dwellTime_peripheral')}
                            {newSite.catheterType === 'midline' && t('docIVSite.dwellTime_midline')}
                            {newSite.catheterType === 'picc' && t('docIVSite.dwellTime_picc')}
                            {newSite.catheterType === 'central' && t('docIVSite.dwellTime_central')}
                          </p>
                        </div>

                        <button
                          onClick={addNewSite}
                          className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 flex items-center justify-center"
                        >
                          <Plus className="h-5 w-5 mr-2" />
                          {t('docIVSite.addIvSiteButton')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Assessment Tab */}
                  {activeTab === 'assess' && (
                    <div>
                      <h2 className="text-xl font-bold text-content mb-6">{t('docIVSite.siteAssessmentHeading')}</h2>

                      {!selectedSite ? (
                        <div>
                          <p className="text-content-muted mb-4">{t('docIVSite.selectSiteToAssess')}</p>
                          <div className="space-y-2">
                            {activeSites.map(site => (
                              <button
                                key={site.id}
                                onClick={() => { setSelectedSite(site); setShowAssessmentForm(true); }}
                                className="w-full text-left p-4 bg-surface-sunken rounded-lg hover:bg-surface-sunken border"
                              >
                                <div className="flex justify-between items-center">
                                  <div>
                                    <span className="font-medium">{locationLabels[site.location]}</span>
                                    <span className="mx-2 text-content-muted">•</span>
                                    <span className="text-sm text-content-muted">{site.gauge} {catheterTypes[site.catheterType]}</span>
                                  </div>
                                  <span className="text-sm text-content-muted">
                                    {t('docIVSite.assessmentCount', { count: site.assessments.length })}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                          {activeSites.length === 0 && (
                            <div className="text-center py-8 text-content-muted">
                              <Eye className="h-12 w-12 mx-auto mb-2 opacity-50" />
                              <p>{t('docIVSite.noActiveSitesToAssess')}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="mb-4 p-4 bg-notice-subtle rounded-lg flex justify-between items-center">
                            <div>
                              <h3 className="font-bold text-notice-subtle-fg">{locationLabels[selectedSite.location]}</h3>
                              <p className="text-sm text-notice-subtle-fg">{selectedSite.gauge} • {catheterTypes[selectedSite.catheterType]}</p>
                            </div>
                            <button
                              onClick={() => { setSelectedSite(null); setShowAssessmentForm(false); }}
                              className="text-notice-subtle-fg hover:underline"
                            >
                              {t('docIVSite.changeSite')}
                            </button>
                          </div>

                          {showAssessmentForm && (
                            <div className="space-y-6 p-4 bg-surface-sunken rounded-lg">
                              <div>
                                <label className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.siteConditionLabel')}</label>
                                <div className="flex flex-wrap gap-2">
                                  {(Object.entries(conditionLabels) as [SiteCondition, { label: string; severity: string }][]).map(([key, { label, severity }]) => (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => toggleCondition(key)}
                                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                        newAssessment.conditions?.includes(key)
                                          ? severity === 'normal' ? 'bg-ok text-critical-fg' :
                                            severity === 'warning' ? 'bg-caution text-critical-fg' :
                                            'bg-critical text-critical-fg'
                                          : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <label htmlFor="iv-infiltration-grade" className="block text-sm font-medium text-content-secondary mb-2">
                                  {t('docIVSite.infiltrationGradeLabel')}
                                </label>
                                <select
                                  id="iv-infiltration-grade"
                                  value={newAssessment.infiltrationGrade ?? 0}
                                  onChange={(e) => setNewAssessment({ ...newAssessment, infiltrationGrade: Number(e.target.value) })}
                                  className="w-full p-3 border border-border-strong rounded-lg"
                                >
                                  {infiltrationGrades.map(({ grade, description }) => (
                                    <option key={grade} value={grade}>{grade} — {description}</option>
                                  ))}
                                </select>
                                {(newAssessment.infiltrationGrade ?? 0) >= 3 && (
                                  <p className="mt-2 text-sm text-critical-subtle-fg font-medium">
                                    {t('docIVSite.infiltrationSevereWarning')}
                                  </p>
                                )}
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label htmlFor="iv-dressing-type" className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.dressingTypeLabel')}</label>
                                  <select
                                    id="iv-dressing-type"
                                    value={newAssessment.dressingType}
                                    onChange={(e) => setNewAssessment({ ...newAssessment, dressingType: e.target.value as DressingType })}
                                    className="w-full p-3 border border-border-strong rounded-lg"
                                  >
                                    <option value="transparent">{t('docIVSite.dressing_transparent')}</option>
                                    <option value="gauze">{t('docIVSite.dressing_gauze')}</option>
                                    <option value="statlock">{t('docIVSite.dressing_statlock')}</option>
                                    <option value="biopatch">{t('docIVSite.dressing_biopatch')}</option>
                                  </select>
                                </div>
                                <div>
                                  <span className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.dressingIntactLabel')}</span>
                                  <div className="flex space-x-4">
                                    <label htmlFor="iv-dressing-intact-yes" className="flex items-center space-x-2">
                                      <input
                                        id="iv-dressing-intact-yes"
                                        type="radio"
                                        name="dressingIntact"
                                        checked={newAssessment.dressingIntact === true}
                                        onChange={() => setNewAssessment({ ...newAssessment, dressingIntact: true })}
                                      />
                                      <span>{t('docIVSite.yesLabel')}</span>
                                    </label>
                                    <label htmlFor="iv-dressing-intact-no" className="flex items-center space-x-2">
                                      <input
                                        id="iv-dressing-intact-no"
                                        type="radio"
                                        name="dressingIntact"
                                        checked={newAssessment.dressingIntact === false}
                                        onChange={() => setNewAssessment({ ...newAssessment, dressingIntact: false })}
                                      />
                                      <span>{t('docIVSite.noLabel')}</span>
                                    </label>
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <span className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.flushesPatentLabel')}</span>
                                  <div className="flex space-x-4">
                                    <label htmlFor="iv-flush-patent-yes" className="flex items-center space-x-2">
                                      <input
                                        id="iv-flush-patent-yes"
                                        type="radio"
                                        name="flushPatent"
                                        checked={newAssessment.flushPatent === true}
                                        onChange={() => setNewAssessment({ ...newAssessment, flushPatent: true })}
                                      />
                                      <span>{t('docIVSite.yesLabel')}</span>
                                    </label>
                                    <label htmlFor="iv-flush-patent-no" className="flex items-center space-x-2">
                                      <input
                                        id="iv-flush-patent-no"
                                        type="radio"
                                        name="flushPatent"
                                        checked={newAssessment.flushPatent === false}
                                        onChange={() => setNewAssessment({ ...newAssessment, flushPatent: false })}
                                      />
                                      <span>{t('docIVSite.noLabel')}</span>
                                    </label>
                                  </div>
                                </div>
                                <div>
                                  <span className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.bloodReturnLabel')}</span>
                                  <div className="flex space-x-4">
                                    <label htmlFor="iv-blood-return-yes" className="flex items-center space-x-2">
                                      <input
                                        id="iv-blood-return-yes"
                                        type="radio"
                                        name="bloodReturn"
                                        checked={newAssessment.bloodReturn === true}
                                        onChange={() => setNewAssessment({ ...newAssessment, bloodReturn: true })}
                                      />
                                      <span>{t('docIVSite.yesLabel')}</span>
                                    </label>
                                    <label htmlFor="iv-blood-return-no" className="flex items-center space-x-2">
                                      <input
                                        id="iv-blood-return-no"
                                        type="radio"
                                        name="bloodReturn"
                                        checked={newAssessment.bloodReturn === false}
                                        onChange={() => setNewAssessment({ ...newAssessment, bloodReturn: false })}
                                      />
                                      <span>{t('docIVSite.noLabel')}</span>
                                    </label>
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label htmlFor="iv-currently-infusing" className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.currentlyInfusingLabel')}</label>
                                  <input
                                    id="iv-currently-infusing"
                                    type="text"
                                    value={newAssessment.infusing}
                                    onChange={(e) => setNewAssessment({ ...newAssessment, infusing: e.target.value })}
                                    placeholder={t('docIVSite.currentlyInfusingPh')}
                                    className="w-full p-3 border border-border-strong rounded-lg"
                                  />
                                </div>
                                <div>
                                  <label htmlFor="iv-infusion-rate" className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.infusionRateLabel')}</label>
                                  <input
                                    id="iv-infusion-rate"
                                    type="text"
                                    value={newAssessment.infusionRate}
                                    onChange={(e) => setNewAssessment({ ...newAssessment, infusionRate: e.target.value })}
                                    placeholder={t('docIVSite.infusionRatePh')}
                                    className="w-full p-3 border border-border-strong rounded-lg"
                                  />
                                </div>
                              </div>

                              <div>
                                <label htmlFor="iv-notes" className="block text-sm font-medium text-content-secondary mb-2">{t('docIVSite.notesLabel')}</label>
                                <textarea
                                  id="iv-notes"
                                  value={newAssessment.notes}
                                  onChange={(e) => setNewAssessment({ ...newAssessment, notes: e.target.value })}
                                  rows={2}
                                  placeholder={t('docIVSite.notesPh')}
                                  className="w-full p-3 border border-border-strong rounded-lg"
                                />
                              </div>

                              <div className="p-4 bg-surface rounded border">
                                <p className="text-sm font-medium text-content-secondary mb-1">{t('docIVSite.calculatedVipScoreLabel')}</p>
                                <div className="flex items-center space-x-4">
                                  <span className={`text-2xl font-bold ${
                                    calculatePhlebitisScore(newAssessment.conditions || []) === 0 ? 'text-ok-subtle-fg' :
                                    calculatePhlebitisScore(newAssessment.conditions || []) <= 2 ? 'text-caution-subtle-fg' :
                                    'text-critical-subtle-fg'
                                  }`}>
                                    {calculatePhlebitisScore(newAssessment.conditions || [])}
                                  </span>
                                  <span className="text-content-muted">
                                    {phlebitisScores[calculatePhlebitisScore(newAssessment.conditions || [])]?.action}
                                  </span>
                                </div>
                              </div>

                              <button
                                onClick={addAssessment}
                                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 flex items-center justify-center"
                              >
                                <CheckCircle2 className="h-5 w-5 mr-2" />
                                {t('docIVSite.saveAssessmentButton')}
                              </button>
                            </div>
                          )}

                          {/* Assessment History */}
                          {selectedSite.assessments.length > 0 && (
                            <div className="mt-6">
                              <h4 className="font-medium text-content-secondary mb-3">{t('docIVSite.assessmentHistoryHeading')}</h4>
                              <div className="space-y-2">
                                {[...selectedSite.assessments].reverse().map(a => (
                                  <div key={a.id} className="p-3 bg-surface rounded border text-sm">
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <p className="text-content-muted">{t('docIVSite.assessedAtByLine', { date: new Date(a.assessedAt).toLocaleString(), by: a.assessedBy })}</p>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {a.conditions.map(c => (
                                            <span key={c} className={`text-xs px-2 py-0.5 rounded ${
                                              conditionLabels[c].severity === 'normal' ? 'bg-ok-subtle text-ok-subtle-fg' :
                                              conditionLabels[c].severity === 'warning' ? 'bg-caution-subtle text-caution-subtle-fg' :
                                              'bg-critical-subtle text-critical-subtle-fg'
                                            }`}>
                                              {conditionLabels[c].label}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                                        a.phlebitisScore === 0 ? 'bg-ok-subtle text-ok-subtle-fg' :
                                        a.phlebitisScore <= 2 ? 'bg-caution-subtle text-caution-subtle-fg' :
                                        'bg-critical-subtle text-critical-subtle-fg'
                                      }`}>
                                        {t('docIVSite.vipShortLine', { score: a.phlebitisScore })}
                                      </span>
                                    </div>
                                    {a.notes && <p className="mt-2 text-content-muted">{a.notes}</p>}
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
                <div className="p-4 border-t bg-surface-sunken flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={isSubmitting || ivSites.length === 0}
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="animate-spin h-4 w-4 mr-2" />
                        {t('docIVSite.saving')}
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        {t('docIVSite.saveAllRecords')}
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-surface rounded-lg shadow p-12 text-center">
                <Syringe className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl font-bold text-content-secondary mb-2">{t('docIVSite.selectPatientEmptyTitle')}</h2>
                <p className="text-content-muted">{t('docIVSite.selectPatientEmptyMessage')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
