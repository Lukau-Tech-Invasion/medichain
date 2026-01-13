import React, { useState, useEffect, useCallback } from 'react';
import { Scan, Search, FileText, AlertCircle, Eye, MessageSquare, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients, listRadiology, createRadiologyOrder } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';

type ReportStatus = 'pending' | 'in-progress' | 'preliminary' | 'final' | 'addendum';

interface RadiologyStudy {
  id: string;
  accessionNumber: string;
  patientId: string;
  patientName: string;
  mrn: string;
  dob: string;
  modality: string;
  studyDescription: string;
  studyDate: string;
  referringPhysician: string;
  status: ReportStatus;
  priority: 'stat' | 'urgent' | 'routine';
  numImages: number;
  radiologist?: string;
  reportedAt?: string;
  technique?: string;
  comparison?: string;
  findings?: string;
  impression?: string;
  criticalFindings: boolean;
  communicatedTo?: string;
  communicatedAt?: string;
}

const RadiologyPage: React.FC = () => {
  const { user } = useAuthStore();
  const [_patients, setPatients] = useState<PatientProfile[]>([]);
  const [studies, setStudies] = useState<RadiologyStudy[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'worklist' | 'report' | 'search'>('worklist');
  const [selectedStudy, setSelectedStudy] = useState<RadiologyStudy | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterModality, setFilterModality] = useState<string>('all');

  // Report form
  const [technique, setTechnique] = useState('');
  const [comparison, setComparison] = useState('');
  const [findings, setFindings] = useState('');
  const [impression, setImpression] = useState('');
  const [criticalFindings, setCriticalFindings] = useState(false);
  const [communicatedTo, setCommunicatedTo] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [patientData, radiologyData] = await Promise.all([
        getPatients(),
        listRadiology()
      ]);
      setPatients(patientData);
      
      // Map API response (orders.items) to RadiologyStudy interface
      const orderItems = radiologyData.orders?.items || [];
      const mappedStudies: RadiologyStudy[] = orderItems.map((item) => {
        const record = item as Record<string, unknown>;
        return {
          id: (record.order_id || record.orderId || record.id || '') as string,
          accessionNumber: (record.accession_number || record.accessionNumber || '') as string,
          patientId: (record.patient_id || record.patientId || '') as string,
          patientName: (record.patient_name || record.patientName || '') as string,
          mrn: (record.mrn || '') as string,
          dob: (record.dob || '') as string,
          modality: (record.modality || '') as string,
          studyDescription: (record.study_description || record.studyDescription || '') as string,
          studyDate: (record.study_date || record.studyDate || '') as string,
          referringPhysician: (record.referring_physician || record.referringPhysician || '') as string,
          status: (record.status || 'pending') as ReportStatus,
          priority: (record.priority || 'routine') as 'stat' | 'urgent' | 'routine',
          numImages: (record.num_images || record.numImages || 0) as number,
          radiologist: record.radiologist as string | undefined,
          reportedAt: record.reported_at || record.reportedAt,
          technique: record.technique,
          comparison: record.comparison,
          findings: record.findings,
          impression: record.impression,
          criticalFindings: (record.critical_findings ?? record.criticalFindings ?? false) as boolean,
          communicatedTo: record.communicated_to || record.communicatedTo,
          communicatedAt: record.communicated_at || record.communicatedAt,
        } as RadiologyStudy;
      });
      
      setStudies(mappedStudies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch radiology data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const selectStudyForReading = (study: RadiologyStudy) => {
    setSelectedStudy(study);
    setTechnique(study.technique || '');
    setComparison(study.comparison || '');
    setFindings(study.findings || '');
    setImpression(study.impression || '');
    setCriticalFindings(study.criticalFindings);
    setCommunicatedTo(study.communicatedTo || '');
    setActiveTab('report');
  };

  const saveReport = (asFinal: boolean) => {
    if (!selectedStudy) return;
    if (criticalFindings && !communicatedTo) {
      alert('Critical findings must be communicated before finalizing');
      return;
    }
    const updatedStudy: RadiologyStudy = {
      ...selectedStudy,
      technique, comparison, findings, impression, criticalFindings,
      communicatedTo: criticalFindings ? communicatedTo : undefined,
      communicatedAt: criticalFindings ? new Date().toISOString() : undefined,
      status: asFinal ? 'final' : 'preliminary',
      radiologist: user?.walletAddress || '',
      reportedAt: new Date().toISOString()
    };
    setStudies(studies.map(s => s.id === selectedStudy.id ? updatedStudy : s));
    alert(`Report saved as ${asFinal ? 'FINAL' : 'PRELIMINARY'}`);
    setSelectedStudy(null);
    setActiveTab('worklist');
  };

  const getStatusBadge = (status: ReportStatus) => {
    const styles: Record<ReportStatus, string> = {
      pending: 'bg-red-100 text-red-700',
      'in-progress': 'bg-yellow-100 text-yellow-700',
      preliminary: 'bg-orange-100 text-orange-700',
      final: 'bg-green-100 text-green-700',
      addendum: 'bg-blue-100 text-blue-700'
    };
    return styles[status];
  };

  const filteredStudies = studies.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false;
    if (filterModality !== 'all' && s.modality !== filterModality) return false;
    if (searchTerm && !s.patientName.toLowerCase().includes(searchTerm.toLowerCase())
        && !s.accessionNumber.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scan className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold">Radiology Worklist</h1>
              <p className="text-gray-400 text-sm">PACS Reading Station</p>
            </div>
          </div>
          <div className="text-sm text-gray-400">
            Radiologist: {user?.walletAddress || 'Not logged in'}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="flex">
          {[{ id: 'worklist', label: 'Worklist', icon: FileText },
            { id: 'report', label: 'Report', icon: MessageSquare },
            { id: 'search', label: 'Search', icon: Search }].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'worklist' | 'report' | 'search')}
              className={`px-6 py-3 font-medium flex items-center gap-2 ${activeTab === tab.id
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-gray-200'}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {activeTab === 'worklist' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-4 items-center flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-64">
                <Search className="w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search patient or accession..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded p-2 text-white"
                />
              </div>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded p-2"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="in-progress">In Progress</option>
                <option value="preliminary">Preliminary</option>
                <option value="final">Final</option>
              </select>
              <select
                value={filterModality}
                onChange={e => setFilterModality(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded p-2"
              >
                <option value="all">All Modalities</option>
                <option value="CT">CT</option>
                <option value="MRI">MRI</option>
                <option value="XR">X-Ray</option>
                <option value="US">Ultrasound</option>
              </select>
            </div>

            {/* Studies Table */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="p-3 text-left">Priority</th>
                    <th className="p-3 text-left">Patient</th>
                    <th className="p-3 text-left">Study</th>
                    <th className="p-3 text-center">Images</th>
                    <th className="p-3 text-left">Date/Time</th>
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudies.map(s => (
                    <tr key={s.id} className={`border-b border-gray-700 hover:bg-gray-750 ${s.priority === 'stat' ? 'bg-red-900/20' : ''}`}>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          s.priority === 'stat' ? 'bg-red-600' :
                          s.priority === 'urgent' ? 'bg-orange-500' : 'bg-gray-600'
                        }`}>
                          {s.priority.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3">
                        <div>{s.patientName}</div>
                        <div className="text-xs text-gray-400">{s.mrn} | DOB: {s.dob}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="bg-blue-600 px-2 py-0.5 rounded text-xs">{s.modality}</span>
                          {s.studyDescription}
                        </div>
                      </td>
                      <td className="p-3 text-center">{s.numImages}</td>
                      <td className="p-3 text-gray-400">{new Date(s.studyDate).toLocaleString()}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs ${getStatusBadge(s.status)}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex gap-2 justify-center">
                          <button className="p-2 bg-gray-700 rounded hover:bg-gray-600" title="View Images">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => selectStudyForReading(s)}
                            className="p-2 bg-blue-600 rounded hover:bg-blue-500"
                            title="Read Study"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'report' && selectedStudy && (
          <div className="grid md:grid-cols-2 gap-4">
            {/* Study Info */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h2 className="font-semibold mb-3 text-blue-400">Study Information</h2>
              <div className="space-y-2 text-sm">
                <p><strong>Patient:</strong> {selectedStudy.patientName}</p>
                <p><strong>MRN:</strong> {selectedStudy.mrn} | <strong>DOB:</strong> {selectedStudy.dob}</p>
                <p><strong>Study:</strong> {selectedStudy.studyDescription}</p>
                <p><strong>Accession:</strong> {selectedStudy.accessionNumber}</p>
                <p><strong>Date:</strong> {new Date(selectedStudy.studyDate).toLocaleString()}</p>
                <p><strong>Referring:</strong> {selectedStudy.referringPhysician}</p>
                <p><strong>Images:</strong> {selectedStudy.numImages}</p>
              </div>
              <div className="mt-4 p-3 bg-gray-900 rounded text-center text-gray-500">
                [DICOM Viewer Placeholder]<br />
                Images would display here via PACS integration
              </div>
            </div>

            {/* Report Form */}
            <div className="bg-gray-800 rounded-lg p-4 space-y-4">
              <h2 className="font-semibold text-blue-400">Radiology Report</h2>
              <div>
                <label className="text-sm text-gray-400">Technique</label>
                <textarea
                  value={technique}
                  onChange={e => setTechnique(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded p-2 h-16"
                  placeholder="Describe imaging technique..."
                />
              </div>
              <div>
                <label className="text-sm text-gray-400">Comparison</label>
                <input
                  type="text"
                  value={comparison}
                  onChange={e => setComparison(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded p-2"
                  placeholder="Prior studies compared..."
                />
              </div>
              <div>
                <label className="text-sm text-gray-400">Findings</label>
                <textarea
                  value={findings}
                  onChange={e => setFindings(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded p-2 h-32"
                  placeholder="Describe findings..."
                />
              </div>
              <div>
                <label className="text-sm text-gray-400">Impression</label>
                <textarea
                  value={impression}
                  onChange={e => setImpression(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded p-2 h-20"
                  placeholder="Summarize impression..."
                />
              </div>

              {/* Critical Findings */}
              <div className={`p-3 rounded ${criticalFindings ? 'bg-red-900/50 border border-red-500' : 'bg-gray-900'}`}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={criticalFindings}
                    onChange={e => setCriticalFindings(e.target.checked)}
                  />
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span className="text-red-400 font-medium">Critical Finding</span>
                </label>
                {criticalFindings && (
                  <div className="mt-2">
                    <label className="text-sm text-gray-400">Communicated To *</label>
                    <input
                      type="text"
                      value={communicatedTo}
                      onChange={e => setCommunicatedTo(e.target.value)}
                      className="w-full bg-gray-800 border border-red-500 rounded p-2"
                      placeholder="Name of person notified..."
                    />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => saveReport(false)}
                  className="flex-1 py-2 bg-orange-600 text-white rounded hover:bg-orange-500"
                >
                  Save Preliminary
                </button>
                <button
                  onClick={() => saveReport(true)}
                  className="flex-1 py-2 bg-green-600 text-white rounded hover:bg-green-500"
                >
                  Finalize Report
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'report' && !selectedStudy && (
          <div className="text-center py-12 text-gray-500">
            Select a study from the worklist to begin reading
          </div>
        )}

        {activeTab === 'search' && (
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-gray-400">Advanced search and prior studies lookup coming soon...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RadiologyPage;
