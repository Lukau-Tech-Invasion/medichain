import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createBurn, getPatients, useTranslation } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  Flame,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Save,
  Search,
  User,
  Activity,
  Droplets,
  Calculator,
  History,
  FileText,
  Thermometer,
  Zap,
  AlertCircle,
  Info,
  Ruler,
  RefreshCw
} from 'lucide-react';

type BurnDepth = 'superficial' | 'partial-superficial' | 'partial-deep' | 'full-thickness';
type BurnMechanism = 'thermal' | 'chemical' | 'electrical' | 'radiation' | 'friction' | 'frostbite';

interface BodyRegion {
  id: string;
  name: string;
  adultPercentage: number;
  childPercentage: number; // For Rule of 9s adjustments in children
}

interface BurnArea {
  regionId: string;
  percentage: number;
  depth: BurnDepth;
}

interface _BurnAssessment {
  id: string;
  patientId: string;
  assessmentDate: string;
  assessmentTime: string;
  assessedBy: string;
  mechanism: BurnMechanism;
  agentSource: string;
  injuryTime: string;
  weight: number;
  burnAreas: BurnArea[];
  totalBSA: number;
  parklandFluid: {
    total24h: number;
    first8h: number;
    next16h: number;
    hourlyFirst8h: number;
    hourlyNext16h: number;
  };
  inhalationInjury: {
    suspected: boolean;
    singedHairs: boolean;
    sootInAirway: boolean;
    hoarseness: boolean;
    stridor: boolean;
    carbonMonoxide: boolean;
    coLevel?: number;
  };
  circumferential: {
    present: boolean;
    locations: string[];
    escharotomyNeeded: boolean;
  };
  associatedInjuries: string[];
  tetanusStatus: string;
  painLevel: number;
  interventions: string[];
  fluidStartTime?: string;
  urineOutput?: number;
  notes: string;
}

const bodyRegions: BodyRegion[] = [
  { id: 'head', name: 'Head (Front)', adultPercentage: 4.5, childPercentage: 9 },
  { id: 'head-back', name: 'Head (Back)', adultPercentage: 4.5, childPercentage: 9 },
  { id: 'chest', name: 'Chest', adultPercentage: 9, childPercentage: 9 },
  { id: 'abdomen', name: 'Abdomen', adultPercentage: 9, childPercentage: 9 },
  { id: 'upper-back', name: 'Upper Back', adultPercentage: 9, childPercentage: 9 },
  { id: 'lower-back', name: 'Lower Back', adultPercentage: 9, childPercentage: 9 },
  { id: 'right-arm', name: 'Right Arm (Entire)', adultPercentage: 9, childPercentage: 9 },
  { id: 'left-arm', name: 'Left Arm (Entire)', adultPercentage: 9, childPercentage: 9 },
  { id: 'genitalia', name: 'Genitalia/Perineum', adultPercentage: 1, childPercentage: 1 },
  { id: 'right-leg-front', name: 'Right Leg (Front)', adultPercentage: 9, childPercentage: 6.5 },
  { id: 'right-leg-back', name: 'Right Leg (Back)', adultPercentage: 9, childPercentage: 6.5 },
  { id: 'left-leg-front', name: 'Left Leg (Front)', adultPercentage: 9, childPercentage: 6.5 },
  { id: 'left-leg-back', name: 'Left Leg (Back)', adultPercentage: 9, childPercentage: 6.5 }
];

export default function BurnPage() {
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
  const [activeTab, setActiveTab] = useState<'assessment' | 'calculator' | 'history'>('assessment');
  const [isChild, setIsChild] = useState(false);

  // Form state
  const [mechanism, setMechanism] = useState<BurnMechanism>('thermal');
  const [agentSource, setAgentSource] = useState('');
  const [injuryTime, setInjuryTime] = useState('');
  const [weight, setWeight] = useState<number>(70);
  const [burnAreas, setBurnAreas] = useState<BurnArea[]>([]);
  const [painLevel, setPainLevel] = useState(5);
  const [tetanusStatus, setTetanusStatus] = useState('unknown');
  const [notes, setNotes] = useState('');
  const [fluidStartTime, setFluidStartTime] = useState('');
  const [urineOutput, setUrineOutput] = useState<number | undefined>();

  const [inhalationInjury, setInhalationInjury] = useState({
    suspected: false,
    singedHairs: false,
    sootInAirway: false,
    hoarseness: false,
    stridor: false,
    carbonMonoxide: false,
    coLevel: undefined as number | undefined
  });

  const [circumferential, setCircumferential] = useState({
    present: false,
    locations: [] as string[],
    escharotomyNeeded: false
  });

  const [associatedInjuries, setAssociatedInjuries] = useState<string[]>([]);
  const [interventions, setInterventions] = useState<string[]>([]);

  const mechanismOptions: { value: BurnMechanism; label: string; icon: React.ReactNode }[] = [
    { value: 'thermal', label: t('docBurn.mechanism_thermal'), icon: <Flame className="h-4 w-4" /> },
    { value: 'chemical', label: t('docBurn.mechanism_chemical'), icon: <Droplets className="h-4 w-4" /> },
    { value: 'electrical', label: t('docBurn.mechanism_electrical'), icon: <Zap className="h-4 w-4" /> },
    { value: 'radiation', label: t('docBurn.mechanism_radiation'), icon: <AlertCircle className="h-4 w-4" /> },
    { value: 'friction', label: t('docBurn.mechanism_friction'), icon: <Activity className="h-4 w-4" /> },
    { value: 'frostbite', label: t('docBurn.mechanism_frostbite'), icon: <Thermometer className="h-4 w-4" /> }
  ];

  const depthOptions: { value: BurnDepth; label: string; color: string; description: string }[] = [
    { value: 'superficial', label: t('docBurn.depth_superficial'), color: 'bg-pink-200', description: t('docBurn.depthDesc_superficial') },
    { value: 'partial-superficial', label: t('docBurn.depth_partial-superficial'), color: 'bg-red-300', description: t('docBurn.depthDesc_partial-superficial') },
    { value: 'partial-deep', label: t('docBurn.depth_partial-deep'), color: 'bg-red-500', description: t('docBurn.depthDesc_partial-deep') },
    { value: 'full-thickness', label: t('docBurn.depth_full-thickness'), color: 'bg-gray-700', description: t('docBurn.depthDesc_full-thickness') }
  ];

  const associatedInjuryOptions = [
    'Fractures', 'Lacerations', 'Contusions', 'Smoke Inhalation',
    'Blast Injury', 'Traumatic Brain Injury', 'Spinal Injury', 'Eye Injury'
  ];

  const interventionOptions = [
    'IV Access x2 Large Bore', 'LR Infusion Started', 'Foley Catheter Placed',
    'Wound Cleaned', 'Sterile Dressings Applied', 'Silver Sulfadiazine Applied',
    'Tetanus Administered', 'Pain Medication Given', 'Escharotomy Performed',
    'Intubation', 'Bronchoscopy', 'NG Tube Placed', 'Warming Measures',
    'Burn Center Consultation', 'Transfer Arranged'
  ];

  const circumferentialLocations = [
    'Right Arm', 'Left Arm', 'Right Leg', 'Left Leg',
    'Chest', 'Abdomen', 'Neck', 'Digits'
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const patientData = await getPatients();
        setPatients(patientData || []);

        const patientId = searchParams.get('patient');
        if (patientId && patientData) {
          const patient = patientData.find((p: PatientProfile) => p.patient_id === patientId);
          if (patient) setSelectedPatient(patient);
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

  const calculateTotalBSA = (): number => {
    return burnAreas.reduce((sum, area) => sum + area.percentage, 0);
  };

  const calculateParklandFluid = (bsa: number, patientWeight: number) => {
    // Parkland Formula: 4mL x weight(kg) x %BSA
    const total24h = 4 * patientWeight * bsa;
    const first8h = total24h / 2;
    const next16h = total24h / 2;
    const hourlyFirst8h = first8h / 8;
    const hourlyNext16h = next16h / 16;

    return {
      total24h: Math.round(total24h),
      first8h: Math.round(first8h),
      next16h: Math.round(next16h),
      hourlyFirst8h: Math.round(hourlyFirst8h),
      hourlyNext16h: Math.round(hourlyNext16h)
    };
  };

  const totalBSA = calculateTotalBSA();
  const parklandFluid = calculateParklandFluid(totalBSA, weight);

  const getBurnSeverity = () => {
    if (totalBSA >= 25 || inhalationInjury.suspected || circumferential.present) {
      return { level: 'Major', color: 'text-critical-subtle-fg bg-critical-subtle border-red-500' };
    }
    if (totalBSA >= 10) {
      return { level: 'Moderate', color: 'text-caution-subtle-fg bg-caution-subtle border-yellow-500' };
    }
    return { level: 'Minor', color: 'text-ok-subtle-fg bg-ok-subtle border-green-500' };
  };

  const severity = getBurnSeverity();

  const updateBurnArea = (regionId: string, field: 'percentage' | 'depth', value: number | BurnDepth) => {
    setBurnAreas(prev => {
      const existing = prev.find(a => a.regionId === regionId);
      if (existing) {
        if (field === 'percentage' && value === 0) {
          return prev.filter(a => a.regionId !== regionId);
        }
        return prev.map(a => a.regionId === regionId ? { ...a, [field]: value } : a);
      } else if (field === 'percentage' && typeof value === 'number' && value > 0) {
        return [...prev, { regionId, percentage: value, depth: 'partial-superficial' as BurnDepth }];
      }
      return prev;
    });
  };

  const getBurnAreaValue = (regionId: string, field: 'percentage' | 'depth') => {
    const area = burnAreas.find(a => a.regionId === regionId);
    if (!area) return field === 'percentage' ? 0 : 'partial-superficial';
    return area[field];
  };

  const toggleCircumferentialLocation = (location: string) => {
    setCircumferential(prev => ({
      ...prev,
      locations: prev.locations.includes(location)
        ? prev.locations.filter(l => l !== location)
        : [...prev.locations, location]
    }));
  };

  const toggleAssociatedInjury = (injury: string) => {
    setAssociatedInjuries(prev =>
      prev.includes(injury) ? prev.filter(i => i !== injury) : [...prev, injury]
    );
  };

  const toggleIntervention = (intervention: string) => {
    setInterventions(prev =>
      prev.includes(intervention) ? prev.filter(i => i !== intervention) : [...prev, intervention]
    );
  };

  const handleSave = async () => {
    if (!selectedPatient) {
      setError(t('docBurn.errorSelectPatient'));
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const assessmentData = {
        assessment_id: `BURN-${Date.now()}`,
        patient_id: selectedPatient.patient_id,
        assessment_date: new Date().toISOString().split('T')[0],
        assessment_time: new Date().toTimeString().slice(0, 5),
        assessed_by: user?.userId || 'unknown',
        mechanism,
        agent_source: agentSource,
        injury_time: injuryTime,
        weight,
        burn_areas: burnAreas,
        total_bsa: totalBSA,
        parkland_fluid: parklandFluid,
        inhalation_injury: inhalationInjury,
        circumferential,
        associated_injuries: associatedInjuries,
        tetanus_status: tetanusStatus,
        pain_level: painLevel,
        interventions,
        fluid_start_time: fluidStartTime,
        urine_output: urineOutput,
        notes,
        created_at: Math.floor(Date.now() / 1000)
      };

      await createBurn(assessmentData);
      setSuccess(t('docBurn.successSaved'));
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError(t('docBurn.errorSaveFailed'));
      console.error('Failed to save burn assessment', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-surface/20 rounded-full">
                <Flame className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{t('docBurn.title')}</h1>
                <p className="text-orange-100">{t('docBurn.subtitle')}</p>
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

        {/* Severity Banner */}
        {selectedPatient && totalBSA > 0 && (
          <div className={`mb-6 rounded-lg border-2 p-6 ${severity.color}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Flame className="h-8 w-8" />
                <div>
                  <h2 className="text-2xl font-bold">{t('docBurn.totalBSA', { value: totalBSA.toFixed(1) })}</h2>
                  <p className="text-lg font-medium">{t('docBurn.severityBurnSuffix', { level: t(`docBurn.severity_${severity.level}`) })}</p>
                </div>
              </div>
              <div className="text-right">
                {inhalationInjury.suspected && (
                  <span className="px-3 py-1 bg-red-500 text-white rounded-full text-sm mr-2">{t('docBurn.inhalationInjuryBadge')}</span>
                )}
                {circumferential.present && (
                  <span className="px-3 py-1 bg-purple-500 text-white rounded-full text-sm">{t('docBurn.circumferentialBadge')}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-surface rounded-lg shadow mb-6">
          <div className="border-b flex">
            <button
              onClick={() => setActiveTab('assessment')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'assessment'
                  ? 'border-b-2 border-red-500 text-critical-subtle-fg'
                  : 'text-content-muted'
              }`}
            >
              <FileText className="h-5 w-5" />
              <span>{t('docBurn.tabAssessment')}</span>
            </button>
            <button
              onClick={() => setActiveTab('calculator')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'calculator'
                  ? 'border-b-2 border-red-500 text-critical-subtle-fg'
                  : 'text-content-muted'
              }`}
            >
              <Calculator className="h-5 w-5" />
              <span>{t('docBurn.tabCalculator')}</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'history'
                  ? 'border-b-2 border-red-500 text-critical-subtle-fg'
                  : 'text-content-muted'
              }`}
            >
              <History className="h-5 w-5" />
              <span>{t('docBurn.tabHistory')}</span>
            </button>
          </div>
        </div>

        {activeTab === 'assessment' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Patient Selection & Info */}
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-surface rounded-lg shadow p-4">
                <h2 className="font-bold text-content mb-4 flex items-center">
                  <User className="h-5 w-5 mr-2 text-red-500" />
                  {t('docBurn.selectPatientTitle')}
                </h2>
                <div className="relative mb-4">
                  <label htmlFor="burn-patient-search" className="sr-only">{t('docBurn.searchPatientsSr')}</label>
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-content-muted" />
                  <input
                    id="burn-patient-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docBurn.searchPatientsPh')}
                    className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {filteredPatients.map(patient => (
                    <button
                      key={patient.patient_id}
                      onClick={() => setSelectedPatient(patient)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedPatient?.patient_id === patient.patient_id
                          ? 'bg-critical-subtle border-2 border-red-500'
                          : 'bg-surface-sunken hover:bg-surface-sunken border-2 border-transparent'
                      }`}
                    >
                      <p className="font-medium text-content">{patient.full_name}</p>
                      <p className="text-sm text-content-muted">{patient.patient_id}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Injury Details */}
              <div className="bg-surface rounded-lg shadow p-4">
                <h3 className="font-bold text-content mb-3 flex items-center">
                  <Clock className="h-5 w-5 mr-2 text-red-500" />
                  {t('docBurn.injuryDetailsTitle')}
                </h3>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="burn-mechanism" className="block text-sm font-medium text-content-secondary mb-1">{t('docBurn.mechanismLabel')}</label>
                    <select
                      id="burn-mechanism"
                      value={mechanism}
                      onChange={(e) => setMechanism(e.target.value as BurnMechanism)}
                      className="w-full p-2 border border-border-strong rounded"
                    >
                      {mechanismOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="burn-agent-source" className="block text-sm font-medium text-content-secondary mb-1">{t('docBurn.agentSourceLabel')}</label>
                    <input
                      id="burn-agent-source"
                      type="text"
                      value={agentSource}
                      onChange={(e) => setAgentSource(e.target.value)}
                      placeholder={t('docBurn.agentSourcePh')}
                      className="w-full p-2 border border-border-strong rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="burn-injury-time" className="block text-sm font-medium text-content-secondary mb-1">{t('docBurn.timeOfInjuryLabel')}</label>
                    <input
                      id="burn-injury-time"
                      type="time"
                      value={injuryTime}
                      onChange={(e) => setInjuryTime(e.target.value)}
                      className="w-full p-2 border border-border-strong rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="burn-patient-weight" className="block text-sm font-medium text-content-secondary mb-1">{t('docBurn.patientWeightLabel')}</label>
                    <input
                      id="burn-patient-weight"
                      type="number"
                      value={weight}
                      onChange={(e) => setWeight(Number(e.target.value))}
                      className="w-full p-2 border border-border-strong rounded"
                    />
                  </div>
                  <label htmlFor="burn-is-child" className="flex items-center space-x-2 cursor-pointer">
                    <input
                      id="burn-is-child"
                      type="checkbox"
                      checked={isChild}
                      onChange={() => setIsChild(!isChild)}
                      className="rounded border-border-strong text-critical-subtle-fg"
                    />
                    <span className="text-sm">{t('docBurn.pediatricPatientLabel')}</span>
                  </label>
                </div>
              </div>

              {/* Tetanus & Pain */}
              <div className="bg-surface rounded-lg shadow p-4">
                <div className="space-y-3">
                  <div>
                    <label htmlFor="burn-tetanus-status" className="block text-sm font-medium text-content-secondary mb-1">{t('docBurn.tetanusStatusLabel')}</label>
                    <select
                      id="burn-tetanus-status"
                      value={tetanusStatus}
                      onChange={(e) => setTetanusStatus(e.target.value)}
                      className="w-full p-2 border border-border-strong rounded"
                    >
                      <option value="unknown">{t('docBurn.tetanus_unknown')}</option>
                      <option value="current">{t('docBurn.tetanus_current')}</option>
                      <option value="needs-booster">{t('docBurn.tetanus_needsBooster')}</option>
                      <option value="needs-series">{t('docBurn.tetanus_needsSeries')}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="burn-pain-level" className="block text-sm font-medium text-content-secondary mb-1">
                      {t('docBurn.painLevelLabel', { value: painLevel })}
                    </label>
                    <input
                      id="burn-pain-level"
                      type="range"
                      min="0"
                      max="10"
                      value={painLevel}
                      onChange={(e) => setPainLevel(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-content-muted">
                      <span>{t('docBurn.painNone')}</span>
                      <span>{t('docBurn.painModerate')}</span>
                      <span>{t('docBurn.painSevere')}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Assessment */}
            <div className="lg:col-span-2 space-y-6">
              {/* Rule of 9s Body Map */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-bold text-content mb-4 flex items-center">
                  <Ruler className="h-6 w-6 mr-2 text-red-500" />
                  {t('docBurn.ruleOfNinesTitle')}
                </h2>
                <div className="mb-4 p-3 bg-notice-subtle rounded-lg flex items-start">
                  <Info className="h-5 w-5 mr-2 text-blue-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-notice-subtle-fg">
                    {t('docBurn.ruleOfNinesInfo')}
                    {isChild && t('docBurn.pediatricAdjustmentNote')}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {bodyRegions.map(region => {
                    const maxPercent = isChild ? region.childPercentage : region.adultPercentage;
                    const currentPercent = getBurnAreaValue(region.id, 'percentage') as number;
                    const currentDepth = getBurnAreaValue(region.id, 'depth') as BurnDepth;

                    return (
                      <div key={region.id} className={`p-3 rounded-lg border ${currentPercent > 0 ? 'border-critical bg-critical-subtle' : 'border-border'}`}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium text-content">{region.name}</span>
                          <span className="text-sm text-content-muted">{t('docBurn.maxPercent', { value: maxPercent })}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor={`burn-percent-${region.id}`} className="block text-xs text-content-muted mb-1">{t('docBurn.percentAffectedLabel')}</label>
                            <input
                              id={`burn-percent-${region.id}`}
                              type="number"
                              min="0"
                              max={maxPercent}
                              step="0.5"
                              value={currentPercent}
                              onChange={(e) => updateBurnArea(region.id, 'percentage', Math.min(maxPercent, Number(e.target.value)))}
                              className="w-full p-1 border border-border-strong rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`burn-depth-${region.id}`} className="block text-xs text-content-muted mb-1">{t('docBurn.depthLabel')}</label>
                            <select
                              id={`burn-depth-${region.id}`}
                              value={currentDepth}
                              onChange={(e) => updateBurnArea(region.id, 'depth', e.target.value as BurnDepth)}
                              disabled={currentPercent === 0}
                              className="w-full p-1 border border-border-strong rounded text-sm"
                            >
                              {depthOptions.map(d => (
                                <option key={d.value} value={d.value}>{d.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Depth Legend */}
                <div className="mt-4 p-3 bg-surface-sunken rounded-lg">
                  <h4 className="font-medium text-content-secondary mb-2">{t('docBurn.depthReferenceTitle')}</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {depthOptions.map(d => (
                      <div key={d.value} className="flex items-center space-x-2">
                        <div className={`w-4 h-4 rounded ${d.color}`}></div>
                        <span className="text-sm"><strong>{d.label}:</strong> {d.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Inhalation Injury */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h3 className="font-bold text-content mb-4 flex items-center">
                  <AlertTriangle className="h-5 w-5 mr-2 text-red-500" />
                  {t('docBurn.inhalationInjuryTitle')}
                </h3>
                <label htmlFor="burn-inhalation-suspected" className="flex items-center space-x-2 mb-4 cursor-pointer">
                  <input
                    id="burn-inhalation-suspected"
                    type="checkbox"
                    checked={inhalationInjury.suspected}
                    onChange={() => setInhalationInjury(prev => ({ ...prev, suspected: !prev.suspected }))}
                    className="rounded border-border-strong text-critical-subtle-fg"
                  />
                  <span className="font-medium">{t('docBurn.inhalationSuspectedLabel')}</span>
                </label>
                {inhalationInjury.suspected && (
                  <div className="grid grid-cols-2 gap-4 pl-6">
                    {[
                      { key: 'singedHairs', label: t('docBurn.inhal_singedHairs') },
                      { key: 'sootInAirway', label: t('docBurn.inhal_sootInAirway') },
                      { key: 'hoarseness', label: t('docBurn.inhal_hoarseness') },
                      { key: 'stridor', label: t('docBurn.inhal_stridor') },
                      { key: 'carbonMonoxide', label: t('docBurn.inhal_carbonMonoxide') }
                    ].map(({ key, label }) => (
                      <label key={key} htmlFor={`burn-inhalation-${key}`} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          id={`burn-inhalation-${key}`}
                          type="checkbox"
                          checked={inhalationInjury[key as keyof typeof inhalationInjury] as boolean}
                          onChange={() => setInhalationInjury(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
                          className="rounded border-border-strong text-critical-subtle-fg"
                        />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                    {inhalationInjury.carbonMonoxide && (
                      <div className="col-span-2">
                        <label htmlFor="burn-co-level" className="block text-sm font-medium text-content-secondary mb-1">{t('docBurn.coLevelLabel')}</label>
                        <input
                          id="burn-co-level"
                          type="number"
                          value={inhalationInjury.coLevel || ''}
                          onChange={(e) => setInhalationInjury(prev => ({ ...prev, coLevel: Number(e.target.value) }))}
                          placeholder={t('docBurn.coLevelPh')}
                          className="w-full p-2 border border-border-strong rounded"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Circumferential Burns */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h3 className="font-bold text-content mb-4 flex items-center">
                  <AlertCircle className="h-5 w-5 mr-2 text-purple-500" />
                  {t('docBurn.circumferentialTitle')}
                </h3>
                <label htmlFor="burn-circumferential" className="flex items-center space-x-2 mb-4 cursor-pointer">
                  <input
                    id="burn-circumferential"
                    type="checkbox"
                    checked={circumferential.present}
                    onChange={() => setCircumferential(prev => ({ ...prev, present: !prev.present }))}
                    className="rounded border-border-strong text-content-secondary"
                  />
                  <span className="font-medium">{t('docBurn.circumferentialPresentLabel')}</span>
                </label>
                {circumferential.present && (
                  <div className="pl-6 space-y-4">
                    <div>
                      <span className="block text-sm font-medium text-content-secondary mb-2">{t('docBurn.locationsLabel')}</span>
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Circumferential burn locations">
                        {circumferentialLocations.map(loc => (
                          <button
                            key={loc}
                            type="button"
                            onClick={() => toggleCircumferentialLocation(loc)}
                            className={`px-3 py-1 rounded-full text-sm ${
                              circumferential.locations.includes(loc)
                                ? 'bg-purple-500 text-white'
                                : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
                            }`}
                          >
                            {loc}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label htmlFor="burn-escharotomy-needed" className="flex items-center space-x-2 cursor-pointer">
                      <input
                        id="burn-escharotomy-needed"
                        type="checkbox"
                        checked={circumferential.escharotomyNeeded}
                        onChange={() => setCircumferential(prev => ({ ...prev, escharotomyNeeded: !prev.escharotomyNeeded }))}
                        className="rounded border-border-strong text-critical-subtle-fg"
                      />
                      <span className="text-sm font-medium text-critical-subtle-fg">{t('docBurn.escharotomyNeededLabel')}</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Associated Injuries & Interventions */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-surface rounded-lg shadow p-4">
                  <h3 className="font-bold text-content mb-3">{t('docBurn.associatedInjuriesTitle')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {associatedInjuryOptions.map(injury => (
                      <button
                        key={injury}
                        type="button"
                        onClick={() => toggleAssociatedInjury(injury)}
                        className={`px-3 py-1 rounded-full text-sm ${
                          associatedInjuries.includes(injury)
                            ? 'bg-caution text-caution-fg'
                            : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
                        }`}
                      >
                        {injury}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-surface rounded-lg shadow p-4">
                  <h3 className="font-bold text-content mb-3">{t('docBurn.interventionsTitle')}</h3>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {interventionOptions.map(intervention => (
                      <label key={intervention} htmlFor={`burn-intervention-${intervention.toLowerCase().replace(/\s+/g, '-')}`} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          id={`burn-intervention-${intervention.toLowerCase().replace(/\s+/g, '-')}`}
                          type="checkbox"
                          checked={interventions.includes(intervention)}
                          onChange={() => toggleIntervention(intervention)}
                          className="rounded border-border-strong text-ok-subtle-fg"
                        />
                        <span className="text-sm">{intervention}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="bg-surface rounded-lg shadow p-6">
                <label htmlFor="burn-notes" className="font-bold text-content mb-4 block">{t('docBurn.notesLabel')}</label>
                <textarea
                  id="burn-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('docBurn.notesPh')}
                  rows={4}
                  className="w-full p-3 border border-border-strong rounded-lg"
                />
              </div>

              {/* Submit Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={isSubmitting || !selectedPatient}
                  className="bg-critical text-critical-fg px-8 py-3 rounded-lg hover:bg-critical disabled:opacity-50 flex items-center"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="animate-spin h-5 w-5 mr-2" />
                      {t('docBurn.saving')}
                    </>
                  ) : (
                    <>
                      <Save className="h-5 w-5 mr-2" />
                      {t('docBurn.saveAssessment')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'calculator' && (
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-content mb-6 flex items-center">
              <Calculator className="h-6 w-6 mr-2 text-red-500" />
              {t('docBurn.parklandCalcTitle')}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="bg-surface-sunken rounded-lg p-4 mb-4">
                  <h3 className="font-bold mb-3">{t('docBurn.inputParametersTitle')}</h3>
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="burn-calc-weight" className="block text-sm font-medium text-content-secondary mb-1">{t('docBurn.patientWeightLabel')}</label>
                      <input
                        id="burn-calc-weight"
                        type="number"
                        value={weight}
                        onChange={(e) => setWeight(Number(e.target.value))}
                        className="w-full p-2 border border-border-strong rounded"
                      />
                    </div>
                    <div>
                      <label htmlFor="burn-total-bsa" className="block text-sm font-medium text-content-secondary mb-1">{t('docBurn.totalBSALabel')}</label>
                      <input
                        id="burn-total-bsa"
                        type="number"
                        value={totalBSA}
                        readOnly
                        className="w-full p-2 border border-border-strong rounded bg-surface-sunken"
                      />
                      <p className="text-xs text-content-muted mt-1">{t('docBurn.totalBSAHint')}</p>
                    </div>
                    <div>
                      <label htmlFor="burn-fluid-start" className="block text-sm font-medium text-content-secondary mb-1">{t('docBurn.fluidStartLabel')}</label>
                      <input
                        id="burn-fluid-start"
                        type="time"
                        value={fluidStartTime}
                        onChange={(e) => setFluidStartTime(e.target.value)}
                        className="w-full p-2 border border-border-strong rounded"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-notice-subtle rounded-lg p-4">
                  <h4 className="font-bold text-notice-subtle-fg mb-2">{t('docBurn.parklandFormulaTitle')}</h4>
                  <p className="text-notice-subtle-fg font-mono text-lg">
                    {t('docBurn.parklandFormulaCalc', { weight, bsa: totalBSA })}
                  </p>
                  <p className="text-notice-subtle-fg mt-2">
                    = <strong>{t('docBurn.parklandFormulaResult', { total: parklandFluid.total24h.toLocaleString() })}</strong>
                  </p>
                </div>
              </div>

              <div>
                <div className="bg-ok-subtle rounded-lg p-4 mb-4">
                  <h3 className="font-bold text-ok-subtle-fg mb-3">{t('docBurn.fluidScheduleTitle')}</h3>
                  <div className="space-y-4">
                    <div className="border-b border-ok pb-3">
                      <p className="text-ok-subtle-fg font-medium">{t('docBurn.first8Hours')}</p>
                      <p className="text-2xl font-bold text-ok-subtle-fg">{parklandFluid.first8h.toLocaleString()} mL</p>
                      <p className="text-ok-subtle-fg">
                        <strong>{t('docBurn.rateLabel', { value: parklandFluid.hourlyFirst8h })}</strong>
                      </p>
                    </div>
                    <div>
                      <p className="text-ok-subtle-fg font-medium">{t('docBurn.next16Hours')}</p>
                      <p className="text-2xl font-bold text-ok-subtle-fg">{parklandFluid.next16h.toLocaleString()} mL</p>
                      <p className="text-ok-subtle-fg">
                        <strong>{t('docBurn.rateLabel', { value: parklandFluid.hourlyNext16h })}</strong>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-caution-subtle rounded-lg p-4">
                  <h4 className="font-bold text-caution-subtle-fg mb-2 flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    {t('docBurn.monitoringTitle')}
                  </h4>
                  <div>
                    <label htmlFor="burn-urine-output" className="block text-sm font-medium text-caution-subtle-fg mb-1">{t('docBurn.urineOutputLabel')}</label>
                    <input
                      id="burn-urine-output"
                      type="number"
                      value={urineOutput || ''}
                      onChange={(e) => setUrineOutput(Number(e.target.value))}
                      placeholder={t('docBurn.urineOutputPh')}
                      className="w-full p-2 border border-caution rounded"
                    />
                    <p className="text-xs text-caution-subtle-fg mt-1">
                      {t('docBurn.urineOutputHint')}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-critical-subtle rounded-lg border border-critical">
              <h4 className="flex items-center gap-2 font-bold text-critical-subtle-fg mb-2">
                <AlertTriangle size={18} aria-hidden="true" /> {t('docBurn.importantNotesTitle')}
              </h4>
              <ul className="text-sm text-critical-subtle-fg space-y-1 list-disc list-inside">
                <li>{t('docBurn.note1')}</li>
                <li>{t('docBurn.note2')}</li>
                <li>{t('docBurn.note3')}</li>
                <li>{t('docBurn.note4')}</li>
                <li>{t('docBurn.note5')}</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-content mb-6 flex items-center">
              <History className="h-6 w-6 mr-2 text-red-500" />
              {t('docBurn.assessmentHistoryTitle')}
            </h2>
            <div className="text-center py-12 text-content-muted">
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{t('docBurn.noHistory')}</p>
              <p className="text-sm mt-1">{t('docBurn.noHistoryHint')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
