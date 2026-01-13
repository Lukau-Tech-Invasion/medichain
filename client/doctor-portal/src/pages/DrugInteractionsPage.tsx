import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
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

  // Drug Database (sample data)
  const [drugDatabase] = useState<Drug[]>([
    {
      drugId: 'DRUG-001',
      name: 'Warfarin',
      genericName: 'warfarin',
      brandNames: ['Coumadin', 'Jantoven'],
      drugClass: 'Anticoagulant',
      route: 'oral',
      form: 'tablet',
      commonDoses: ['1mg', '2mg', '2.5mg', '3mg', '4mg', '5mg', '6mg', '7.5mg', '10mg'],
    },
    {
      drugId: 'DRUG-002',
      name: 'Aspirin',
      genericName: 'aspirin',
      brandNames: ['Bayer', 'Ecotrin', 'Bufferin'],
      drugClass: 'NSAID/Antiplatelet',
      route: 'oral',
      form: 'tablet',
      commonDoses: ['81mg', '325mg', '500mg'],
    },
    {
      drugId: 'DRUG-003',
      name: 'Lisinopril',
      genericName: 'lisinopril',
      brandNames: ['Prinivil', 'Zestril'],
      drugClass: 'ACE Inhibitor',
      route: 'oral',
      form: 'tablet',
      commonDoses: ['2.5mg', '5mg', '10mg', '20mg', '40mg'],
    },
    {
      drugId: 'DRUG-004',
      name: 'Metformin',
      genericName: 'metformin',
      brandNames: ['Glucophage', 'Fortamet', 'Glumetza'],
      drugClass: 'Biguanide',
      route: 'oral',
      form: 'tablet',
      commonDoses: ['500mg', '850mg', '1000mg'],
    },
    {
      drugId: 'DRUG-005',
      name: 'Amoxicillin',
      genericName: 'amoxicillin',
      brandNames: ['Amoxil', 'Moxatag'],
      drugClass: 'Penicillin Antibiotic',
      route: 'oral',
      form: 'capsule',
      commonDoses: ['250mg', '500mg', '875mg'],
    },
    {
      drugId: 'DRUG-006',
      name: 'Simvastatin',
      genericName: 'simvastatin',
      brandNames: ['Zocor'],
      drugClass: 'Statin',
      route: 'oral',
      form: 'tablet',
      commonDoses: ['5mg', '10mg', '20mg', '40mg', '80mg'],
    },
    {
      drugId: 'DRUG-007',
      name: 'Omeprazole',
      genericName: 'omeprazole',
      brandNames: ['Prilosec', 'Losec'],
      drugClass: 'Proton Pump Inhibitor',
      route: 'oral',
      form: 'capsule',
      commonDoses: ['10mg', '20mg', '40mg'],
    },
    {
      drugId: 'DRUG-008',
      name: 'Levothyroxine',
      genericName: 'levothyroxine',
      brandNames: ['Synthroid', 'Levoxyl', 'Unithroid'],
      drugClass: 'Thyroid Hormone',
      route: 'oral',
      form: 'tablet',
      commonDoses: ['25mcg', '50mcg', '75mcg', '88mcg', '100mcg', '112mcg', '125mcg', '137mcg', '150mcg'],
    },
    {
      drugId: 'DRUG-009',
      name: 'Amlodipine',
      genericName: 'amlodipine',
      brandNames: ['Norvasc'],
      drugClass: 'Calcium Channel Blocker',
      route: 'oral',
      form: 'tablet',
      commonDoses: ['2.5mg', '5mg', '10mg'],
    },
    {
      drugId: 'DRUG-010',
      name: 'Fluoxetine',
      genericName: 'fluoxetine',
      brandNames: ['Prozac', 'Sarafem'],
      drugClass: 'SSRI Antidepressant',
      route: 'oral',
      form: 'capsule',
      commonDoses: ['10mg', '20mg', '40mg', '60mg'],
    },
  ]);

  // Interaction Database (sample data)
  const [interactionDatabase] = useState<Interaction[]>([
    {
      interactionId: 'INT-001',
      type: 'drug-drug',
      severity: 'major',
      drug1: 'Warfarin',
      drug2: 'Aspirin',
      title: 'Warfarin + Aspirin: Increased Bleeding Risk',
      description: 'Concurrent use of warfarin with aspirin significantly increases the risk of bleeding complications.',
      mechanism: 'Additive anticoagulant and antiplatelet effects. Both drugs inhibit different pathways in hemostasis, leading to synergistic bleeding risk.',
      clinicalEffects: [
        'Increased risk of major bleeding (GI, intracranial)',
        'Prolonged bleeding time',
        'Elevated INR',
        'Easy bruising',
        'Hematuria or melena',
      ],
      management: [
        'Avoid combination when possible',
        'If combination necessary, use lowest effective aspirin dose (81mg)',
        'Monitor INR more frequently (weekly initially)',
        'Watch for signs of bleeding',
        'Consider PPI for GI protection',
        'Educate patient on bleeding signs',
      ],
      monitoring: [
        'INR every 1-2 weeks until stable',
        'CBC for anemia',
        'Stool guaiac for occult blood',
        'Monitor for bruising, bleeding gums',
      ],
      alternatives: [
        'Use aspirin alone for cardiovascular protection if anticoagulation can be stopped',
        'Consider alternative anticoagulant if aspirin essential',
        'Evaluate risk/benefit of combination therapy',
      ],
      evidenceLevel: 'A',
      references: [
        'Holbrook AM, et al. Arch Intern Med. 2005;165(10):1095-1106.',
        'Johnson SG, et al. Am Heart J. 2008;155(5):918-924.',
      ],
      onset: 'Immediate (within days)',
      documentation: 'Well-established',
      riskFactors: ['Age >65', 'History of bleeding', 'Renal impairment', 'Peptic ulcer disease'],
    },
    {
      interactionId: 'INT-002',
      type: 'drug-drug',
      severity: 'moderate',
      drug1: 'Lisinopril',
      drug2: 'Aspirin',
      title: 'ACE Inhibitors + NSAIDs: Reduced Antihypertensive Effect',
      description: 'NSAIDs may reduce the antihypertensive effect of ACE inhibitors and increase risk of renal impairment.',
      mechanism: 'NSAIDs inhibit prostaglandin synthesis, which is important for ACE inhibitor-mediated vasodilation and natriuresis.',
      clinicalEffects: [
        'Reduced blood pressure control',
        'Increased risk of acute kidney injury',
        'Hyperkalemia',
        'Sodium and fluid retention',
      ],
      management: [
        'Monitor blood pressure closely',
        'Check renal function and potassium',
        'Use lowest effective NSAID dose for shortest duration',
        'Consider alternative analgesic (acetaminophen)',
      ],
      monitoring: [
        'Blood pressure weekly during NSAID therapy',
        'Serum creatinine and potassium baseline and after 1 week',
        'Volume status',
      ],
      alternatives: ['Acetaminophen for pain', 'Topical NSAIDs', 'COX-2 selective inhibitor (caution still needed)'],
      evidenceLevel: 'B',
      references: [
        'Fournier JP, et al. BMJ. 2012;344:e4128.',
        'Lapi F, et al. Drug Saf. 2013;36(10):899-918.',
      ],
      onset: 'Days to weeks',
      documentation: 'Established',
      riskFactors: ['Pre-existing renal disease', 'Volume depletion', 'Age >65', 'Diabetes'],
    },
    {
      interactionId: 'INT-003',
      type: 'drug-drug',
      severity: 'major',
      drug1: 'Simvastatin',
      drug2: 'Fluoxetine',
      title: 'Simvastatin + Fluoxetine: Increased Statin Levels',
      description: 'Fluoxetine inhibits CYP3A4, increasing simvastatin levels and risk of myopathy/rhabdomyolysis.',
      mechanism: 'Fluoxetine is a moderate CYP3A4 inhibitor. Simvastatin is extensively metabolized by CYP3A4.',
      clinicalEffects: [
        'Increased simvastatin plasma concentrations',
        'Myalgia and muscle weakness',
        'Elevated creatine kinase (CK)',
        'Rhabdomyolysis (rare but serious)',
        'Acute kidney injury from myoglobinuria',
      ],
      management: [
        'Reduce simvastatin dose (max 20mg daily with moderate CYP3A4 inhibitor)',
        'Monitor for muscle symptoms',
        'Check CK if symptoms develop',
        'Consider alternative statin not metabolized by CYP3A4 (rosuvastatin, pravastatin)',
      ],
      monitoring: [
        'Baseline CK',
        'Patient education on myopathy symptoms',
        'CK if muscle pain/weakness',
        'Renal function',
      ],
      alternatives: [
        'Switch to rosuvastatin or pravastatin',
        'Switch to alternative SSRI with less CYP3A4 inhibition (sertraline)',
      ],
      evidenceLevel: 'B',
      references: [
        'FDA Drug Safety Communication on Simvastatin',
        'Law M, Rudnicka AR. Am J Cardiovasc Drugs. 2006;6(6):343-348.',
      ],
      onset: 'Days to weeks',
      documentation: 'Established',
      riskFactors: ['High simvastatin dose', 'Renal impairment', 'Hypothyroidism', 'Age >65', 'Female gender'],
    },
    {
      interactionId: 'INT-004',
      type: 'drug-drug',
      severity: 'moderate',
      drug1: 'Metformin',
      drug2: 'Lisinopril',
      title: 'Metformin + ACE Inhibitors: Hypoglycemia Risk',
      description: 'ACE inhibitors may enhance the hypoglycemic effect of metformin.',
      mechanism: 'ACE inhibitors may improve insulin sensitivity and glucose uptake.',
      clinicalEffects: [
        'Increased risk of hypoglycemia',
        'Enhanced glucose-lowering effect',
        'Symptoms: tremor, sweating, confusion, tachycardia',
      ],
      management: [
        'Monitor blood glucose more frequently when initiating ACE inhibitor',
        'Educate patient on hypoglycemia symptoms',
        'May need to adjust metformin or other antidiabetic dose',
        'Generally beneficial interaction for diabetic patients',
      ],
      monitoring: [
        'Blood glucose daily initially',
        'HbA1c at 3 months',
        'Hypoglycemia symptoms',
      ],
      alternatives: ['Generally continue both medications', 'Adjust doses as needed based on glucose control'],
      evidenceLevel: 'C',
      references: [
        'Paolisso G, et al. J Clin Invest. 1992;89(4):1295-1300.',
        'Tokmakidis SP, et al. Diabetes Care. 2003;26(7):2119-2125.',
      ],
      onset: 'Days to weeks',
      documentation: 'Probable',
      riskFactors: ['Elderly', 'Renal impairment', 'Tight glycemic control', 'Irregular meals'],
    },
    {
      interactionId: 'INT-005',
      type: 'drug-drug',
      severity: 'moderate',
      drug1: 'Levothyroxine',
      drug2: 'Omeprazole',
      title: 'Levothyroxine + PPIs: Reduced Levothyroxine Absorption',
      description: 'PPIs increase gastric pH, which may reduce levothyroxine absorption.',
      mechanism: 'Levothyroxine absorption is pH-dependent. Increased gastric pH from PPI reduces dissolution and absorption.',
      clinicalEffects: [
        'Reduced levothyroxine efficacy',
        'Elevated TSH',
        'Hypothyroid symptoms may recur',
      ],
      management: [
        'Separate administration by at least 4 hours',
        'Take levothyroxine first thing in the morning on empty stomach',
        'Take PPI later in the day',
        'Monitor TSH 6-8 weeks after PPI initiation',
        'May need to increase levothyroxine dose',
      ],
      monitoring: [
        'TSH and free T4 at 6-8 weeks',
        'Clinical symptoms of hypothyroidism',
      ],
      alternatives: ['H2 antagonist instead of PPI if appropriate', 'Antacids (though also affect absorption)'],
      evidenceLevel: 'C',
      references: [
        'Centanni M, et al. N Engl J Med. 2006;354(17):1787-1795.',
        'Vita R, et al. J Clin Endocrinol Metab. 2014;99(6):1954-1961.',
      ],
      onset: 'Weeks',
      documentation: 'Probable',
      riskFactors: ['Marginal thyroid function', 'High PPI dose', 'Long-term PPI use'],
    },
    {
      interactionId: 'INT-006',
      type: 'drug-allergy',
      severity: 'contraindicated',
      drug1: 'Amoxicillin',
      allergen: 'Penicillin',
      title: 'Amoxicillin in Penicillin-Allergic Patients',
      description: 'Absolute contraindication to use amoxicillin (a penicillin) in patients with documented penicillin allergy.',
      mechanism: 'Cross-reactivity due to shared beta-lactam ring structure.',
      clinicalEffects: [
        'Immediate hypersensitivity reaction',
        'Urticaria, angioedema',
        'Bronchospasm',
        'Anaphylaxis (life-threatening)',
        'Stevens-Johnson syndrome (rare)',
      ],
      management: [
        'DO NOT ADMINISTER',
        'Use alternative antibiotic class',
        'If beta-lactam essential, consider allergy testing and possible desensitization',
        'Update allergy list in medical record',
      ],
      monitoring: ['N/A - do not use'],
      alternatives: [
        'Macrolides (azithromycin, clarithromycin)',
        'Fluoroquinolones (levofloxacin, moxifloxacin)',
        'Cephalosporins (use with caution, 1-10% cross-reactivity)',
      ],
      evidenceLevel: 'A',
      references: [
        'Joint Task Force on Practice Parameters. J Allergy Clin Immunol. 2010;125(3 Suppl 2):S126-137.',
        'Macy E, Contreras R. Clin Infect Dis. 2014;58(7):942-948.',
      ],
      onset: 'Immediate to hours',
      documentation: 'Well-established',
      riskFactors: ['History of severe reaction', 'Atopy', 'Previous penicillin reaction'],
    },
  ]);

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

  const handleCheckInteractions = () => {
    setIsChecking(true);
    
    // Simulate API call delay
    setTimeout(() => {
      const foundInteractions: Interaction[] = [];
      
      // Check all drug pairs
      for (let i = 0; i < selectedDrugs.length; i++) {
        for (let j = i + 1; j < selectedDrugs.length; j++) {
          const drug1 = selectedDrugs[i].name;
          const drug2 = selectedDrugs[j].name;
          
          const interaction = interactionDatabase.find(
            (int) =>
              (int.drug1 === drug1 && int.drug2 === drug2) ||
              (int.drug1 === drug2 && int.drug2 === drug1)
          );
          
          if (interaction) {
            foundInteractions.push(interaction);
          }
        }
        
        // Check drug-allergy
        if (patientContext.allergies.length > 0) {
          patientContext.allergies.forEach((allergen) => {
            const interaction = interactionDatabase.find(
              (int) =>
                int.type === 'drug-allergy' &&
                int.drug1 === selectedDrugs[i].name &&
                int.allergen?.toLowerCase() === allergen.toLowerCase()
            );
            
            if (interaction) {
              foundInteractions.push(interaction);
            }
          });
        }
      }
      
      setInteractions(foundInteractions);
      
      // Create check record
      const check: InteractionCheck = {
        checkId: `CHECK-${Date.now()}`,
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
        checkedBy: user?.userId || 'Unknown',
      };
      
      setChecks([check, ...checks]);
      setShowResults(true);
      setIsChecking(false);
    }, 1000);
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
            <h1 className="text-3xl font-bold">Drug Interaction Checker</h1>
            <p className="text-purple-100 mt-1">Check for drug-drug, drug-allergy, and other medication interactions</p>
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
          Interaction Checker
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'history'
              ? 'border-b-2 border-purple-600 text-purple-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Check History ({checks.length})
        </button>
        <button
          onClick={() => setActiveTab('database')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'database'
              ? 'border-b-2 border-purple-600 text-purple-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Interaction Database ({interactionDatabase.length})
        </button>
      </div>

      {/* Checker Tab */}
      {activeTab === 'checker' && (
        <div className="space-y-6">
          {/* Drug Selection */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Select Medications</h2>
            
            {/* Drug Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={drugSearch}
                onChange={(e) => setDrugSearch(e.target.value)}
                placeholder="Search by drug name, generic name, or class..."
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
                        Generic: {drug.genericName} | Class: {drug.drugClass}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Brand names: {drug.brandNames.join(', ')}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Drugs */}
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900 mb-3">
                Selected Medications ({selectedDrugs.length})
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
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Pill className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>No medications selected</p>
                  <p className="text-sm">Search and add medications above to check for interactions</p>
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
                      Checking...
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5" />
                      Check Interactions
                    </>
                  )}
                </button>
                <button
                  onClick={handleClearDrugs}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Clear All
                </button>
              </div>
            )}
          </div>

          {/* Patient Context (Optional) */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Patient Context (Optional)</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient ID</label>
                <input
                  type="text"
                  value={patientContext.patientId}
                  onChange={(e) => setPatientContext({ ...patientContext, patientId: e.target.value })}
                  placeholder="e.g., PAT-001"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
                <input
                  type="number"
                  value={patientContext.age || ''}
                  onChange={(e) => setPatientContext({ ...patientContext, age: parseInt(e.target.value) || 0 })}
                  placeholder="Years"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Weight</label>
                <input
                  type="number"
                  value={patientContext.weight || ''}
                  onChange={(e) => setPatientContext({ ...patientContext, weight: parseFloat(e.target.value) || 0 })}
                  placeholder="kg"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Known Allergies (comma-separated)
              </label>
              <input
                type="text"
                value={patientContext.allergies.join(', ')}
                onChange={(e) =>
                  setPatientContext({
                    ...patientContext,
                    allergies: e.target.value.split(',').map((a) => a.trim()).filter((a) => a),
                  })
                }
                placeholder="e.g., Penicillin, Sulfa, Latex"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Results */}
          {showResults && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  Interaction Results ({interactions.length})
                </h2>
                {interactions.length > 0 && (
                  <div className="flex gap-2">
                    <select
                      value={severityFilter}
                      onChange={(e) => setSeverityFilter(e.target.value as InteractionSeverity | 'all')}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                    >
                      <option value="all">All Severities</option>
                      <option value="contraindicated">Contraindicated</option>
                      <option value="major">Major</option>
                      <option value="moderate">Moderate</option>
                      <option value="minor">Minor</option>
                    </select>
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value as InteractionType | 'all')}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                    >
                      <option value="all">All Types</option>
                      <option value="drug-drug">Drug-Drug</option>
                      <option value="drug-allergy">Drug-Allergy</option>
                      <option value="drug-condition">Drug-Condition</option>
                      <option value="drug-food">Drug-Food</option>
                      <option value="drug-lab">Drug-Lab</option>
                    </select>
                  </div>
                )}
              </div>

              {interactions.length === 0 ? (
                <div className="text-center py-12 bg-green-50 rounded-lg border-2 border-green-200">
                  <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
                  <h3 className="text-xl font-semibold text-green-800 mb-2">No Interactions Detected</h3>
                  <p className="text-green-700">
                    The selected medications do not have known interactions in our database.
                  </p>
                  <p className="text-sm text-green-600 mt-2">
                    Always review full prescribing information and use clinical judgment.
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
                                {interaction.severity.toUpperCase()}
                              </span>
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeBadge(interaction.type)}`}>
                                {interaction.type.replace('-', ' ')}
                              </span>
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getEvidenceBadge(interaction.evidenceLevel)}`}>
                                Evidence: {interaction.evidenceLevel}
                              </span>
                            </div>
                            <p className="text-gray-700 mb-2">{interaction.description}</p>
                            <div className="flex items-center gap-4 text-sm text-gray-600">
                              <span className="flex items-center gap-1">
                                <Activity className="w-4 h-4" />
                                Onset: {interaction.onset}
                              </span>
                              <span className="flex items-center gap-1">
                                <FileText className="w-4 h-4" />
                                Documentation: {interaction.documentation}
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
                                Mechanism
                              </h4>
                              <p className="text-gray-700 text-sm">{interaction.mechanism}</p>
                            </div>

                            {/* Clinical Effects */}
                            <div>
                              <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-orange-600" />
                                Clinical Effects
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
                                Management Recommendations
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
                                Monitoring Parameters
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
                                  Alternative Options
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
                                  Risk Factors
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
                                References
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
                      Check ID: {check.checkId}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                      <Calendar className="w-4 h-4" />
                      {formatDate(check.timestamp)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <User className="w-4 h-4" />
                      Checked by: {check.checkedBy}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-purple-600">{check.totalInteractions}</div>
                    <div className="text-sm text-gray-600">Interactions</div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold text-gray-900 mb-2">Medications Checked:</h4>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {check.drugs.map((drug, idx) => (
                      <span key={idx} className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                        {drug}
                      </span>
                    ))}
                  </div>

                  <h4 className="font-semibold text-gray-900 mb-2">By Severity:</h4>
                  <div className="grid grid-cols-5 gap-2">
                    {check.bySeverity.contraindicated > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded p-2 text-center">
                        <div className="text-xl font-bold text-red-600">{check.bySeverity.contraindicated}</div>
                        <div className="text-xs text-red-700">Contraindicated</div>
                      </div>
                    )}
                    {check.bySeverity.major > 0 && (
                      <div className="bg-orange-50 border border-orange-200 rounded p-2 text-center">
                        <div className="text-xl font-bold text-orange-600">{check.bySeverity.major}</div>
                        <div className="text-xs text-orange-700">Major</div>
                      </div>
                    )}
                    {check.bySeverity.moderate > 0 && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-center">
                        <div className="text-xl font-bold text-yellow-600">{check.bySeverity.moderate}</div>
                        <div className="text-xs text-yellow-700">Moderate</div>
                      </div>
                    )}
                    {check.bySeverity.minor > 0 && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2 text-center">
                        <div className="text-xl font-bold text-blue-600">{check.bySeverity.minor}</div>
                        <div className="text-xs text-blue-700">Minor</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No check history</h3>
              <p className="text-gray-500">Your interaction checks will appear here</p>
            </div>
          )}
        </div>
      )}

      {/* Database Tab */}
      {activeTab === 'database' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              Interaction Database ({interactionDatabase.length} interactions)
            </h2>
            <p className="text-gray-600 mb-4">
              Browse all known drug interactions in the database. This is a reference for clinical decision-making.
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
                          {interaction.severity}
                        </span>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeBadge(interaction.type)}`}>
                          {interaction.type}
                        </span>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getEvidenceBadge(interaction.evidenceLevel)}`}>
                          Evidence: {interaction.evidenceLevel}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 mb-2">{interaction.description}</p>
                      <div className="text-xs text-gray-500">
                        {interaction.drug1}
                        {interaction.drug2 && ` + ${interaction.drug2}`}
                        {interaction.allergen && ` + ${interaction.allergen} allergy`}
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
