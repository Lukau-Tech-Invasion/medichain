import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { getPatients, listPathology, createPathology } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { FileText, Microscope, Search, Plus, Eye, Calendar, AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react';

/**
 * PathologyPage
 * 
 * Full pathology specimen tracking and digital pathology viewer
 * - Surgical pathology, cytology, autopsy specimens
 * - Gross and microscopic examination
 * - IHC/special stains tracking
 * - Final diagnosis with SNOMED coding
 * - Digital slide viewer integration ready
 */

interface PathologySpecimen {
  specimenId: string;
  patientId: string;
  patientName: string;
  collectionDate: string;
  collectionTime: string;
  clinician: string;
  specimenType: 'surgical' | 'cytology' | 'biopsy' | 'bone-marrow' | 'autopsy';
  site: string;
  laterality: 'left' | 'right' | 'bilateral' | 'n/a';
  clinicalHistory: string;
  clinicalDiagnosis: string;
  priority: 'routine' | 'urgent' | 'stat';
  status: 'received' | 'grossing' | 'processing' | 'embedding' | 'cutting' | 'staining' | 'prelim' | 'final' | 'addendum';
  receivedDate?: string;
  receivedBy?: string;
  container: string;
  fixative: string;
  grossDescription?: string;
  blocks?: string[];
  slides?: string[];
  specialStains?: string[];
  ihcMarkers?: string[];
  microscopicDescription?: string;
  diagnosis?: string;
  snomedCode?: string;
  reportDate?: string;
  pathologist?: string;
  isCritical?: boolean;
  communicatedTo?: string;
}

const PathologyPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [specimens, setSpecimens] = useState<PathologySpecimen[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'worklist' | 'newOrder' | 'report'>('worklist');
  const [selectedSpecimen, setSelectedSpecimen] = useState<PathologySpecimen | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // New order form state
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [collectionTime, setCollectionTime] = useState('');
  const [clinician, setClinician] = useState('');
  const [specimenType, setSpecimenType] = useState<'surgical' | 'cytology' | 'biopsy' | 'bone-marrow' | 'autopsy'>('surgical');
  const [site, setSite] = useState('');
  const [laterality, setLaterality] = useState<'left' | 'right' | 'bilateral' | 'n/a'>('n/a');
  const [clinicalHistory, setClinicalHistory] = useState('');
  const [clinicalDiagnosis, setClinicalDiagnosis] = useState('');
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [container, setContainer] = useState('');
  const [fixative, setFixative] = useState('10% formalin');

  // Report form state
  const [grossDescription, setGrossDescription] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [newBlock, setNewBlock] = useState('');
  const [slides, setSlides] = useState<string[]>([]);
  const [newSlide, setNewSlide] = useState('');
  const [specialStains, setSpecialStains] = useState<string[]>([]);
  const [ihcMarkers, setIhcMarkers] = useState<string[]>([]);
  const [microscopicDescription, setMicroscopicDescription] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [snomedCode, setSnomedCode] = useState('');
  const [isCritical, setIsCritical] = useState(false);
  const [communicatedTo, setCommunicatedTo] = useState('');

  const fetchSpecimens = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await listPathology();
      if (response.success && Array.isArray(response.items)) {
        setSpecimens(response.items as PathologySpecimen[]);
      }
    } catch (err) {
      console.error('Error fetching pathology specimens:', err);
      setError('Failed to load pathology specimens');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadPatients = async () => {
      const loadedPatients = await getPatients();
      setPatients(loadedPatients);
    };
    loadPatients();
    fetchSpecimens();
  }, [user, fetchSpecimens]);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !collectionDate || !site || !clinician) {
      showWarning('Please fill in all required fields');
      return;
    }

    const patient = patients.find(p => p.patient_id === selectedPatientId);
    if (!patient) return;

    const newSpecimen: PathologySpecimen = {
      specimenId: `S24-${String(specimens.length + 1).padStart(3, '0')}`,
      patientId: selectedPatientId,
      patientName: patient.full_name,
      collectionDate,
      collectionTime: collectionTime || '00:00',
      clinician,
      specimenType,
      site,
      laterality,
      clinicalHistory,
      clinicalDiagnosis,
      priority,
      status: 'received',
      receivedDate: new Date().toISOString().split('T')[0],
      receivedBy: user?.userId || 'Unknown',
      container,
      fixative
    };

    try {
      await createPathology(newSpecimen);
    } catch (err) {
      console.error('Failed to save pathology specimen:', err);
    }

    setSpecimens([...specimens, newSpecimen]);
    showSuccess(`Pathology specimen ${newSpecimen.specimenId} submitted successfully`);

    // Reset form
    setSelectedPatientId('');
    setCollectionDate('');
    setCollectionTime('');
    setClinician('');
    setSite('');
    setLaterality('n/a');
    setClinicalHistory('');
    setClinicalDiagnosis('');
    setPriority('routine');
    setContainer('');
    setFixative('10% formalin');
    setActiveTab('worklist');
  };

  const handleOpenReport = (specimen: PathologySpecimen) => {
    setSelectedSpecimen(specimen);
    setGrossDescription(specimen.grossDescription || '');
    setBlocks(specimen.blocks || []);
    setSlides(specimen.slides || []);
    setSpecialStains(specimen.specialStains || []);
    setIhcMarkers(specimen.ihcMarkers || []);
    setMicroscopicDescription(specimen.microscopicDescription || '');
    setDiagnosis(specimen.diagnosis || '');
    setSnomedCode(specimen.snomedCode || '');
    setIsCritical(specimen.isCritical || false);
    setCommunicatedTo(specimen.communicatedTo || '');
    setActiveTab('report');
  };

  const handleSaveReport = (finalizeReport: boolean) => {
    if (!selectedSpecimen) return;

    if (finalizeReport) {
      if (!diagnosis || !microscopicDescription) {
        showWarning('Diagnosis and microscopic description are required to finalize report');
        return;
      }
      if (isCritical && !communicatedTo) {
        showWarning('Critical findings must be communicated before finalizing');
        return;
      }
    }

    const updatedSpecimen: PathologySpecimen = {
      ...selectedSpecimen,
      grossDescription,
      blocks,
      slides,
      specialStains,
      ihcMarkers,
      microscopicDescription,
      diagnosis,
      snomedCode,
      isCritical,
      communicatedTo,
      status: finalizeReport ? 'final' : 'prelim',
      reportDate: finalizeReport ? new Date().toISOString().split('T')[0] : undefined,
      pathologist: finalizeReport ? (user?.userId || 'Unknown') : undefined
    };

    setSpecimens(specimens.map(s => s.specimenId === selectedSpecimen.specimenId ? updatedSpecimen : s));
    showSuccess(`Report ${finalizeReport ? 'finalized' : 'saved as preliminary'} successfully`);
    setActiveTab('worklist');
    setSelectedSpecimen(null);
  };

  const addBlock = () => {
    if (newBlock.trim()) {
      setBlocks([...blocks, newBlock.trim()]);
      setNewBlock('');
    }
  };

  const addSlide = () => {
    if (newSlide.trim()) {
      setSlides([...slides, newSlide.trim()]);
      setNewSlide('');
    }
  };

  const toggleSpecialStain = (stain: string) => {
    if (specialStains.includes(stain)) {
      setSpecialStains(specialStains.filter(s => s !== stain));
    } else {
      setSpecialStains([...specialStains, stain]);
    }
  };

  const toggleIHCMarker = (marker: string) => {
    if (ihcMarkers.includes(marker)) {
      setIhcMarkers(ihcMarkers.filter(m => m !== marker));
    } else {
      setIhcMarkers([...ihcMarkers, marker]);
    }
  };

  const filteredSpecimens = specimens.filter(specimen => {
    const matchesSearch = 
      specimen.specimenId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      specimen.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      specimen.site.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || specimen.status === statusFilter;
    const matchesType = typeFilter === 'all' || specimen.specimenType === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      received: 'bg-blue-100 text-blue-800',
      grossing: 'bg-purple-100 text-purple-800',
      processing: 'bg-yellow-100 text-yellow-800',
      embedding: 'bg-orange-100 text-orange-800',
      cutting: 'bg-pink-100 text-pink-800',
      staining: 'bg-indigo-100 text-indigo-800',
      prelim: 'bg-amber-100 text-amber-800',
      final: 'bg-green-100 text-green-800',
      addendum: 'bg-gray-100 text-gray-800'
    };
    return styles[status] || 'bg-gray-100 text-gray-800';
  };

  const getPriorityBadge = (priority: string) => {
    const styles: Record<string, string> = {
      stat: 'bg-red-600 text-white',
      urgent: 'bg-orange-500 text-white',
      routine: 'bg-gray-500 text-white'
    };
    return styles[priority] || 'bg-gray-500 text-white';
  };

  return (
    <div className="p-6">
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-amber-600 to-orange-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Microscope className="h-8 w-8" />
            <div>
              <h1 className="text-3xl font-bold">Pathology Laboratory</h1>
              <p className="text-amber-100">Surgical Pathology & Cytology</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-amber-100">Pathologist</p>
            <p className="font-semibold">{user?.userId || 'Unknown'}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('worklist')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'worklist'
              ? 'text-amber-600 border-b-2 border-amber-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="inline h-4 w-4 mr-2" />
          Worklist
        </button>
        <button
          onClick={() => setActiveTab('newOrder')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'newOrder'
              ? 'text-amber-600 border-b-2 border-amber-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Plus className="inline h-4 w-4 mr-2" />
          New Specimen
        </button>
        {selectedSpecimen && (
          <button
            onClick={() => setActiveTab('report')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'report'
                ? 'text-amber-600 border-b-2 border-amber-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Microscope className="inline h-4 w-4 mr-2" />
            Report: {selectedSpecimen.specimenId}
          </button>
        )}
      </div>

      {/* Worklist Tab */}
      {activeTab === 'worklist' && (
        <div>
          {/* Search and Filters */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="path-search" className="block text-sm font-medium text-gray-700 mb-1">
                  <Search className="inline h-4 w-4 mr-1" />
                  Search
                </label>
                <input
                  id="path-search"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Specimen ID, patient, site..."
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label htmlFor="path-status-filter" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  id="path-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="all">All Statuses</option>
                  <option value="received">Received</option>
                  <option value="grossing">Grossing</option>
                  <option value="processing">Processing</option>
                  <option value="prelim">Preliminary</option>
                  <option value="final">Final</option>
                </select>
              </div>
              <div>
                <label htmlFor="path-type-filter" className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  id="path-type-filter"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="all">All Types</option>
                  <option value="surgical">Surgical</option>
                  <option value="biopsy">Biopsy</option>
                  <option value="cytology">Cytology</option>
                  <option value="bone-marrow">Bone Marrow</option>
                  <option value="autopsy">Autopsy</option>
                </select>
              </div>
            </div>
          </div>

          {/* Specimens Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Specimen ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type/Site</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Collected</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredSpecimens.map((specimen) => (
                    <tr
                      key={specimen.specimenId}
                      className={`${specimen.priority === 'stat' ? 'bg-red-50' : ''} hover:bg-gray-50`}
                    >
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getPriorityBadge(specimen.priority)}`}>
                          {specimen.priority.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{specimen.specimenId}</div>
                        {specimen.isCritical && (
                          <span className="text-xs text-red-600 flex items-center">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Critical
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{specimen.patientName}</div>
                        <div className="text-xs text-gray-500">{specimen.patientId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          <span className="font-medium text-gray-700">{specimen.specimenType}</span>
                        </div>
                        <div className="text-sm text-gray-600">{specimen.site}</div>
                        {specimen.laterality !== 'n/a' && (
                          <span className="text-xs text-gray-500">({specimen.laterality})</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center text-sm text-gray-600">
                          <Calendar className="h-4 w-4 mr-1" />
                          {specimen.collectionDate}
                        </div>
                        <div className="text-xs text-gray-500">{specimen.collectionTime}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(specimen.status)}`}>
                          {specimen.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleOpenReport(specimen)}
                          className="text-amber-600 hover:text-amber-800 text-sm font-medium flex items-center"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View/Report
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* New Specimen Tab */}
      {activeTab === 'newOrder' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">New Specimen Submission</h2>
          <form onSubmit={handleSubmitOrder}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Patient Selection */}
              <div>
                <label htmlFor="path-patient" className="block text-sm font-medium text-gray-700 mb-1">
                  Patient <span className="text-red-500">*</span>
                </label>
                <select
                  id="path-patient"
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="">Select patient...</option>
                  {patients.map((patient) => (
                    <option key={patient.patient_id} value={patient.patient_id}>
                      {patient.full_name} ({patient.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Specimen Type */}
              <div>
                <label htmlFor="path-specimen-type" className="block text-sm font-medium text-gray-700 mb-1">
                  Specimen Type <span className="text-red-500">*</span>
                </label>
                <select
                  id="path-specimen-type"
                  value={specimenType}
                  onChange={(e) => setSpecimenType(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="surgical">Surgical</option>
                  <option value="biopsy">Biopsy</option>
                  <option value="cytology">Cytology</option>
                  <option value="bone-marrow">Bone Marrow</option>
                  <option value="autopsy">Autopsy</option>
                </select>
              </div>

              {/* Collection Date/Time */}
              <div>
                <label htmlFor="path-collection-date" className="block text-sm font-medium text-gray-700 mb-1">
                  Collection Date <span className="text-red-500">*</span>
                </label>
                <input
                  id="path-collection-date"
                  type="date"
                  value={collectionDate}
                  onChange={(e) => setCollectionDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              <div>
                <label htmlFor="path-collection-time" className="block text-sm font-medium text-gray-700 mb-1">Collection Time</label>
                <input
                  id="path-collection-time"
                  type="time"
                  value={collectionTime}
                  onChange={(e) => setCollectionTime(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              {/* Anatomical Site */}
              <div>
                <label htmlFor="path-site" className="block text-sm font-medium text-gray-700 mb-1">
                  Anatomical Site <span className="text-red-500">*</span>
                </label>
                <input
                  id="path-site"
                  type="text"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  placeholder="e.g., Colon, Breast, Lung..."
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Laterality */}
              <div>
                <label htmlFor="path-laterality" className="block text-sm font-medium text-gray-700 mb-1">Laterality</label>
                <select
                  id="path-laterality"
                  value={laterality}
                  onChange={(e) => setLaterality(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="n/a">Not Applicable</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="bilateral">Bilateral</option>
                </select>
              </div>

              {/* Clinician */}
              <div>
                <label htmlFor="path-clinician" className="block text-sm font-medium text-gray-700 mb-1">
                  Ordering Clinician <span className="text-red-500">*</span>
                </label>
                <input
                  id="path-clinician"
                  type="text"
                  value={clinician}
                  onChange={(e) => setClinician(e.target.value)}
                  placeholder="Dr. Name"
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Priority */}
              <div>
                <label htmlFor="path-priority" className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  id="path-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">STAT</option>
                </select>
              </div>

              {/* Container */}
              <div>
                <label htmlFor="path-container" className="block text-sm font-medium text-gray-700 mb-1">Container Type</label>
                <input
                  id="path-container"
                  type="text"
                  value={container}
                  onChange={(e) => setContainer(e.target.value)}
                  placeholder="e.g., Large specimen container"
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              {/* Fixative */}
              <div>
                <label htmlFor="path-fixative" className="block text-sm font-medium text-gray-700 mb-1">Fixative</label>
                <select
                  id="path-fixative"
                  value={fixative}
                  onChange={(e) => setFixative(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="10% formalin">10% Formalin</option>
                  <option value="95% alcohol">95% Alcohol</option>
                  <option value="CytoLyt">CytoLyt</option>
                  <option value="RPMI">RPMI</option>
                  <option value="none">None (Fresh)</option>
                </select>
              </div>

              {/* Clinical History */}
              <div className="md:col-span-2">
                <label htmlFor="path-clinical-history" className="block text-sm font-medium text-gray-700 mb-1">Clinical History</label>
                <textarea
                  id="path-clinical-history"
                  value={clinicalHistory}
                  onChange={(e) => setClinicalHistory(e.target.value)}
                  rows={3}
                  placeholder="Relevant clinical history..."
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              {/* Clinical Diagnosis */}
              <div className="md:col-span-2">
                <label htmlFor="path-clinical-diagnosis" className="block text-sm font-medium text-gray-700 mb-1">Clinical Diagnosis</label>
                <input
                  id="path-clinical-diagnosis"
                  type="text"
                  value={clinicalDiagnosis}
                  onChange={(e) => setClinicalDiagnosis(e.target.value)}
                  placeholder="Working/differential diagnosis..."
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('worklist')}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                Submit Specimen
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Report Tab */}
      {activeTab === 'report' && selectedSpecimen && (
        <div className="space-y-6">
          {/* Specimen Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Specimen Information</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700">Specimen ID:</span>
                <p className="text-gray-900">{selectedSpecimen.specimenId}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Patient:</span>
                <p className="text-gray-900">{selectedSpecimen.patientName}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Type:</span>
                <p className="text-gray-900">{selectedSpecimen.specimenType}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Site:</span>
                <p className="text-gray-900">{selectedSpecimen.site} {selectedSpecimen.laterality !== 'n/a' ? `(${selectedSpecimen.laterality})` : ''}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Collected:</span>
                <p className="text-gray-900">{selectedSpecimen.collectionDate} {selectedSpecimen.collectionTime}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Clinician:</span>
                <p className="text-gray-900">{selectedSpecimen.clinician}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Fixative:</span>
                <p className="text-gray-900">{selectedSpecimen.fixative}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Status:</span>
                <span className={`px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(selectedSpecimen.status)}`}>
                  {selectedSpecimen.status}
                </span>
              </div>
            </div>
            {selectedSpecimen.clinicalHistory && (
              <div className="mt-4">
                <span className="font-medium text-gray-700">Clinical History:</span>
                <p className="text-gray-900 mt-1">{selectedSpecimen.clinicalHistory}</p>
              </div>
            )}
            {selectedSpecimen.clinicalDiagnosis && (
              <div className="mt-2">
                <span className="font-medium text-gray-700">Clinical Diagnosis:</span>
                <p className="text-gray-900 mt-1">{selectedSpecimen.clinicalDiagnosis}</p>
              </div>
            )}
          </div>

          {/* Digital Slide Viewer Placeholder */}
          <div className="bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
            <Microscope className="h-12 w-12 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-600 font-medium">[Digital Pathology Viewer Placeholder]</p>
            <p className="text-sm text-gray-500 mt-1">
              Whole slide images (WSI) would display here via OpenSeadragon or similar viewer
            </p>
            {slides.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {slides.map((slide, idx) => (
                  <span key={idx} className="px-3 py-1 bg-white border rounded text-sm text-gray-700">
                    {slide}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Gross Examination */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 id="path-gross-examination-heading" className="text-lg font-bold mb-3">Gross Examination</h3>
            <textarea
              id="path-gross-description"
              aria-labelledby="path-gross-examination-heading"
              value={grossDescription}
              onChange={(e) => setGrossDescription(e.target.value)}
              rows={6}
              placeholder="Describe the gross appearance of the specimen..."
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          {/* Blocks and Slides */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-bold mb-3">Tissue Processing</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Blocks */}
              <div>
                <label htmlFor="path-new-block" className="block text-sm font-medium text-gray-700 mb-2">Tissue Blocks</label>
                <div className="flex space-x-2 mb-2">
                  <input
                    id="path-new-block"
                    type="text"
                    value={newBlock}
                    onChange={(e) => setNewBlock(e.target.value)}
                    placeholder="e.g., A1-tumor"
                    className="flex-1 px-3 py-2 border rounded-md"
                  />
                  <button
                    type="button"
                    onClick={addBlock}
                    className="px-3 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {blocks.map((block, idx) => (
                    <span key={idx} className="px-3 py-1 bg-gray-100 rounded text-sm">
                      {block}
                    </span>
                  ))}
                </div>
              </div>

              {/* Slides */}
              <div>
                <label htmlFor="path-new-slide" className="block text-sm font-medium text-gray-700 mb-2">Slides</label>
                <div className="flex space-x-2 mb-2">
                  <input
                    id="path-new-slide"
                    type="text"
                    value={newSlide}
                    onChange={(e) => setNewSlide(e.target.value)}
                    placeholder="e.g., H&E-A1"
                    className="flex-1 px-3 py-2 border rounded-md"
                  />
                  <button
                    type="button"
                    onClick={addSlide}
                    className="px-3 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {slides.map((slide, idx) => (
                    <span key={idx} className="px-3 py-1 bg-gray-100 rounded text-sm">
                      {slide}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Special Stains and IHC */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-bold mb-3">Special Studies</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Special Stains */}
              <div>
                <label id="path-special-stains-label" className="block text-sm font-medium text-gray-700 mb-2">Special Stains</label>
                <div className="space-y-2" role="group" aria-labelledby="path-special-stains-label">
                  {['PAS', 'PAS-D', 'Mucicarmine', 'Trichrome', 'Reticulin', 'Iron', 'Congo Red', 'AFB', 'GMS'].map((stain) => (
                    <label key={stain} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={specialStains.includes(stain)}
                        onChange={() => toggleSpecialStain(stain)}
                        className="mr-2"
                      />
                      <span className="text-sm">{stain}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* IHC Markers */}
              <div>
                <label id="path-ihc-markers-label" className="block text-sm font-medium text-gray-700 mb-2">Immunohistochemistry (IHC)</label>
                <div className="space-y-2" role="group" aria-labelledby="path-ihc-markers-label">
                  {['CK7', 'CK20', 'ER', 'PR', 'HER2', 'Ki-67', 'CD20', 'CD3', 'CD45', 'S100', 'HMB45', 'Desmin'].map((marker) => (
                    <label key={marker} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={ihcMarkers.includes(marker)}
                        onChange={() => toggleIHCMarker(marker)}
                        className="mr-2"
                      />
                      <span className="text-sm">{marker}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Microscopic Examination */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 id="path-microscopic-examination-heading" className="text-lg font-bold mb-3">Microscopic Examination</h3>
            <textarea
              id="path-microscopic-description"
              aria-labelledby="path-microscopic-examination-heading"
              value={microscopicDescription}
              onChange={(e) => setMicroscopicDescription(e.target.value)}
              rows={8}
              placeholder="Describe the microscopic findings..."
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          {/* Diagnosis */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 id="path-diagnosis-heading" className="text-lg font-bold mb-3">Diagnosis</h3>
            <textarea
              id="path-diagnosis"
              aria-labelledby="path-diagnosis-heading"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              rows={4}
              placeholder="Final pathologic diagnosis..."
              className="w-full px-3 py-2 border rounded-md mb-3"
            />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="path-snomed-code" className="block text-sm font-medium text-gray-700 mb-1">SNOMED Code</label>
                <input
                  id="path-snomed-code"
                  type="text"
                  value={snomedCode}
                  onChange={(e) => setSnomedCode(e.target.value)}
                  placeholder="e.g., 363406005"
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>
          </div>

          {/* Critical Findings */}
          <div className={`bg-white rounded-lg shadow p-6 ${isCritical ? 'border-2 border-red-500' : ''}`}>
            <div className="flex items-center mb-3">
              <input
                type="checkbox"
                id="critical"
                checked={isCritical}
                onChange={(e) => setIsCritical(e.target.checked)}
                className="mr-2"
              />
              <label htmlFor="critical" className="text-lg font-bold text-red-600">
                <AlertCircle className="inline h-5 w-5 mr-1" />
                Critical Findings
              </label>
            </div>
            {isCritical && (
              <div>
                <label htmlFor="path-communicated-to" className="block text-sm font-medium text-gray-700 mb-1">
                  Communicated To <span className="text-red-500">*</span>
                </label>
                <input
                  id="path-communicated-to"
                  type="text"
                  value={communicatedTo}
                  onChange={(e) => setCommunicatedTo(e.target.value)}
                  placeholder="Physician name and date/time of communication"
                  className="w-full px-3 py-2 border rounded-md"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Critical findings must be verbally communicated to the ordering physician and documented
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setActiveTab('worklist');
                setSelectedSpecimen(null);
              }}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSaveReport(false)}
              className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 flex items-center"
            >
              <Clock className="h-4 w-4 mr-2" />
              Save Preliminary
            </button>
            <button
              type="button"
              onClick={() => handleSaveReport(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Finalize Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PathologyPage;
