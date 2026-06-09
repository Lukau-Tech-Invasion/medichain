import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createBurn, getPatients } from '@medichain/shared';
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
    { value: 'thermal', label: 'Thermal (Heat/Flame)', icon: <Flame className="h-4 w-4" /> },
    { value: 'chemical', label: 'Chemical', icon: <Droplets className="h-4 w-4" /> },
    { value: 'electrical', label: 'Electrical', icon: <Zap className="h-4 w-4" /> },
    { value: 'radiation', label: 'Radiation', icon: <AlertCircle className="h-4 w-4" /> },
    { value: 'friction', label: 'Friction', icon: <Activity className="h-4 w-4" /> },
    { value: 'frostbite', label: 'Frostbite', icon: <Thermometer className="h-4 w-4" /> }
  ];

  const depthOptions: { value: BurnDepth; label: string; color: string; description: string }[] = [
    { value: 'superficial', label: '1st Degree', color: 'bg-pink-200', description: 'Epidermis only - Red, dry, painful' },
    { value: 'partial-superficial', label: '2nd Degree (Superficial)', color: 'bg-red-300', description: 'Epidermis + superficial dermis - Blisters, moist, very painful' },
    { value: 'partial-deep', label: '2nd Degree (Deep)', color: 'bg-red-500', description: 'Epidermis + deep dermis - Less painful, mottled' },
    { value: 'full-thickness', label: '3rd Degree', color: 'bg-gray-700', description: 'All layers - Leathery, painless, white/brown/black' }
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
      return { level: 'Major', color: 'text-red-600 bg-red-50 border-red-500' };
    }
    if (totalBSA >= 10) {
      return { level: 'Moderate', color: 'text-yellow-600 bg-yellow-50 border-yellow-500' };
    }
    return { level: 'Minor', color: 'text-green-600 bg-green-50 border-green-500' };
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
      setError('Please select a patient');
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
      setSuccess('Burn assessment saved successfully!');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to save burn assessment. Please try again.');
      console.error('Failed to save burn assessment', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full">
                <Flame className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Burn Assessment</h1>
                <p className="text-orange-100">Rule of 9s & Parkland Formula Calculator</p>
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

        {/* Severity Banner */}
        {selectedPatient && totalBSA > 0 && (
          <div className={`mb-6 rounded-lg border-2 p-6 ${severity.color}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Flame className="h-8 w-8" />
                <div>
                  <h2 className="text-2xl font-bold">Total BSA: {totalBSA.toFixed(1)}%</h2>
                  <p className="text-lg font-medium">{severity.level} Burn</p>
                </div>
              </div>
              <div className="text-right">
                {inhalationInjury.suspected && (
                  <span className="px-3 py-1 bg-red-500 text-white rounded-full text-sm mr-2">Inhalation Injury</span>
                )}
                {circumferential.present && (
                  <span className="px-3 py-1 bg-purple-500 text-white rounded-full text-sm">Circumferential</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b flex">
            <button
              onClick={() => setActiveTab('assessment')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'assessment'
                  ? 'border-b-2 border-red-500 text-red-600'
                  : 'text-gray-500'
              }`}
            >
              <FileText className="h-5 w-5" />
              <span>Assessment</span>
            </button>
            <button
              onClick={() => setActiveTab('calculator')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'calculator'
                  ? 'border-b-2 border-red-500 text-red-600'
                  : 'text-gray-500'
              }`}
            >
              <Calculator className="h-5 w-5" />
              <span>Parkland Calculator</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'history'
                  ? 'border-b-2 border-red-500 text-red-600'
                  : 'text-gray-500'
              }`}
            >
              <History className="h-5 w-5" />
              <span>History</span>
            </button>
          </div>
        </div>

        {activeTab === 'assessment' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Patient Selection & Info */}
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-white rounded-lg shadow p-4">
                <h2 className="font-bold text-gray-900 mb-4 flex items-center">
                  <User className="h-5 w-5 mr-2 text-red-500" />
                  Select Patient
                </h2>
                <div className="relative mb-4">
                  <label htmlFor="burn-patient-search" className="sr-only">Search patients</label>
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    id="burn-patient-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search patients..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {filteredPatients.map(patient => (
                    <button
                      key={patient.patient_id}
                      onClick={() => setSelectedPatient(patient)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedPatient?.patient_id === patient.patient_id
                          ? 'bg-red-100 border-2 border-red-500'
                          : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                      }`}
                    >
                      <p className="font-medium text-gray-900">{patient.full_name}</p>
                      <p className="text-sm text-gray-500">{patient.patient_id}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Injury Details */}
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <Clock className="h-5 w-5 mr-2 text-red-500" />
                  Injury Details
                </h3>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="burn-mechanism" className="block text-sm font-medium text-gray-700 mb-1">Mechanism</label>
                    <select
                      id="burn-mechanism"
                      value={mechanism}
                      onChange={(e) => setMechanism(e.target.value as BurnMechanism)}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      {mechanismOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="burn-agent-source" className="block text-sm font-medium text-gray-700 mb-1">Agent/Source</label>
                    <input
                      id="burn-agent-source"
                      type="text"
                      value={agentSource}
                      onChange={(e) => setAgentSource(e.target.value)}
                      placeholder="e.g., Open flame, Hot water"
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="burn-injury-time" className="block text-sm font-medium text-gray-700 mb-1">Time of Injury</label>
                    <input
                      id="burn-injury-time"
                      type="time"
                      value={injuryTime}
                      onChange={(e) => setInjuryTime(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="burn-patient-weight" className="block text-sm font-medium text-gray-700 mb-1">Patient Weight (kg)</label>
                    <input
                      id="burn-patient-weight"
                      type="number"
                      value={weight}
                      onChange={(e) => setWeight(Number(e.target.value))}
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <label htmlFor="burn-is-child" className="flex items-center space-x-2 cursor-pointer">
                    <input
                      id="burn-is-child"
                      type="checkbox"
                      checked={isChild}
                      onChange={() => setIsChild(!isChild)}
                      className="rounded border-gray-300 text-red-600"
                    />
                    <span className="text-sm">Pediatric Patient (adjusted Rule of 9s)</span>
                  </label>
                </div>
              </div>

              {/* Tetanus & Pain */}
              <div className="bg-white rounded-lg shadow p-4">
                <div className="space-y-3">
                  <div>
                    <label htmlFor="burn-tetanus-status" className="block text-sm font-medium text-gray-700 mb-1">Tetanus Status</label>
                    <select
                      id="burn-tetanus-status"
                      value={tetanusStatus}
                      onChange={(e) => setTetanusStatus(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value="unknown">Unknown</option>
                      <option value="current">Current (&lt;5 years)</option>
                      <option value="needs-booster">Needs Booster (5-10 years)</option>
                      <option value="needs-series">Needs Full Series (&gt;10 years)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="burn-pain-level" className="block text-sm font-medium text-gray-700 mb-1">
                      Pain Level: {painLevel}/10
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
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>None</span>
                      <span>Moderate</span>
                      <span>Severe</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Assessment */}
            <div className="lg:col-span-2 space-y-6">
              {/* Rule of 9s Body Map */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                  <Ruler className="h-6 w-6 mr-2 text-red-500" />
                  Rule of 9s - Body Surface Area
                </h2>
                <div className="mb-4 p-3 bg-blue-50 rounded-lg flex items-start">
                  <Info className="h-5 w-5 mr-2 text-blue-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-700">
                    Enter the percentage of each body region affected. The system will calculate total BSA.
                    {isChild && ' Using pediatric adjustments for Rule of 9s.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {bodyRegions.map(region => {
                    const maxPercent = isChild ? region.childPercentage : region.adultPercentage;
                    const currentPercent = getBurnAreaValue(region.id, 'percentage') as number;
                    const currentDepth = getBurnAreaValue(region.id, 'depth') as BurnDepth;

                    return (
                      <div key={region.id} className={`p-3 rounded-lg border ${currentPercent > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium text-gray-900">{region.name}</span>
                          <span className="text-sm text-gray-500">Max: {maxPercent}%</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor={`burn-percent-${region.id}`} className="block text-xs text-gray-500 mb-1">% Affected</label>
                            <input
                              id={`burn-percent-${region.id}`}
                              type="number"
                              min="0"
                              max={maxPercent}
                              step="0.5"
                              value={currentPercent}
                              onChange={(e) => updateBurnArea(region.id, 'percentage', Math.min(maxPercent, Number(e.target.value)))}
                              className="w-full p-1 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`burn-depth-${region.id}`} className="block text-xs text-gray-500 mb-1">Depth</label>
                            <select
                              id={`burn-depth-${region.id}`}
                              value={currentDepth}
                              onChange={(e) => updateBurnArea(region.id, 'depth', e.target.value as BurnDepth)}
                              disabled={currentPercent === 0}
                              className="w-full p-1 border border-gray-300 rounded text-sm"
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
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <h4 className="font-medium text-gray-700 mb-2">Burn Depth Reference:</h4>
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
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <AlertTriangle className="h-5 w-5 mr-2 text-red-500" />
                  Inhalation Injury Assessment
                </h3>
                <label htmlFor="burn-inhalation-suspected" className="flex items-center space-x-2 mb-4 cursor-pointer">
                  <input
                    id="burn-inhalation-suspected"
                    type="checkbox"
                    checked={inhalationInjury.suspected}
                    onChange={() => setInhalationInjury(prev => ({ ...prev, suspected: !prev.suspected }))}
                    className="rounded border-gray-300 text-red-600"
                  />
                  <span className="font-medium">Inhalation Injury Suspected</span>
                </label>
                {inhalationInjury.suspected && (
                  <div className="grid grid-cols-2 gap-4 pl-6">
                    {[
                      { key: 'singedHairs', label: 'Singed Nasal/Facial Hair' },
                      { key: 'sootInAirway', label: 'Soot in Mouth/Airway' },
                      { key: 'hoarseness', label: 'Hoarseness' },
                      { key: 'stridor', label: 'Stridor' },
                      { key: 'carbonMonoxide', label: 'CO Poisoning Suspected' }
                    ].map(({ key, label }) => (
                      <label key={key} htmlFor={`burn-inhalation-${key}`} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          id={`burn-inhalation-${key}`}
                          type="checkbox"
                          checked={inhalationInjury[key as keyof typeof inhalationInjury] as boolean}
                          onChange={() => setInhalationInjury(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
                          className="rounded border-gray-300 text-red-600"
                        />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                    {inhalationInjury.carbonMonoxide && (
                      <div className="col-span-2">
                        <label htmlFor="burn-co-level" className="block text-sm font-medium text-gray-700 mb-1">CO Level (%)</label>
                        <input
                          id="burn-co-level"
                          type="number"
                          value={inhalationInjury.coLevel || ''}
                          onChange={(e) => setInhalationInjury(prev => ({ ...prev, coLevel: Number(e.target.value) }))}
                          placeholder="Enter carboxyhemoglobin level"
                          className="w-full p-2 border border-gray-300 rounded"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Circumferential Burns */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center">
                  <AlertCircle className="h-5 w-5 mr-2 text-purple-500" />
                  Circumferential Burns
                </h3>
                <label htmlFor="burn-circumferential" className="flex items-center space-x-2 mb-4 cursor-pointer">
                  <input
                    id="burn-circumferential"
                    type="checkbox"
                    checked={circumferential.present}
                    onChange={() => setCircumferential(prev => ({ ...prev, present: !prev.present }))}
                    className="rounded border-gray-300 text-purple-600"
                  />
                  <span className="font-medium">Circumferential Burns Present</span>
                </label>
                {circumferential.present && (
                  <div className="pl-6 space-y-4">
                    <div>
                      <span className="block text-sm font-medium text-gray-700 mb-2">Locations</span>
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Circumferential burn locations">
                        {circumferentialLocations.map(loc => (
                          <button
                            key={loc}
                            type="button"
                            onClick={() => toggleCircumferentialLocation(loc)}
                            className={`px-3 py-1 rounded-full text-sm ${
                              circumferential.locations.includes(loc)
                                ? 'bg-purple-500 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
                        className="rounded border-gray-300 text-red-600"
                      />
                      <span className="text-sm font-medium text-red-600">Escharotomy Needed</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Associated Injuries & Interventions */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold text-gray-900 mb-3">Associated Injuries</h3>
                  <div className="flex flex-wrap gap-2">
                    {associatedInjuryOptions.map(injury => (
                      <button
                        key={injury}
                        type="button"
                        onClick={() => toggleAssociatedInjury(injury)}
                        className={`px-3 py-1 rounded-full text-sm ${
                          associatedInjuries.includes(injury)
                            ? 'bg-yellow-500 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {injury}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold text-gray-900 mb-3">Interventions</h3>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {interventionOptions.map(intervention => (
                      <label key={intervention} htmlFor={`burn-intervention-${intervention.toLowerCase().replace(/\s+/g, '-')}`} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          id={`burn-intervention-${intervention.toLowerCase().replace(/\s+/g, '-')}`}
                          type="checkbox"
                          checked={interventions.includes(intervention)}
                          onChange={() => toggleIntervention(intervention)}
                          className="rounded border-gray-300 text-green-600"
                        />
                        <span className="text-sm">{intervention}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="bg-white rounded-lg shadow p-6">
                <label htmlFor="burn-notes" className="font-bold text-gray-900 mb-4 block">Additional Notes</label>
                <textarea
                  id="burn-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional observations, burn wound description, patient response..."
                  rows={4}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                />
              </div>

              {/* Submit Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={isSubmitting || !selectedPatient}
                  className="bg-red-600 text-white px-8 py-3 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="animate-spin h-5 w-5 mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-5 w-5 mr-2" />
                      Save Assessment
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'calculator' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
              <Calculator className="h-6 w-6 mr-2 text-red-500" />
              Parkland Formula Calculator
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <h3 className="font-bold mb-3">Input Parameters</h3>
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="burn-calc-weight" className="block text-sm font-medium text-gray-700 mb-1">Patient Weight (kg)</label>
                      <input
                        id="burn-calc-weight"
                        type="number"
                        value={weight}
                        onChange={(e) => setWeight(Number(e.target.value))}
                        className="w-full p-2 border border-gray-300 rounded"
                      />
                    </div>
                    <div>
                      <label htmlFor="burn-total-bsa" className="block text-sm font-medium text-gray-700 mb-1">Total BSA (%)</label>
                      <input
                        id="burn-total-bsa"
                        type="number"
                        value={totalBSA}
                        readOnly
                        className="w-full p-2 border border-gray-300 rounded bg-gray-100"
                      />
                      <p className="text-xs text-gray-500 mt-1">Calculated from body region entries</p>
                    </div>
                    <div>
                      <label htmlFor="burn-fluid-start" className="block text-sm font-medium text-gray-700 mb-1">Time Fluids Started</label>
                      <input
                        id="burn-fluid-start"
                        type="time"
                        value={fluidStartTime}
                        onChange={(e) => setFluidStartTime(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 rounded-lg p-4">
                  <h4 className="font-bold text-blue-800 mb-2">Parkland Formula</h4>
                  <p className="text-blue-700 font-mono text-lg">
                    4 mL × {weight} kg × {totalBSA}% BSA
                  </p>
                  <p className="text-blue-600 mt-2">
                    = <strong>{parklandFluid.total24h.toLocaleString()} mL</strong> in 24 hours
                  </p>
                </div>
              </div>

              <div>
                <div className="bg-green-50 rounded-lg p-4 mb-4">
                  <h3 className="font-bold text-green-800 mb-3">Fluid Administration Schedule</h3>
                  <div className="space-y-4">
                    <div className="border-b border-green-200 pb-3">
                      <p className="text-green-700 font-medium">First 8 Hours (50%)</p>
                      <p className="text-2xl font-bold text-green-800">{parklandFluid.first8h.toLocaleString()} mL</p>
                      <p className="text-green-600">
                        Rate: <strong>{parklandFluid.hourlyFirst8h} mL/hr</strong>
                      </p>
                    </div>
                    <div>
                      <p className="text-green-700 font-medium">Next 16 Hours (50%)</p>
                      <p className="text-2xl font-bold text-green-800">{parklandFluid.next16h.toLocaleString()} mL</p>
                      <p className="text-green-600">
                        Rate: <strong>{parklandFluid.hourlyNext16h} mL/hr</strong>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-50 rounded-lg p-4">
                  <h4 className="font-bold text-yellow-800 mb-2 flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Monitoring
                  </h4>
                  <div>
                    <label htmlFor="burn-urine-output" className="block text-sm font-medium text-yellow-700 mb-1">Urine Output (mL/hr)</label>
                    <input
                      id="burn-urine-output"
                      type="number"
                      value={urineOutput || ''}
                      onChange={(e) => setUrineOutput(Number(e.target.value))}
                      placeholder="Target: 0.5-1 mL/kg/hr"
                      className="w-full p-2 border border-yellow-300 rounded"
                    />
                    <p className="text-xs text-yellow-600 mt-1">
                      Target for adults: 30-50 mL/hr | Children: 1 mL/kg/hr
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-red-50 rounded-lg border border-red-200">
              <h4 className="flex items-center gap-2 font-bold text-red-800 mb-2">
                <AlertTriangle size={18} aria-hidden="true" /> Important Notes
              </h4>
              <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                <li>Start time for the 8-hour period is from time of burn, NOT time of presentation</li>
                <li>Use Lactated Ringer's solution (LR) as first-line crystalloid</li>
                <li>Adjust rate based on urine output - the Parkland formula is a STARTING point</li>
                <li>Consider higher volumes for inhalation injury, electrical burns, or delayed resuscitation</li>
                <li>Monitor for fluid overload signs: pulmonary edema, abdominal compartment syndrome</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
              <History className="h-6 w-6 mr-2 text-red-500" />
              Assessment History
            </h2>
            <div className="text-center py-12 text-gray-500">
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No assessment history available.</p>
              <p className="text-sm mt-1">Previous burn assessments will appear here.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
