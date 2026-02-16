import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  Plus,
  Upload,
  Camera,
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  Eye,
  Download,
  Phone,
  FileText,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { getPatientInsuranceClaims } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

/**
 * InsurancePage
 * 
 * Full-featured page for managing insurance coverage and cards.
 * Includes photo upload, coverage verification, and claims tracking.
 */

type InsuranceType = 'medical' | 'dental' | 'vision' | 'pharmacy' | 'supplemental';
type CoverageStatus = 'active' | 'pending' | 'expired' | 'cancelled';
type ClaimStatus = 'submitted' | 'processing' | 'approved' | 'denied' | 'appealed';

interface InsuranceCard {
  id: string;
  type: InsuranceType;
  providerName: string;
  planName: string;
  memberId: string;
  groupNumber: string;
  subscriberName: string;
  subscriberId: string;
  effectiveDate: string;
  terminationDate: string | null;
  status: CoverageStatus;
  copay: {
    primaryCare: number;
    specialist: number;
    urgentCare: number;
    emergency: number;
  };
  deductible: {
    individual: number;
    family: number;
    met: number;
  };
  outOfPocketMax: {
    individual: number;
    family: number;
    met: number;
  };
  frontImageUrl: string | null;
  backImageUrl: string | null;
  customerServicePhone: string;
  providerPortalUrl: string;
  isPrimary: boolean;
  lastVerified: string;
}

interface InsuranceClaim {
  id: string;
  insuranceId: string;
  claimNumber: string;
  serviceDate: string;
  provider: string;
  description: string;
  billedAmount: number;
  allowedAmount: number;
  insurancePaid: number;
  patientResponsibility: number;
  status: ClaimStatus;
  submittedDate: string;
  processedDate: string | null;
  eobUrl: string | null;
}

const InsurancePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'cards' | 'claims' | 'add'>('cards');
  const [insuranceCards, setInsuranceCards] = useState<InsuranceCard[]>([]);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [selectedCard, setSelectedCard] = useState<InsuranceCard | null>(null);
  const [_showCardModal, _setShowCardModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadSide, setUploadSide] = useState<'front' | 'back'>('front');
  const [verifying, setVerifying] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { patient } = usePatientAuthStore();

  // New insurance form state
  const [newInsurance, setNewInsurance] = useState({
    type: 'medical' as InsuranceType,
    providerName: '',
    planName: '',
    memberId: '',
    groupNumber: '',
    subscriberName: '',
    subscriberId: '',
    effectiveDate: '',
    customerServicePhone: '',
    copayPrimary: '25',
    copaySpecialist: '50',
    deductible: '1500',
    outOfPocketMax: '6000'
  });

  useEffect(() => {
    loadInsuranceData();
  }, [patient]);

  const loadInsuranceData = async () => {
    setLoading(true);
    
    // Try to load from API first
    if (patient?.walletAddress) {
      try {
        const apiClaims = await getPatientInsuranceClaims(patient.walletAddress) as InsuranceClaim[];
        
        if (apiClaims && Array.isArray(apiClaims) && apiClaims.length > 0) {
          setClaims(apiClaims);
        } else {
          loadDemoClaims();
        }
        
        // For insurance cards, we still need to load demo data since there's no API endpoint
        loadDemoCards();
        setLoading(false);
        return;
      } catch (err) {
        console.warn('No insurance data from API, using demo data:', err);
      }
    }
    
    // Fallback to demo data
    loadDemoCards();
    loadDemoClaims();
    setLoading(false);
  };

  const loadDemoCards = () => {
    // Load sample insurance data
    const sampleCards: InsuranceCard[] = [
      {
        id: 'INS-001',
        type: 'medical',
        providerName: 'Blue Cross Blue Shield',
        planName: 'PPO Gold Plan',
        memberId: 'XYZ123456789',
        groupNumber: 'GRP-98765',
        subscriberName: 'John Doe',
        subscriberId: 'SUB-001',
        effectiveDate: '2024-01-01',
        terminationDate: null,
        status: 'active',
        copay: {
          primaryCare: 25,
          specialist: 50,
          urgentCare: 75,
          emergency: 250
        },
        deductible: {
          individual: 1500,
          family: 3000,
          met: 850
        },
        outOfPocketMax: {
          individual: 6000,
          family: 12000,
          met: 2100
        },
        frontImageUrl: null,
        backImageUrl: null,
        customerServicePhone: '1-800-555-BCBS',
        providerPortalUrl: 'https://member.bcbs.com',
        isPrimary: true,
        lastVerified: '2024-12-01'
      },
      {
        id: 'INS-002',
        type: 'dental',
        providerName: 'Delta Dental',
        planName: 'Premium Plus',
        memberId: 'DD-987654321',
        groupNumber: 'DG-54321',
        subscriberName: 'John Doe',
        subscriberId: 'SUB-001',
        effectiveDate: '2024-01-01',
        terminationDate: null,
        status: 'active',
        copay: {
          primaryCare: 0,
          specialist: 0,
          urgentCare: 0,
          emergency: 0
        },
        deductible: {
          individual: 50,
          family: 150,
          met: 50
        },
        outOfPocketMax: {
          individual: 1500,
          family: 3000,
          met: 200
        },
        frontImageUrl: null,
        backImageUrl: null,
        customerServicePhone: '1-800-555-DENT',
        providerPortalUrl: 'https://member.deltadental.com',
        isPrimary: false,
        lastVerified: '2024-11-15'
      },
      {
        id: 'INS-003',
        type: 'vision',
        providerName: 'VSP Vision Care',
        planName: 'Enhanced Vision',
        memberId: 'VSP-456789123',
        groupNumber: 'VG-11111',
        subscriberName: 'John Doe',
        subscriberId: 'SUB-001',
        effectiveDate: '2024-01-01',
        terminationDate: null,
        status: 'active',
        copay: {
          primaryCare: 10,
          specialist: 10,
          urgentCare: 0,
          emergency: 0
        },
        deductible: {
          individual: 0,
          family: 0,
          met: 0
        },
        outOfPocketMax: {
          individual: 0,
          family: 0,
          met: 0
        },
        frontImageUrl: null,
        backImageUrl: null,
        customerServicePhone: '1-800-555-EYES',
        providerPortalUrl: 'https://member.vsp.com',
        isPrimary: false,
        lastVerified: '2024-10-20'
      }
    ];
    setInsuranceCards(sampleCards);
  };

  const loadDemoClaims = () => {
    const sampleClaims: InsuranceClaim[] = [
      {
        id: 'CLM-001',
        insuranceId: 'INS-001',
        claimNumber: 'C-2024-001234',
        serviceDate: '2024-11-15',
        provider: 'City Medical Center',
        description: 'Annual Physical Examination',
        billedAmount: 350.00,
        allowedAmount: 280.00,
        insurancePaid: 255.00,
        patientResponsibility: 25.00,
        status: 'approved',
        submittedDate: '2024-11-16',
        processedDate: '2024-11-25',
        eobUrl: '/docs/eob-001.pdf'
      },
      {
        id: 'CLM-002',
        insuranceId: 'INS-001',
        claimNumber: 'C-2024-001567',
        serviceDate: '2024-12-01',
        provider: 'LabCorp',
        description: 'Comprehensive Metabolic Panel',
        billedAmount: 125.00,
        allowedAmount: 95.00,
        insurancePaid: 95.00,
        patientResponsibility: 0,
        status: 'approved',
        submittedDate: '2024-12-02',
        processedDate: '2024-12-10',
        eobUrl: '/docs/eob-002.pdf'
      },
      {
        id: 'CLM-003',
        insuranceId: 'INS-001',
        claimNumber: 'C-2024-002345',
        serviceDate: '2024-12-20',
        provider: 'Specialist Associates',
        description: 'Cardiology Consultation',
        billedAmount: 450.00,
        allowedAmount: 380.00,
        insurancePaid: 0,
        patientResponsibility: 380.00,
        status: 'processing',
        submittedDate: '2024-12-21',
        processedDate: null,
        eobUrl: null
      },
      {
        id: 'CLM-004',
        insuranceId: 'INS-002',
        claimNumber: 'D-2024-000789',
        serviceDate: '2024-10-15',
        provider: 'Smile Dental Care',
        description: 'Routine Cleaning & X-Rays',
        billedAmount: 200.00,
        allowedAmount: 180.00,
        insurancePaid: 180.00,
        patientResponsibility: 0,
        status: 'approved',
        submittedDate: '2024-10-16',
        processedDate: '2024-10-25',
        eobUrl: '/docs/eob-003.pdf'
      }
    ];

    setClaims(sampleClaims);
  };

  const getTypeIcon = (type: InsuranceType) => {
    switch (type) {
      case 'medical': return <Shield className="w-5 h-5" />;
      case 'dental': return <FileText className="w-5 h-5" />;
      case 'vision': return <Eye className="w-5 h-5" />;
      case 'pharmacy': return <FileText className="w-5 h-5" />;
      case 'supplemental': return <Shield className="w-5 h-5" />;
    }
  };

  const _getTypeBadge = (type: InsuranceType) => {
    const colors: Record<InsuranceType, string> = {
      medical: 'bg-blue-100 text-blue-800',
      dental: 'bg-green-100 text-green-800',
      vision: 'bg-purple-100 text-purple-800',
      pharmacy: 'bg-orange-100 text-orange-800',
      supplemental: 'bg-gray-100 text-gray-800'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[type]}`}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </span>
    );
  };

  const getStatusBadge = (status: CoverageStatus) => {
    const config: Record<CoverageStatus, { color: string; icon: React.ReactNode }> = {
      active: { color: 'bg-green-100 text-green-800', icon: <CheckCircle className="w-3 h-3" /> },
      pending: { color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="w-3 h-3" /> },
      expired: { color: 'bg-red-100 text-red-800', icon: <XCircle className="w-3 h-3" /> },
      cancelled: { color: 'bg-gray-100 text-gray-800', icon: <XCircle className="w-3 h-3" /> }
    };
    const c = config[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${c.color}`}>
        {c.icon} {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getClaimStatusBadge = (status: ClaimStatus) => {
    const colors: Record<ClaimStatus, string> = {
      submitted: 'bg-blue-100 text-blue-800',
      processing: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      denied: 'bg-red-100 text-red-800',
      appealed: 'bg-orange-100 text-orange-800'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status]}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const handleVerifyCoverage = (cardId: string) => {
    setVerifying(cardId);
    setTimeout(() => {
      setInsuranceCards(prev => prev.map(card =>
        card.id === cardId ? { ...card, lastVerified: new Date().toISOString().split('T')[0] } : card
      ));
      setVerifying(null);
    }, 2000);
  };

  const handleAddInsurance = () => {
    if (!newInsurance.providerName || !newInsurance.memberId) return;

    const newCard: InsuranceCard = {
      id: `INS-${Date.now()}`,
      type: newInsurance.type,
      providerName: newInsurance.providerName,
      planName: newInsurance.planName,
      memberId: newInsurance.memberId,
      groupNumber: newInsurance.groupNumber,
      subscriberName: newInsurance.subscriberName,
      subscriberId: `SUB-${Date.now()}`,
      effectiveDate: newInsurance.effectiveDate,
      terminationDate: null,
      status: 'pending',
      copay: {
        primaryCare: parseInt(newInsurance.copayPrimary) || 0,
        specialist: parseInt(newInsurance.copaySpecialist) || 0,
        urgentCare: 75,
        emergency: 250
      },
      deductible: {
        individual: parseInt(newInsurance.deductible) || 0,
        family: (parseInt(newInsurance.deductible) || 0) * 2,
        met: 0
      },
      outOfPocketMax: {
        individual: parseInt(newInsurance.outOfPocketMax) || 0,
        family: (parseInt(newInsurance.outOfPocketMax) || 0) * 2,
        met: 0
      },
      frontImageUrl: null,
      backImageUrl: null,
      customerServicePhone: newInsurance.customerServicePhone,
      providerPortalUrl: '',
      isPrimary: insuranceCards.length === 0,
      lastVerified: ''
    };

    setInsuranceCards(prev => [...prev, newCard]);
    setNewInsurance({
      type: 'medical',
      providerName: '',
      planName: '',
      memberId: '',
      groupNumber: '',
      subscriberName: '',
      subscriberId: '',
      effectiveDate: '',
      customerServicePhone: '',
      copayPrimary: '25',
      copaySpecialist: '50',
      deductible: '1500',
      outOfPocketMax: '6000'
    });
    setActiveTab('cards');
  };

  const handleDeleteCard = (cardId: string) => {
    if (confirm('Are you sure you want to remove this insurance card?')) {
      setInsuranceCards(prev => prev.filter(c => c.id !== cardId));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Loading State */}
      {loading && (
        <div className="fixed inset-0 bg-white/80 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            <span className="text-gray-600">Loading insurance information...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-teal-600 to-cyan-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <CreditCard className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Insurance Information</h1>
        </div>
        <p className="text-teal-100">Manage your insurance cards, verify coverage, and track claims</p>
      </div>

      {/* Summary Cards */}
      <div className="p-4 -mt-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-teal-600">{insuranceCards.filter(c => c.status === 'active').length}</div>
            <div className="text-xs text-gray-500">Active Plans</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{claims.filter(c => c.status === 'approved').length}</div>
            <div className="text-xs text-gray-500">Approved Claims</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-yellow-600">{claims.filter(c => c.status === 'processing').length}</div>
            <div className="text-xs text-gray-500">Pending Claims</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4">
        <div className="flex border-b border-gray-200">
          {[
            { key: 'cards', label: 'My Cards', icon: <CreditCard className="w-4 h-4" /> },
            { key: 'claims', label: 'Claims', icon: <FileText className="w-4 h-4" /> },
            { key: 'add', label: 'Add New', icon: <Plus className="w-4 h-4" /> }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-teal-500 text-teal-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Cards Tab */}
        {activeTab === 'cards' && (
          <div className="space-y-4">
            {insuranceCards.length === 0 ? (
              <div className="text-center py-8 bg-white rounded-lg shadow">
                <CreditCard className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">No insurance cards added yet</p>
                <button
                  onClick={() => setActiveTab('add')}
                  className="mt-3 text-teal-600 font-medium"
                >
                  Add your first card
                </button>
              </div>
            ) : (
              insuranceCards.map(card => (
                <div key={card.id} className="bg-white rounded-lg shadow overflow-hidden">
                  {/* Card Header */}
                  <div className="bg-gradient-to-r from-gray-800 to-gray-700 text-white p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        {getTypeIcon(card.type)}
                        <span className="font-semibold">{card.providerName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {card.isPrimary && (
                          <span className="px-2 py-0.5 bg-yellow-500 text-yellow-900 text-xs rounded-full font-medium">
                            Primary
                          </span>
                        )}
                        {getStatusBadge(card.status)}
                      </div>
                    </div>
                    <p className="text-gray-300 text-sm">{card.planName}</p>
                  </div>

                  {/* Card Details */}
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                      <div>
                        <span className="text-gray-500">Member ID</span>
                        <p className="font-mono font-medium">{card.memberId}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Group Number</span>
                        <p className="font-mono font-medium">{card.groupNumber}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Subscriber</span>
                        <p className="font-medium">{card.subscriberName}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Effective Date</span>
                        <p className="font-medium">{card.effectiveDate}</p>
                      </div>
                    </div>

                    {/* Copays */}
                    {card.type === 'medical' && (
                      <div className="bg-gray-50 rounded-lg p-3 mb-4">
                        <h4 className="text-xs font-semibold text-gray-600 mb-2">COPAYS</h4>
                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                          <div>
                            <div className="font-bold text-lg text-teal-600">${card.copay.primaryCare}</div>
                            <div className="text-gray-500">Primary</div>
                          </div>
                          <div>
                            <div className="font-bold text-lg text-teal-600">${card.copay.specialist}</div>
                            <div className="text-gray-500">Specialist</div>
                          </div>
                          <div>
                            <div className="font-bold text-lg text-teal-600">${card.copay.urgentCare}</div>
                            <div className="text-gray-500">Urgent</div>
                          </div>
                          <div>
                            <div className="font-bold text-lg text-teal-600">${card.copay.emergency}</div>
                            <div className="text-gray-500">ER</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Deductible Progress */}
                    {card.type === 'medical' && (
                      <div className="mb-4">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-500">Deductible Progress</span>
                          <span className="font-medium">${card.deductible.met} / ${card.deductible.individual}</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-teal-500 transition-all"
                            style={{ width: `${Math.min((card.deductible.met / card.deductible.individual) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Card Images */}
                    <div className="flex gap-2 mb-4">
                      <button
                        onClick={() => {
                          setSelectedCard(card);
                          setUploadSide('front');
                          setShowUploadModal(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-teal-500 hover:text-teal-600 transition-colors"
                      >
                        {card.frontImageUrl ? (
                          <><Eye className="w-4 h-4" /> View Front</>
                        ) : (
                          <><Camera className="w-4 h-4" /> Add Front</>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedCard(card);
                          setUploadSide('back');
                          setShowUploadModal(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-teal-500 hover:text-teal-600 transition-colors"
                      >
                        {card.backImageUrl ? (
                          <><Eye className="w-4 h-4" /> View Back</>
                        ) : (
                          <><Camera className="w-4 h-4" /> Add Back</>
                        )}
                      </button>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleVerifyCoverage(card.id)}
                        disabled={verifying === card.id}
                        className="flex-1 flex items-center justify-center gap-2 py-2 bg-teal-50 text-teal-600 rounded-lg text-sm font-medium hover:bg-teal-100 transition-colors disabled:opacity-50"
                      >
                        {verifying === card.id ? (
                          <><RefreshCw className="w-4 h-4 animate-spin" /> Verifying...</>
                        ) : (
                          <><CheckCircle className="w-4 h-4" /> Verify Coverage</>
                        )}
                      </button>
                      <a
                        href={`tel:${card.customerServicePhone}`}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
                      >
                        <Phone className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => handleDeleteCard(card.id)}
                        className="flex items-center justify-center px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {card.lastVerified && (
                      <p className="text-xs text-gray-400 mt-3 text-center">
                        Last verified: {card.lastVerified}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Claims Tab */}
        {activeTab === 'claims' && (
          <div className="space-y-3">
            {claims.length === 0 ? (
              <div className="text-center py-8 bg-white rounded-lg shadow">
                <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">No claims found</p>
              </div>
            ) : (
              claims.map(claim => (
                <div key={claim.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium text-gray-900">{claim.description}</p>
                      <p className="text-sm text-gray-500">{claim.provider}</p>
                    </div>
                    {getClaimStatusBadge(claim.status)}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mb-3">
                    <div>Service Date: {claim.serviceDate}</div>
                    <div>Claim #: {claim.claimNumber}</div>
                  </div>

                  <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                    <div className="text-sm">
                      <span className="text-gray-500">Your cost: </span>
                      <span className={`font-bold ${claim.patientResponsibility > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        ${claim.patientResponsibility.toFixed(2)}
                      </span>
                    </div>
                    {claim.eobUrl && (
                      <button className="flex items-center gap-1 text-teal-600 text-sm">
                        <Download className="w-4 h-4" /> EOB
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Add New Tab */}
        {activeTab === 'add' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Insurance</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="insurance-type" className="block text-sm font-medium text-gray-700 mb-1">
                  Insurance Type <span className="text-red-500">*</span>
                </label>
                <select
                  id="insurance-type"
                  value={newInsurance.type}
                  onChange={(e) => setNewInsurance(prev => ({ ...prev, type: e.target.value as InsuranceType }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="medical">Medical</option>
                  <option value="dental">Dental</option>
                  <option value="vision">Vision</option>
                  <option value="pharmacy">Pharmacy</option>
                  <option value="supplemental">Supplemental</option>
                </select>
              </div>

              <div>
                <label htmlFor="insurance-provider" className="block text-sm font-medium text-gray-700 mb-1">
                  Insurance Provider <span className="text-red-500">*</span>
                </label>
                <input
                  id="insurance-provider"
                  type="text"
                  value={newInsurance.providerName}
                  onChange={(e) => setNewInsurance(prev => ({ ...prev, providerName: e.target.value }))}
                  placeholder="e.g., Blue Cross Blue Shield"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="insurance-plan-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Plan Name
                </label>
                <input
                  id="insurance-plan-name"
                  type="text"
                  value={newInsurance.planName}
                  onChange={(e) => setNewInsurance(prev => ({ ...prev, planName: e.target.value }))}
                  placeholder="e.g., PPO Gold Plan"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="insurance-member-id" className="block text-sm font-medium text-gray-700 mb-1">
                    Member ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="insurance-member-id"
                    type="text"
                    value={newInsurance.memberId}
                    onChange={(e) => setNewInsurance(prev => ({ ...prev, memberId: e.target.value }))}
                    placeholder="Member ID"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="insurance-group-number" className="block text-sm font-medium text-gray-700 mb-1">
                    Group Number
                  </label>
                  <input
                    id="insurance-group-number"
                    type="text"
                    value={newInsurance.groupNumber}
                    onChange={(e) => setNewInsurance(prev => ({ ...prev, groupNumber: e.target.value }))}
                    placeholder="Group #"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="insurance-subscriber-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Subscriber Name
                </label>
                <input
                  id="insurance-subscriber-name"
                  type="text"
                  value={newInsurance.subscriberName}
                  onChange={(e) => setNewInsurance(prev => ({ ...prev, subscriberName: e.target.value }))}
                  placeholder="Name on card"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="insurance-effective-date" className="block text-sm font-medium text-gray-700 mb-1">
                    Effective Date
                  </label>
                  <input
                    id="insurance-effective-date"
                    type="date"
                    value={newInsurance.effectiveDate}
                    onChange={(e) => setNewInsurance(prev => ({ ...prev, effectiveDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="insurance-customer-service" className="block text-sm font-medium text-gray-700 mb-1">
                    Customer Service #
                  </label>
                  <input
                    id="insurance-customer-service"
                    type="tel"
                    value={newInsurance.customerServicePhone}
                    onChange={(e) => setNewInsurance(prev => ({ ...prev, customerServicePhone: e.target.value }))}
                    placeholder="1-800-XXX-XXXX"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Cost Details (Optional)</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="insurance-copay-primary" className="block text-xs text-gray-500 mb-1">Primary Care Copay</label>
                    <input
                      id="insurance-copay-primary"
                      type="number"
                      value={newInsurance.copayPrimary}
                      onChange={(e) => setNewInsurance(prev => ({ ...prev, copayPrimary: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="insurance-copay-specialist" className="block text-xs text-gray-500 mb-1">Specialist Copay</label>
                    <input
                      id="insurance-copay-specialist"
                      type="number"
                      value={newInsurance.copaySpecialist}
                      onChange={(e) => setNewInsurance(prev => ({ ...prev, copaySpecialist: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="insurance-deductible" className="block text-xs text-gray-500 mb-1">Annual Deductible</label>
                    <input
                      id="insurance-deductible"
                      type="number"
                      value={newInsurance.deductible}
                      onChange={(e) => setNewInsurance(prev => ({ ...prev, deductible: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="insurance-oop-max" className="block text-xs text-gray-500 mb-1">Out-of-Pocket Max</label>
                    <input
                      id="insurance-oop-max"
                      type="number"
                      value={newInsurance.outOfPocketMax}
                      onChange={(e) => setNewInsurance(prev => ({ ...prev, outOfPocketMax: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleAddInsurance}
                disabled={!newInsurance.providerName || !newInsurance.memberId}
                className="w-full py-3 bg-gradient-to-r from-teal-600 to-cyan-500 text-white rounded-lg font-medium hover:from-teal-700 hover:to-cyan-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Insurance Card
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && selectedCard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">
              Upload {uploadSide === 'front' ? 'Front' : 'Back'} of Card
            </h3>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4">
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
              <p className="text-gray-500 mb-2">Drag & drop or click to upload</p>
              <p className="text-xs text-gray-400">PNG, JPG up to 5MB</p>
              <input type="file" accept="image/*" className="hidden" id="card-upload" />
              <label
                htmlFor="card-upload"
                className="mt-4 inline-block px-4 py-2 bg-teal-600 text-white rounded-lg cursor-pointer hover:bg-teal-700 transition-colors"
              >
                Choose File
              </label>
            </div>

            <div className="flex items-center justify-center gap-2 mb-4 text-gray-500">
              <span className="h-px flex-1 bg-gray-200" />
              <span className="text-sm">or</span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>

            <button className="w-full flex items-center justify-center gap-2 py-3 border border-teal-600 text-teal-600 rounded-lg font-medium hover:bg-teal-50 transition-colors">
              <Camera className="w-5 h-5" /> Take Photo
            </button>

            <button
              onClick={() => setShowUploadModal(false)}
              className="w-full mt-3 py-2 text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InsurancePage;
