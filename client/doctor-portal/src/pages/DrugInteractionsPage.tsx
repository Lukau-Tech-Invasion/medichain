import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { apiUrl, useTranslation } from '@medichain/shared';
import {
  AlertTriangle,
  Search,
  X,
  Pill,
  AlertCircle,
  Info,
  CheckCircle,
  ShieldAlert,
  Book,
  User,
  Calendar,
  Activity,
  TrendingUp,
  FileText,
  ExternalLink,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';

// ===== PART 1: Types, State, Data, Helpers =====

// Type Definitions
type InteractionSeverity = 'contraindicated' | 'major' | 'moderate' | 'minor' | 'unknown';
type InteractionType = 'drug-drug' | 'drug-allergy' | 'drug-condition' | 'drug-food' | 'drug-lab';
type EvidenceLevel = 'A' | 'B' | 'C' | 'D';

interface Drug {
  drugId: string;
  name: string;
  genericName: string;
  brandNames: string[];
  drugClass: string;
  route: string;
  form: string;
  commonDoses: string[];
}

interface Interaction {
  interactionId: string;
  type: InteractionType;
  severity: InteractionSeverity;
  drug1: string;
  drug2?: string;
  allergen?: string;
  condition?: string;
  food?: string;
  title: string;
  description: string;
  mechanism: string;
  clinicalEffects: string[];
  management: string[];
  monitoring: string[];
  alternatives?: string[];
  evidenceLevel: EvidenceLevel;
  references: string[];
  onset: string;
  documentation: string;
  riskFactors?: string[];
}

interface PatientContext {
  patientId: string;
  age: number;
  weight: number;
  allergies: string[];
  conditions: string[];
  renalFunction?: string;
  hepaticFunction?: string;
  currentMedications: string[];
}

interface InteractionCheck {
  checkId: string;
  drugs: string[];
  patientContext?: PatientContext;
  timestamp: string;
  interactions: Interaction[];
  totalInteractions: number;
  bySeverity: {
    contraindicated: number;
    major: number;
    moderate: number;
    minor: number;
    unknown: number;
  };
  checkedBy: string;
}

const DrugInteractionsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  // State Management
  const [selectedDrugs, setSelectedDrugs] = useState<Drug[]>([]);
  const [drugSearch, setDrugSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Drug[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [checks, setChecks] = useState<InteractionCheck[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [activeTab, setActiveTab] = useState<'checker' | 'history' | 'database'>('checker');
  const [severityFilter, setSeverityFilter] = useState<InteractionSeverity | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<InteractionType | 'all'>('all');
  const [expandedInteractions, setExpandedInteractions] = useState<Set<string>>(new Set());
  const [patientContext, setPatientContext] = useState<PatientContext>({
    patientId: '',
    age: 0,
    weight: 0,
    allergies: [],
    conditions: [],
    currentMedications: [],
  });

  // Loading/Error state for drugs
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drug Database - fetched from API
  const [drugDatabase, setDrugDatabase] = useState<Drug[]>([]);

  // Load drug database from API
  useEffect(() => {
    const fetchDrugs = async () => {
      if (!user?.walletAddress) return;
      
      try {
        const response = await fetch(apiUrl('/api/drugs'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor',
          },
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch drug database');
        }
        
        const data = await response.json();
        if (data.success && data.drugs) {
          setDrugDatabase(data.drugs);
        }
      } catch (err) {
        console.error('Failed to load drug database:', err);
        setError(t('docDrugInteractions.errorLoadDrugsFailed'));
      } finally {
        setLoading(false);
      }
    };
    
    fetchDrugs();
  }, [user?.walletAddress, user?.role]);

  // Interaction Database - fetched from API
  const [interactionDatabase, setInteractionDatabase] = useState<Interaction[]>([]);

  // Load interaction database from API
  useEffect(() => {
    const fetchInteractions = async () => {
      if (!user?.walletAddress) return;
      
      try {
        const response = await fetch(apiUrl('/api/interactions'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor',
          },
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch interaction database');
        }
        
        const data = await response.json();
        if (data.success && data.interactions) {
          setInteractionDatabase(data.interactions);
        }
      } catch (err) {
        console.error('Failed to load interaction database:', err);
      }
    };
    
    fetchInteractions();
  }, [user?.walletAddress, user?.role]);

  // Search drugs
  useEffect(() => {
    if (drugSearch.length >= 2) {
      const results = drugDatabase.filter(
        (drug) =>
          drug.name.toLowerCase().includes(drugSearch.toLowerCase()) ||
          drug.genericName.toLowerCase().includes(drugSearch.toLowerCase()) ||
          drug.brandNames.some((brand) => brand.toLowerCase().includes(drugSearch.toLowerCase())) ||
          drug.drugClass.toLowerCase().includes(drugSearch.toLowerCase())
      );
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }, [drugSearch, drugDatabase]);

  // Handler Functions
  const handleAddDrug = (drug: Drug) => {
    if (!selectedDrugs.find((d) => d.drugId === drug.drugId)) {
      setSelectedDrugs([...selectedDrugs, drug]);
      setDrugSearch('');
      setSearchResults([]);
    }
  };

  const handleRemoveDrug = (drugId: string) => {
    setSelectedDrugs(selectedDrugs.filter((d) => d.drugId !== drugId));
    setShowResults(false);
    setInteractions([]);
  };

  const handleCheckInteractions = async () => {
    if (!user?.walletAddress) return;
    
    setIsChecking(true);
    
    try {
      const response = await fetch(apiUrl('/api/interactions/check'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role || 'Doctor',
        },
        body: JSON.stringify({
          patient_id: patientContext.patientId || 'UNKNOWN',
          medications: selectedDrugs.map((d) => d.name),
          include_allergies: patientContext.allergies.length > 0,
          include_conditions: patientContext.conditions.length > 0,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to check interactions');
      }
      
      const data = await response.json();
      
      // Map API response to local Interaction type
      const foundInteractions: Interaction[] = (data.interactions || []).map((int: {
        drug_a: string;
        drug_b: string;
        severity: string;
        description: string;
        clinical_effects: string;
        management: string;
      }, idx: number) => ({
        interactionId: `INT-API-${idx}`,
        type: 'drug-drug' as InteractionType,
        severity: int.severity.toLowerCase() as InteractionSeverity,
        drug1: int.drug_a,
        drug2: int.drug_b,
        title: `${int.drug_a} + ${int.drug_b}: ${int.description}`,
        description: int.description,
        mechanism: int.clinical_effects,
        clinicalEffects: [int.clinical_effects],
        management: [int.management],
        monitoring: [],
        evidenceLevel: 'B' as EvidenceLevel,
        references: [],
        onset: 'Variable',
        documentation: 'Established',
      }));
      
      // Add allergy alerts as interactions
      if (data.allergy_alerts && data.allergy_alerts.length > 0) {
        data.allergy_alerts.forEach((alert: { medication: string; allergen: string; reaction: string }, idx: number) => {
          foundInteractions.push({
            interactionId: `INT-ALLERGY-${idx}`,
            type: 'drug-allergy' as InteractionType,
            severity: 'contraindicated' as InteractionSeverity,
            drug1: alert.medication,
            allergen: alert.allergen,
            title: `${alert.medication}: Allergy Alert - ${alert.allergen}`,
            description: `Patient has documented allergy to ${alert.allergen}`,
            mechanism: 'Allergic cross-reactivity',
            clinicalEffects: [alert.reaction || 'Allergic reaction'],
            management: ['Do not administer', 'Use alternative medication'],
            monitoring: [],
            evidenceLevel: 'A' as EvidenceLevel,
            references: [],
            onset: 'Immediate',
            documentation: 'Well-established',
          });
        });
      }
      
      setInteractions(foundInteractions);
      
      // Create check record
      const check: InteractionCheck = {
        checkId: data.check_id || `CHECK-${Date.now()}`,
        drugs: selectedDrugs.map((d) => d.name),
        patientContext: patientContext.patientId ? patientContext : undefined,
        timestamp: new Date().toISOString(),
        interactions: foundInteractions,
        totalInteractions: foundInteractions.length,
        bySeverity: {
          contraindicated: foundInteractions.filter((i) => i.severity === 'contraindicated').length,
          major: foundInteractions.filter((i) => i.severity === 'major').length,
          moderate: foundInteractions.filter((i) => i.severity === 'moderate').length,
          minor: foundInteractions.filter((i) => i.severity === 'minor').length,
          unknown: foundInteractions.filter((i) => i.severity === 'unknown').length,
        },
        checkedBy: user?.userId || user?.walletAddress || 'Unknown',
      };
      
      setChecks([check, ...checks]);
      setShowResults(true);
    } catch (err) {
      console.error('Failed to check interactions:', err);
      setError(t('docDrugInteractions.errorCheckFailed'));
    } finally {
      setIsChecking(false);
    }
  };

  const handleClearDrugs = () => {
    setSelectedDrugs([]);
    setInteractions([]);
    setShowResults(false);
  };

  const toggleInteractionExpansion = (interactionId: string) => {
    const newExpanded = new Set(expandedInteractions);
    if (newExpanded.has(interactionId)) {
      newExpanded.delete(interactionId);
    } else {
      newExpanded.add(interactionId);
    }
    setExpandedInteractions(newExpanded);
  };

  // Helper Functions
  const getSeverityBadge = (severity: InteractionSeverity): string => {
    switch (severity) {
      case 'contraindicated':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'major':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'moderate':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'minor':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'unknown':
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getSeverityIcon = (severity: InteractionSeverity) => {
    switch (severity) {
      case 'contraindicated':
        return <ShieldAlert className="w-5 h-5 text-red-600" />;
      case 'major':
        return <AlertTriangle className="w-5 h-5 text-orange-600" />;
      case 'moderate':
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      case 'minor':
        return <Info className="w-5 h-5 text-blue-600" />;
      case 'unknown':
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  const getTypeBadge = (type: InteractionType): string => {
    switch (type) {
      case 'drug-drug':
        return 'bg-purple-100 text-purple-800';
      case 'drug-allergy':
        return 'bg-red-100 text-red-800';
      case 'drug-condition':
        return 'bg-blue-100 text-blue-800';
      case 'drug-food':
        return 'bg-green-100 text-green-800';
      case 'drug-lab':
        return 'bg-amber-100 text-amber-800';
    }
  };

  const getEvidenceBadge = (level: EvidenceLevel): string => {
    switch (level) {
      case 'A':
        return 'bg-green-100 text-green-800';
      case 'B':
        return 'bg-blue-100 text-blue-800';
      case 'C':
        return 'bg-yellow-100 text-yellow-800';
      case 'D':
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (isoString: string): string => {
    return new Date(isoString).toLocaleString();
  };

  // Filtered interactions
  const filteredInteractions = interactions.filter((interaction) => {
    const severityMatch = severityFilter === 'all' || interaction.severity === severityFilter;
    const typeMatch = typeFilter === 'all' || interaction.type === typeFilter;
    return severityMatch && typeMatch;
  });

  // ===== PART 1 COMPLETE =====
  // Part 2 will add the complete UI implementation

  return (
    <div className="p-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-500 rounded-lg shadow-lg p-6 mb-6 text-white">
        <div className="flex items-center gap-4">
          <Pill className="w-12 h-12" />
          <div>
            <h1 className="text-3xl font-bold">{t('docDrugInteractions.title')}</h1>
            <p className="text-purple-100 mt-1">{t('docDrugInteractions.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('checker')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'checker'
              ? 'border-b-2 border-purple-600 text-purple-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('docDrugInteractions.tabChecker')}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'history'
              ? 'border-b-2 border-purple-600 text-purple-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('docDrugInteractions.tabHistory', { count: checks.length })}
        </button>
        <button
          onClick={() => setActiveTab('database')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'database'
              ? 'border-b-2 border-purple-600 text-purple-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('docDrugInteractions.tabDatabase', { count: interactionDatabase.length })}
        </button>
      </div>

      {/* Checker Tab */}
      {activeTab === 'checker' && (
        <div className="space-y-6">
          {/* Drug Selection */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">{t('docDrugInteractions.selectMedicationsTitle')}</h2>

            {/* Drug Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={drugSearch}
                onChange={(e) => setDrugSearch(e.target.value)}
                placeholder={t('docDrugInteractions.searchPh')}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />

              {/* Search Results Dropdown */}
              {searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {searchResults.map((drug) => (
                    <button
                      key={drug.drugId}
                      onClick={() => handleAddDrug(drug)}
                      className="w-full text-left px-4 py-3 hover:bg-purple-50 transition-colors border-b last:border-b-0"
                    >
                      <div className="font-medium text-gray-900">{drug.name}</div>
                      <div className="text-sm text-gray-600">
                        {t('docDrugInteractions.genericClassLine', { generic: drug.genericName, drugClass: drug.drugClass })}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {t('docDrugInteractions.brandNamesLine', { names: drug.brandNames.join(', ') })}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Drugs */}
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900 mb-3">
                {t('docDrugInteractions.selectedMedicationsTitle', { count: selectedDrugs.length })}
              </h3>
              {selectedDrugs.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {selectedDrugs.map((drug) => (
                    <div
                      key={drug.drugId}
                      className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Pill className="w-5 h-5 text-purple-600" />
                        <div>
                          <div className="font-medium text-gray-900">{drug.name}</div>
                          <div className="text-sm text-gray-600">{drug.drugClass}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveDrug(drug.drugId)}
                        className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors"
                        aria-label={`Remove ${drug.name}`}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Pill className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>{t('docDrugInteractions.noMedicationsSelected')}</p>
                  <p className="text-sm">{t('docDrugInteractions.noMedicationsHint')}</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {selectedDrugs.length >= 2 && (
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCheckInteractions}
                  disabled={isChecking}
                  className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isChecking ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      {t('docDrugInteractions.checkingBtn')}
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5" />
                      {t('docDrugInteractions.checkInteractionsBtn')}
                    </>
                  )}
                </button>
                <button
                  onClick={handleClearDrugs}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  {t('docDrugInteractions.clearAllBtn')}
                </button>
              </div>
            )}
          </div>

          {/* Patient Context (Optional) */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">{t('docDrugInteractions.patientContextTitle')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="ddi-patient-id" className="block text-sm font-medium text-gray-700 mb-1">{t('docDrugInteractions.patientIdLabel')}</label>
                <input
                  id="ddi-patient-id"
                  type="text"
                  value={patientContext.patientId}
                  onChange={(e) => setPatientContext({ ...patientContext, patientId: e.target.value })}
                  placeholder={t('docDrugInteractions.patientIdPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label htmlFor="ddi-patient-age" className="block text-sm font-medium text-gray-700 mb-1">{t('docDrugInteractions.ageLabel')}</label>
                <input
                  id="ddi-patient-age"
                  type="number"
                  value={patientContext.age || ''}
                  onChange={(e) => setPatientContext({ ...patientContext, age: parseInt(e.target.value) || 0 })}
                  placeholder={t('docDrugInteractions.agePh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label htmlFor="ddi-patient-weight" className="block text-sm font-medium text-gray-700 mb-1">{t('docDrugInteractions.weightLabel')}</label>
                <input
                  id="ddi-patient-weight"
                  type="number"
                  value={patientContext.weight || ''}
                  onChange={(e) => setPatientContext({ ...patientContext, weight: parseFloat(e.target.value) || 0 })}
                  placeholder={t('docDrugInteractions.weightPh')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="ddi-patient-allergies" className="block text-sm font-medium text-gray-700 mb-1">
                {t('docDrugInteractions.allergiesLabel')}
              </label>
              <input
                id="ddi-patient-allergies"
                type="text"
                value={patientContext.allergies.join(', ')}
                onChange={(e) =>
                  setPatientContext({
                    ...patientContext,
                    allergies: e.target.value.split(',').map((a) => a.trim()).filter((a) => a),
                  })
                }
                placeholder={t('docDrugInteractions.allergiesPh')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Results */}
          {showResults && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  {t('docDrugInteractions.resultsTitle', { count: interactions.length })}
                </h2>
                {interactions.length > 0 && (
                  <div className="flex gap-2">
                    <select
                      value={severityFilter}
                      onChange={(e) => setSeverityFilter(e.target.value as InteractionSeverity | 'all')}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                    >
                      <option value="all">{t('docDrugInteractions.filterAllSeverities')}</option>
                      <option value="contraindicated">{t('docDrugInteractions.severity_contraindicated')}</option>
                      <option value="major">{t('docDrugInteractions.severity_major')}</option>
                      <option value="moderate">{t('docDrugInteractions.severity_moderate')}</option>
                      <option value="minor">{t('docDrugInteractions.severity_minor')}</option>
                    </select>
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value as InteractionType | 'all')}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                    >
                      <option value="all">{t('docDrugInteractions.filterAllTypes')}</option>
                      <option value="drug-drug">{t('docDrugInteractions.type_drug-drug')}</option>
                      <option value="drug-allergy">{t('docDrugInteractions.type_drug-allergy')}</option>
                      <option value="drug-condition">{t('docDrugInteractions.type_drug-condition')}</option>
                      <option value="drug-food">{t('docDrugInteractions.type_drug-food')}</option>
                      <option value="drug-lab">{t('docDrugInteractions.type_drug-lab')}</option>
                    </select>
                  </div>
                )}
              </div>

              {interactions.length === 0 ? (
                <div className="text-center py-12 bg-green-50 rounded-lg border-2 border-green-200">
                  <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
                  <h3 className="text-xl font-semibold text-green-800 mb-2">{t('docDrugInteractions.noInteractionsTitle')}</h3>
                  <p className="text-green-700">
                    {t('docDrugInteractions.noInteractionsDesc')}
                  </p>
                  <p className="text-sm text-green-600 mt-2">
                    {t('docDrugInteractions.noInteractionsHint')}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredInteractions.map((interaction) => {
                    const isExpanded = expandedInteractions.has(interaction.interactionId);
                    return (
                      <div
                        key={interaction.interactionId}
                        className={`border-2 rounded-lg p-4 ${
                          interaction.severity === 'contraindicated'
                            ? 'border-red-300 bg-red-50'
                            : interaction.severity === 'major'
                            ? 'border-orange-300 bg-orange-50'
                            : interaction.severity === 'moderate'
                            ? 'border-yellow-300 bg-yellow-50'
                            : 'border-blue-300 bg-blue-50'
                        }`}
                      >
                        {/* Interaction Header */}
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              {getSeverityIcon(interaction.severity)}
                              <h3 className="text-lg font-bold text-gray-900">{interaction.title}</h3>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getSeverityBadge(interaction.severity)}`}>
                                {t(`docDrugInteractions.severity_${interaction.severity}`).toUpperCase()}
                              </span>
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeBadge(interaction.type)}`}>
                                {t(`docDrugInteractions.type_${interaction.type}`)}
                              </span>
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getEvidenceBadge(interaction.evidenceLevel)}`}>
                                {t('docDrugInteractions.evidenceLabel', { level: interaction.evidenceLevel })}
                              </span>
                            </div>
                            <p className="text-gray-700 mb-2">{interaction.description}</p>
                            <div className="flex items-center gap-4 text-sm text-gray-600">
                              <span className="flex items-center gap-1">
                                <Activity className="w-4 h-4" />
                                {t('docDrugInteractions.onsetLabel', { value: interaction.onset })}
                              </span>
                              <span className="flex items-center gap-1">
                                <FileText className="w-4 h-4" />
                                {t('docDrugInteractions.documentationLabel', { value: interaction.documentation })}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => toggleInteractionExpansion(interaction.interactionId)}
                            className="ml-4 p-2 text-gray-600 hover:bg-white rounded-lg transition-colors"
                          >
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                        </div>

                        {/* Expanded Details */}
                        {isExpanded && (
                          <div className="mt-4 space-y-4 border-t pt-4">
                            {/* Mechanism */}
                            <div>
                              <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                <Activity className="w-4 h-4 text-purple-600" />
                                {t('docDrugInteractions.mechanismTitle')}
                              </h4>
                              <p className="text-gray-700 text-sm">{interaction.mechanism}</p>
                            </div>

                            {/* Clinical Effects */}
                            <div>
                              <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-orange-600" />
                                {t('docDrugInteractions.clinicalEffectsTitle')}
                              </h4>
                              <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                {interaction.clinicalEffects.map((effect, idx) => (
                                  <li key={idx}>{effect}</li>
                                ))}
                              </ul>
                            </div>

                            {/* Management */}
                            <div className="bg-white rounded-lg p-4">
                              <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-green-600" />
                                {t('docDrugInteractions.managementTitle')}
                              </h4>
                              <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                {interaction.management.map((item, idx) => (
                                  <li key={idx}>{item}</li>
                                ))}
                              </ul>
                            </div>

                            {/* Monitoring */}
                            <div>
                              <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-blue-600" />
                                {t('docDrugInteractions.monitoringTitle')}
                              </h4>
                              <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                {interaction.monitoring.map((item, idx) => (
                                  <li key={idx}>{item}</li>
                                ))}
                              </ul>
                            </div>

                            {/* Alternatives */}
                            {interaction.alternatives && interaction.alternatives.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                  <Pill className="w-4 h-4 text-green-600" />
                                  {t('docDrugInteractions.alternativesTitle')}
                                </h4>
                                <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                  {interaction.alternatives.map((alt, idx) => (
                                    <li key={idx}>{alt}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Risk Factors */}
                            {interaction.riskFactors && interaction.riskFactors.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                  <AlertTriangle className="w-4 h-4 text-red-600" />
                                  {t('docDrugInteractions.riskFactorsTitle')}
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                  {interaction.riskFactors.map((factor, idx) => (
                                    <span key={idx} className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                                      {factor}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* References */}
                            <div>
                              <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                <Book className="w-4 h-4 text-purple-600" />
                                {t('docDrugInteractions.referencesTitle')}
                              </h4>
                              <ul className="text-xs text-gray-600 space-y-1">
                                {interaction.references.map((ref, idx) => (
                                  <li key={idx} className="flex items-start gap-2">
                                    <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                    {ref}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {checks.length > 0 ? (
            checks.map((check) => (
              <div key={check.checkId} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">
                      {t('docDrugInteractions.checkIdLabel', { id: check.checkId })}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                      <Calendar className="w-4 h-4" />
                      {formatDate(check.timestamp)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <User className="w-4 h-4" />
                      {t('docDrugInteractions.checkedByLabel', { value: check.checkedBy })}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-purple-600">{check.totalInteractions}</div>
                    <div className="text-sm text-gray-600">{t('docDrugInteractions.interactionsLabel')}</div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold text-gray-900 mb-2">{t('docDrugInteractions.medicationsCheckedTitle')}</h4>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {check.drugs.map((drug, idx) => (
                      <span key={idx} className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                        {drug}
                      </span>
                    ))}
                  </div>

                  <h4 className="font-semibold text-gray-900 mb-2">{t('docDrugInteractions.bySeverityTitle')}</h4>
                  <div className="grid grid-cols-5 gap-2">
                    {check.bySeverity.contraindicated > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded p-2 text-center">
                        <div className="text-xl font-bold text-red-600">{check.bySeverity.contraindicated}</div>
                        <div className="text-xs text-red-700">{t('docDrugInteractions.severity_contraindicated')}</div>
                      </div>
                    )}
                    {check.bySeverity.major > 0 && (
                      <div className="bg-orange-50 border border-orange-200 rounded p-2 text-center">
                        <div className="text-xl font-bold text-orange-600">{check.bySeverity.major}</div>
                        <div className="text-xs text-orange-700">{t('docDrugInteractions.severity_major')}</div>
                      </div>
                    )}
                    {check.bySeverity.moderate > 0 && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-center">
                        <div className="text-xl font-bold text-yellow-600">{check.bySeverity.moderate}</div>
                        <div className="text-xs text-yellow-700">{t('docDrugInteractions.severity_moderate')}</div>
                      </div>
                    )}
                    {check.bySeverity.minor > 0 && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2 text-center">
                        <div className="text-xl font-bold text-blue-600">{check.bySeverity.minor}</div>
                        <div className="text-xs text-blue-700">{t('docDrugInteractions.severity_minor')}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">{t('docDrugInteractions.noHistoryTitle')}</h3>
              <p className="text-gray-500">{t('docDrugInteractions.noHistoryHint')}</p>
            </div>
          )}
        </div>
      )}

      {/* Database Tab */}
      {activeTab === 'database' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {t('docDrugInteractions.databaseTitle', { count: interactionDatabase.length })}
            </h2>
            <p className="text-gray-600 mb-4">
              {t('docDrugInteractions.databaseSubtitle')}
            </p>

            <div className="space-y-3">
              {interactionDatabase.map((interaction) => (
                <div
                  key={interaction.interactionId}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        {getSeverityIcon(interaction.severity)}
                        <h3 className="font-semibold text-gray-900">{interaction.title}</h3>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getSeverityBadge(interaction.severity)}`}>
                          {t(`docDrugInteractions.severity_${interaction.severity}`)}
                        </span>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeBadge(interaction.type)}`}>
                          {t(`docDrugInteractions.type_${interaction.type}`)}
                        </span>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getEvidenceBadge(interaction.evidenceLevel)}`}>
                          {t('docDrugInteractions.evidenceLabel', { level: interaction.evidenceLevel })}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 mb-2">{interaction.description}</p>
                      <div className="text-xs text-gray-500">
                        {interaction.drug1}
                        {interaction.drug2 && ` + ${interaction.drug2}`}
                        {interaction.allergen && ` + ${t('docDrugInteractions.allergyLabel', { value: interaction.allergen })}`}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DrugInteractionsPage;
