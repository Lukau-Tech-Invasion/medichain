import React, { useState, useEffect } from 'react';
import {
  User,
  Calendar,
  Printer,
  CheckCircle,
  AlertCircle,
  PenTool,
  Search,
  Eye,
  Edit,
  FileSignature,
  Heart
} from 'lucide-react';

/**
 * DeathCertificatePage
 * 
 * Page for creating and signing death certificates.
 * Ensures legal compliance with state regulations.
 */

type CertificateStatus = 'draft' | 'pending-review' | 'pending-signature' | 'filed' | 'amended';
type MannerOfDeath = 'natural' | 'accident' | 'suicide' | 'homicide' | 'pending' | 'undetermined';

interface DeathCertificate {
  id: string;
  deceasedName: string;
  dateOfBirth: string;
  dateOfDeath: string;
  timeOfDeath: string;
  placeOfDeath: string;
  countyOfDeath: string;
  mannerOfDeath: MannerOfDeath;
  causeOfDeath: string;
  otherConditions: string[];
  certifyingPhysician: string;
  certifyingPhysicianLicense: string;
  status: CertificateStatus;
  createdAt: Date;
  filedAt?: Date;
  caseNumber?: string;
}

interface CauseOfDeathEntry {
  cause: string;
  duration: string;
}

const DeathCertificatePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'certificates' | 'new'>('certificates');
  const [certificates, setCertificates] = useState<DeathCertificate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CertificateStatus | 'all'>('all');
  const [currentStep, setCurrentStep] = useState(1);
  const [_selectedCertificate, _setSelectedCertificate] = useState<DeathCertificate | null>(null);

  // Form state
  const [deceasedInfo, setDeceasedInfo] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    ssn: '',
    dateOfBirth: '',
    sex: 'male' as 'male' | 'female',
    race: '',
    maritalStatus: '',
    occupation: '',
    birthplace: '',
    residence: ''
  });

  const [deathInfo, setDeathInfo] = useState({
    dateOfDeath: '',
    timeOfDeath: '',
    placeOfDeath: '',
    facilityName: '',
    countyOfDeath: '',
    cityOfDeath: '',
    stateOfDeath: '',
    pronouncedBy: '',
    pronouncedDate: '',
    pronouncedTime: ''
  });

  const [causeInfo, setCauseInfo] = useState({
    immediateCause: '',
    immediateDuration: '',
    underlyingCauses: [{ cause: '', duration: '' }] as CauseOfDeathEntry[],
    mannerOfDeath: 'natural' as MannerOfDeath,
    autopsy: false,
    autopsyUsed: false,
    tobaccoContributed: 'unknown' as 'yes' | 'no' | 'probably' | 'unknown',
    pregnancyStatus: 'not-pregnant' as string,
    injuryDate: '',
    injuryTime: '',
    injuryPlace: '',
    injuryDescription: ''
  });

  useEffect(() => {
    // Sample certificates
    setCertificates([
      {
        id: 'DC-2024-00123',
        deceasedName: 'Robert James Wilson',
        dateOfBirth: '1942-05-15',
        dateOfDeath: '2024-01-14',
        timeOfDeath: '14:32',
        placeOfDeath: 'Memorial General Hospital',
        countyOfDeath: 'Riyadh',
        mannerOfDeath: 'natural',
        causeOfDeath: 'Acute myocardial infarction',
        otherConditions: ['Coronary artery disease', 'Hypertension', 'Type 2 diabetes'],
        certifyingPhysician: 'Dr. Sarah Ahmed',
        certifyingPhysicianLicense: 'MD-456789',
        status: 'filed',
        createdAt: new Date('2024-01-14'),
        filedAt: new Date('2024-01-15'),
        caseNumber: 'RC-2024-00045'
      },
      {
        id: 'DC-2024-00122',
        deceasedName: 'Margaret Anne Thompson',
        dateOfBirth: '1938-11-22',
        dateOfDeath: '2024-01-13',
        timeOfDeath: '08:15',
        placeOfDeath: 'Sunrise Care Facility',
        countyOfDeath: 'Jeddah',
        mannerOfDeath: 'natural',
        causeOfDeath: 'Respiratory failure',
        otherConditions: ['COPD', 'Pneumonia'],
        certifyingPhysician: 'Dr. Mohammed Al-Faisal',
        certifyingPhysicianLicense: 'MD-234567',
        status: 'pending-signature',
        createdAt: new Date('2024-01-13')
      },
      {
        id: 'DC-2024-00121',
        deceasedName: 'Charles Edward Brown',
        dateOfBirth: '1955-03-08',
        dateOfDeath: '2024-01-12',
        timeOfDeath: '22:45',
        placeOfDeath: 'King Fahd Medical City',
        countyOfDeath: 'Riyadh',
        mannerOfDeath: 'pending',
        causeOfDeath: 'Under investigation',
        otherConditions: [],
        certifyingPhysician: 'Dr. Ahmed Hassan',
        certifyingPhysicianLicense: 'MD-345678',
        status: 'pending-review',
        createdAt: new Date('2024-01-12')
      }
    ]);
  }, []);

  const getStatusBadge = (status: CertificateStatus) => {
    const styles: Record<CertificateStatus, string> = {
      'draft': 'bg-gray-100 text-gray-700',
      'pending-review': 'bg-yellow-100 text-yellow-700',
      'pending-signature': 'bg-orange-100 text-orange-700',
      'filed': 'bg-green-100 text-green-700',
      'amended': 'bg-blue-100 text-blue-700'
    };
    const labels: Record<CertificateStatus, string> = {
      'draft': 'Draft',
      'pending-review': 'Pending Review',
      'pending-signature': 'Awaiting Signature',
      'filed': 'Filed',
      'amended': 'Amended'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const getMannerLabel = (manner: MannerOfDeath) => {
    const labels: Record<MannerOfDeath, string> = {
      'natural': 'Natural',
      'accident': 'Accident',
      'suicide': 'Suicide',
      'homicide': 'Homicide',
      'pending': 'Pending Investigation',
      'undetermined': 'Could Not Be Determined'
    };
    return labels[manner];
  };

  const filteredCertificates = certificates.filter(cert => {
    const matchesSearch = cert.deceasedName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          cert.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || cert.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const addUnderlyingCause = () => {
    if (causeInfo.underlyingCauses.length < 4) {
      setCauseInfo({
        ...causeInfo,
        underlyingCauses: [...causeInfo.underlyingCauses, { cause: '', duration: '' }]
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-zinc-700 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <FileSignature className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Death Certificate</h1>
        </div>
        <p className="text-slate-300">Create and manage official death certificates</p>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {(['certificates', 'new'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-slate-800 border-b-2 border-slate-800'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'certificates' ? 'Certificates' : 'New Certificate'}
            </button>
          ))}
        </div>
      </div>

      {/* Certificates List */}
      {activeTab === 'certificates' && (
        <div className="p-6">
          {/* Search & Filter */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or certificate ID..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CertificateStatus | 'all')}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-slate-500"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="pending-review">Pending Review</option>
              <option value="pending-signature">Awaiting Signature</option>
              <option value="filed">Filed</option>
              <option value="amended">Amended</option>
            </select>
          </div>

          {/* Certificates */}
          <div className="space-y-4">
            {filteredCertificates.map(cert => (
              <div key={cert.id} className="bg-white rounded-lg shadow border p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900">{cert.deceasedName}</h3>
                      {getStatusBadge(cert.status)}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">Certificate ID: {cert.id}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="p-2 hover:bg-gray-100 rounded-lg" title="View">
                      <Eye className="w-5 h-5 text-gray-600" />
                    </button>
                    {cert.status !== 'filed' && (
                      <button className="p-2 hover:bg-gray-100 rounded-lg" title="Edit">
                        <Edit className="w-5 h-5 text-gray-600" />
                      </button>
                    )}
                    <button className="p-2 hover:bg-gray-100 rounded-lg" title="Print">
                      <Printer className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Date of Birth</p>
                    <p className="font-medium">{new Date(cert.dateOfBirth).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Date of Death</p>
                    <p className="font-medium">{new Date(cert.dateOfDeath).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Time of Death</p>
                    <p className="font-medium">{cert.timeOfDeath}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Manner of Death</p>
                    <p className="font-medium">{getMannerLabel(cert.mannerOfDeath)}</p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Cause of Death</p>
                      <p className="font-medium">{cert.causeOfDeath}</p>
                      {cert.otherConditions.length > 0 && (
                        <p className="text-gray-400 text-xs mt-1">
                          Contributing: {cert.otherConditions.join(', ')}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-gray-500">Place of Death</p>
                      <p className="font-medium">{cert.placeOfDeath}</p>
                      <p className="text-gray-400 text-xs">{cert.countyOfDeath}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm">
                  <div>
                    <p className="text-gray-500">Certifying Physician</p>
                    <p className="font-medium">{cert.certifyingPhysician}</p>
                    <p className="text-gray-400 text-xs">License: {cert.certifyingPhysicianLicense}</p>
                  </div>
                  {cert.status === 'filed' && cert.caseNumber && (
                    <div className="text-right">
                      <p className="text-gray-500">Filed Case Number</p>
                      <p className="font-medium text-green-600">{cert.caseNumber}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Certificate Form */}
      {activeTab === 'new' && (
        <div className="p-6">
          {/* Progress Steps */}
          <div className="flex items-center justify-between mb-8 max-w-3xl mx-auto">
            {[
              { num: 1, label: 'Decedent' },
              { num: 2, label: 'Death Info' },
              { num: 3, label: 'Cause' },
              { num: 4, label: 'Certifier' }
            ].map((step, idx) => (
              <React.Fragment key={step.num}>
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                    currentStep >= step.num
                      ? 'bg-slate-800 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}>
                    {currentStep > step.num ? <CheckCircle className="w-5 h-5" /> : step.num}
                  </div>
                  <span className="text-xs mt-1 text-gray-600">{step.label}</span>
                </div>
                {idx < 3 && (
                  <div className={`flex-1 h-1 mx-2 rounded ${
                    currentStep > step.num ? 'bg-slate-800' : 'bg-gray-200'
                  }`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Step 1: Decedent Information */}
          {currentStep === 1 && (
            <div className="max-w-3xl mx-auto bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <User className="w-5 h-5 text-slate-700" />
                Decedent Information
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="death-first-name" className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input
                    id="death-first-name"
                    type="text"
                    value={deceasedInfo.firstName}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, firstName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="death-middle-name" className="block text-sm font-medium text-gray-700 mb-1">Middle Name</label>
                  <input
                    id="death-middle-name"
                    type="text"
                    value={deceasedInfo.middleName}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, middleName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="death-last-name" className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input
                    id="death-last-name"
                    type="text"
                    value={deceasedInfo.lastName}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, lastName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div>
                  <label htmlFor="death-ssn" className="block text-sm font-medium text-gray-700 mb-1">SSN / National ID</label>
                  <input
                    id="death-ssn"
                    type="text"
                    value={deceasedInfo.ssn}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, ssn: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="XXX-XX-XXXX"
                  />
                </div>
                <div>
                  <label htmlFor="death-date-of-birth" className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
                  <input
                    id="death-date-of-birth"
                    type="date"
                    value={deceasedInfo.dateOfBirth}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, dateOfBirth: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="death-sex" className="block text-sm font-medium text-gray-700 mb-1">Sex *</label>
                  <select
                    id="death-sex"
                    value={deceasedInfo.sex}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, sex: e.target.value as 'male' | 'female' })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label htmlFor="death-marital-status" className="block text-sm font-medium text-gray-700 mb-1">Marital Status</label>
                  <select
                    id="death-marital-status"
                    value={deceasedInfo.maritalStatus}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, maritalStatus: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">Select...</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="widowed">Widowed</option>
                    <option value="divorced">Divorced</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="death-occupation" className="block text-sm font-medium text-gray-700 mb-1">Occupation</label>
                  <input
                    id="death-occupation"
                    type="text"
                    value={deceasedInfo.occupation}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, occupation: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label htmlFor="death-birthplace" className="block text-sm font-medium text-gray-700 mb-1">Birthplace</label>
                  <input
                    id="death-birthplace"
                    type="text"
                    value={deceasedInfo.birthplace}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, birthplace: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="City, Country"
                  />
                </div>
                <div>
                  <label htmlFor="death-residence" className="block text-sm font-medium text-gray-700 mb-1">Residence Address</label>
                  <input
                    id="death-residence"
                    type="text"
                    value={deceasedInfo.residence}
                    onChange={(e) => setDeceasedInfo({ ...deceasedInfo, residence: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setCurrentStep(2)}
                  className="px-6 py-2 bg-slate-800 text-white rounded-lg font-medium"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Death Information */}
          {currentStep === 2 && (
            <div className="max-w-3xl mx-auto bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-slate-700" />
                Death Information
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="death-date-of-death" className="block text-sm font-medium text-gray-700 mb-1">Date of Death *</label>
                  <input
                    id="death-date-of-death"
                    type="date"
                    value={deathInfo.dateOfDeath}
                    onChange={(e) => setDeathInfo({ ...deathInfo, dateOfDeath: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="death-time-of-death" className="block text-sm font-medium text-gray-700 mb-1">Time of Death *</label>
                  <input
                    id="death-time-of-death"
                    type="time"
                    value={deathInfo.timeOfDeath}
                    onChange={(e) => setDeathInfo({ ...deathInfo, timeOfDeath: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label htmlFor="death-place-of-death" className="block text-sm font-medium text-gray-700 mb-1">Place of Death *</label>
                  <select
                    id="death-place-of-death"
                    value={deathInfo.placeOfDeath}
                    onChange={(e) => setDeathInfo({ ...deathInfo, placeOfDeath: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">Select...</option>
                    <option value="hospital-inpatient">Hospital - Inpatient</option>
                    <option value="hospital-er">Hospital - Emergency Room</option>
                    <option value="hospital-doa">Hospital - DOA</option>
                    <option value="nursing-home">Nursing Home</option>
                    <option value="residence">Decedent's Residence</option>
                    <option value="hospice">Hospice Facility</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="death-facility-name" className="block text-sm font-medium text-gray-700 mb-1">Facility Name</label>
                  <input
                    id="death-facility-name"
                    type="text"
                    value={deathInfo.facilityName}
                    onChange={(e) => setDeathInfo({ ...deathInfo, facilityName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div>
                  <label htmlFor="death-city" className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input
                    id="death-city"
                    type="text"
                    value={deathInfo.cityOfDeath}
                    onChange={(e) => setDeathInfo({ ...deathInfo, cityOfDeath: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="death-county" className="block text-sm font-medium text-gray-700 mb-1">County/Province</label>
                  <input
                    id="death-county"
                    type="text"
                    value={deathInfo.countyOfDeath}
                    onChange={(e) => setDeathInfo({ ...deathInfo, countyOfDeath: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="death-state" className="block text-sm font-medium text-gray-700 mb-1">State/Country</label>
                  <input
                    id="death-state"
                    type="text"
                    value={deathInfo.stateOfDeath}
                    onChange={(e) => setDeathInfo({ ...deathInfo, stateOfDeath: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="border-t mt-6 pt-6">
                <h3 className="font-medium text-gray-900 mb-4">Pronouncement</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="death-pronounced-by" className="block text-sm font-medium text-gray-700 mb-1">Pronounced By</label>
                    <input
                      id="death-pronounced-by"
                      type="text"
                      value={deathInfo.pronouncedBy}
                      onChange={(e) => setDeathInfo({ ...deathInfo, pronouncedBy: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="death-pronounced-date" className="block text-sm font-medium text-gray-700 mb-1">Date Pronounced</label>
                    <input
                      id="death-pronounced-date"
                      type="date"
                      value={deathInfo.pronouncedDate}
                      onChange={(e) => setDeathInfo({ ...deathInfo, pronouncedDate: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="death-pronounced-time" className="block text-sm font-medium text-gray-700 mb-1">Time Pronounced</label>
                    <input
                      id="death-pronounced-time"
                      type="time"
                      value={deathInfo.pronouncedTime}
                      onChange={(e) => setDeathInfo({ ...deathInfo, pronouncedTime: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="px-6 py-2 border border-gray-300 rounded-lg font-medium"
                >
                  Back
                </button>
                <button
                  onClick={() => setCurrentStep(3)}
                  className="px-6 py-2 bg-slate-800 text-white rounded-lg font-medium"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Cause of Death */}
          {currentStep === 3 && (
            <div className="max-w-3xl mx-auto bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <Heart className="w-5 h-5 text-slate-700" />
                Cause of Death
              </h2>

              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Part I:</strong> Enter the chain of events leading to death, starting with the immediate cause.
                </p>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-3">
                      <label htmlFor="death-immediate-cause" className="block text-sm font-medium text-gray-700 mb-1">
                        a. Immediate Cause *
                      </label>
                      <input
                        id="death-immediate-cause"
                        type="text"
                        value={causeInfo.immediateCause}
                        onChange={(e) => setCauseInfo({ ...causeInfo, immediateCause: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2"
                        placeholder="Final disease or condition resulting in death"
                      />
                    </div>
                    <div>
                      <label htmlFor="death-immediate-duration" className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
                      <input
                        id="death-immediate-duration"
                        type="text"
                        value={causeInfo.immediateDuration}
                        onChange={(e) => setCauseInfo({ ...causeInfo, immediateDuration: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2"
                        placeholder="e.g., 2 hours"
                      />
                    </div>
                  </div>

                  {causeInfo.underlyingCauses.map((cause, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="md:col-span-3">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {String.fromCharCode(98 + idx)}. Due to (or as a consequence of)
                        </label>
                        <input
                          type="text"
                          value={cause.cause}
                          onChange={(e) => {
                            const updated = [...causeInfo.underlyingCauses];
                            updated[idx].cause = e.target.value;
                            setCauseInfo({ ...causeInfo, underlyingCauses: updated });
                          }}
                          className="w-full border rounded-lg px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
                        <input
                          type="text"
                          value={cause.duration}
                          onChange={(e) => {
                            const updated = [...causeInfo.underlyingCauses];
                            updated[idx].duration = e.target.value;
                            setCauseInfo({ ...causeInfo, underlyingCauses: updated });
                          }}
                          className="w-full border rounded-lg px-3 py-2"
                        />
                      </div>
                    </div>
                  ))}

                  {causeInfo.underlyingCauses.length < 4 && (
                    <button
                      onClick={addUnderlyingCause}
                      className="text-sm text-slate-600 hover:text-slate-800"
                    >
                      + Add underlying cause
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label htmlFor="death-manner-of-death" className="block text-sm font-medium text-gray-700 mb-1">Manner of Death *</label>
                  <select
                    id="death-manner-of-death"
                    value={causeInfo.mannerOfDeath}
                    onChange={(e) => setCauseInfo({ ...causeInfo, mannerOfDeath: e.target.value as MannerOfDeath })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="natural">Natural</option>
                    <option value="accident">Accident</option>
                    <option value="suicide">Suicide</option>
                    <option value="homicide">Homicide</option>
                    <option value="pending">Pending Investigation</option>
                    <option value="undetermined">Could Not Be Determined</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="death-tobacco-contributed" className="block text-sm font-medium text-gray-700 mb-1">Did Tobacco Use Contribute?</label>
                  <select
                    id="death-tobacco-contributed"
                    value={causeInfo.tobaccoContributed}
                    onChange={(e) => setCauseInfo({ ...causeInfo, tobaccoContributed: e.target.value as any })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="probably">Probably</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="autopsy"
                    checked={causeInfo.autopsy}
                    onChange={(e) => setCauseInfo({ ...causeInfo, autopsy: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="autopsy" className="text-sm font-medium text-gray-700">
                    Autopsy Performed
                  </label>
                </div>
                {causeInfo.autopsy && (
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="autopsyUsed"
                      checked={causeInfo.autopsyUsed}
                      onChange={(e) => setCauseInfo({ ...causeInfo, autopsyUsed: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <label htmlFor="autopsyUsed" className="text-sm font-medium text-gray-700">
                      Autopsy findings used in determining cause
                    </label>
                  </div>
                )}
              </div>

              <div className="flex justify-between mt-6">
                <button
                  onClick={() => setCurrentStep(2)}
                  className="px-6 py-2 border border-gray-300 rounded-lg font-medium"
                >
                  Back
                </button>
                <button
                  onClick={() => setCurrentStep(4)}
                  className="px-6 py-2 bg-slate-800 text-white rounded-lg font-medium"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Certifier */}
          {currentStep === 4 && (
            <div className="max-w-3xl mx-auto bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <PenTool className="w-5 h-5 text-slate-700" />
                Certifier Information & Signature
              </h2>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-yellow-800 font-medium">Legal Declaration</p>
                    <p className="text-sm text-yellow-700 mt-1">
                      By signing this certificate, I certify under penalty of law that the information provided is true and correct to the best of my knowledge.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label htmlFor="death-certifier-type" className="block text-sm font-medium text-gray-700 mb-1">Certifier Type *</label>
                  <select id="death-certifier-type" className="w-full border rounded-lg px-3 py-2">
                    <option value="attending">Attending Physician</option>
                    <option value="pronouncing">Pronouncing Physician</option>
                    <option value="medical-examiner">Medical Examiner/Coroner</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="death-license-number" className="block text-sm font-medium text-gray-700 mb-1">License Number *</label>
                  <input
                    id="death-license-number"
                    type="text"
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="MD-XXXXXX"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label htmlFor="death-certifier-name" className="block text-sm font-medium text-gray-700 mb-1">Certifier Name *</label>
                  <input id="death-certifier-name" type="text" className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label htmlFor="death-date-signed" className="block text-sm font-medium text-gray-700 mb-1">Date Signed *</label>
                  <input id="death-date-signed" type="date" className="w-full border rounded-lg px-3 py-2" />
                </div>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-6">
                <PenTool className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-500">Click to add digital signature</p>
                <p className="text-xs text-gray-400 mt-1">Or draw signature using mouse/touch</p>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setCurrentStep(3)}
                  className="px-6 py-2 border border-gray-300 rounded-lg font-medium"
                >
                  Back
                </button>
                <div className="flex gap-3">
                  <button className="px-6 py-2 border border-gray-300 rounded-lg font-medium">
                    Save as Draft
                  </button>
                  <button className="px-6 py-2 bg-slate-800 text-white rounded-lg font-medium flex items-center gap-2">
                    <FileSignature className="w-4 h-4" />
                    Sign & Submit
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DeathCertificatePage;
