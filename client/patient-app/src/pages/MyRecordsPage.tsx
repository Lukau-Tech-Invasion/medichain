import { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Eye,
  Calendar,
  User,
  Filter,
  Search,
  ChevronRight,
  X,
  FlaskConical,
  Image,
  Pill,
  Stethoscope,
  FileCheck,
  Syringe,
  Clock,
  Shield,
  CheckCircle,
} from 'lucide-react';
import type { LabResultSubmission } from '@medichain/shared';

interface MedicalRecord {
  id: string;
  type: 'lab_result' | 'imaging' | 'prescription' | 'consultation' | 'discharge_summary' | 'vaccination' | 'other';
  title: string;
  description: string;
  provider: string;
  date: string;
  contentHash: string;
  metadataHash: string;
  verified: boolean;
  // Lab result specific fields (optional)
  labResults?: Array<{
    parameter: string;
    value: string;
    unit: string;
    reference_range: string;
    flag?: string;
  }>;
  reviewedBy?: string;
}

/**
 * My Records Page
 * 
 * View and download medical records stored on IPFS.
 * Records are encrypted and blockchain-verified.
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function MyRecordsPage() {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);

  useEffect(() => {
    loadRecords();
  }, []);

  const loadRecords = async () => {
    setIsLoading(true);
    
    // Try to fetch approved lab results from API
    let labRecords: MedicalRecord[] = [];
    try {
      const userId = localStorage.getItem('medichain_user_id') || 'PAT-001-DEMO';
      const response = await fetch(`http://localhost:8080/api/lab/patient/${userId}`, {
        headers: {
          'X-User-Id': userId,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        // Transform approved lab submissions to MedicalRecord format
        // Note: Only approved results are returned by the API for patients
        labRecords = (data.submissions || []).map((sub: LabResultSubmission) => ({
          id: sub.id,
          type: 'lab_result' as const,
          title: sub.test_name,
          description: `${sub.test_category} - ${sub.results.length} parameter(s)`,
          provider: sub.reviewed_by || sub.submitted_by,
          date: new Date(sub.reviewed_at || sub.submitted_at).toISOString().split('T')[0],
          contentHash: sub.content_hash || `lab-${sub.id}`,
          metadataHash: sub.metadata_hash || `meta-${sub.id}`,
          verified: true, // Approved means doctor-verified
          labResults: sub.results,
          reviewedBy: sub.reviewed_by,
        }));
      }
    } catch (error) {
      console.error('Failed to fetch lab results:', error);
      // Continue with demo data if API fails
    }

    // Demo records (non-lab records)
    const demoRecords: MedicalRecord[] = [
      {
        id: '1',
        type: 'lab_result',
        title: 'Complete Blood Count (CBC)',
        description: 'Routine blood work showing all values within normal range',
        provider: 'City General Hospital Lab',
        date: '2026-01-04',
        contentHash: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        metadataHash: 'QmZK3LwJ2K4GpQk8Q9K7LjM8N9P2Q4R5S6T7U8V9W0X1Y2',
        verified: true,
      },
      {
        id: '2',
        type: 'imaging',
        title: 'Chest X-Ray',
        description: 'Annual chest x-ray, no abnormalities detected',
        provider: 'RadiologyPlus Imaging Center',
        date: '2026-01-02',
        contentHash: 'QmT5NvUtoM5n8qTkFfvh8GsNPLPWSL6zcKgbKQcUdNqhyV',
        metadataHash: 'QmU6OvVtpN6o9rRkGwIPQMUrXlNdLhxXKdmRqVoNsxAb1W',
        verified: true,
      },
      {
        id: '3',
        type: 'prescription',
        title: 'Diabetes Medication Refill',
        description: 'Metformin 500mg, 90 day supply',
        provider: 'Dr. Sarah Smith',
        date: '2025-12-28',
        contentHash: 'QmV7PwWuqO7p0sSlHxJQNVmYoWpOtSx2LgzmSrWpOtYc2X',
        metadataHash: 'QmW8QxXvrP8q1tTmIyKRPWNnZpXqTz3MhAoTsXqPvUzD3Y',
        verified: true,
      },
      {
        id: '4',
        type: 'consultation',
        title: 'Annual Physical Examination',
        description: 'Comprehensive health check with Dr. Smith',
        provider: 'Dr. Sarah Smith',
        date: '2025-12-15',
        contentHash: 'QmX9RySwtQ9r2uUnJzLSQOXoApYuUa4NiBpUtYqQwVe4Z',
        metadataHash: 'QmY0SzTxuR0s3vVoKaM0TPZpBqVw5OjCqCuZrSaRxWfE5A',
        verified: true,
      },
      {
        id: '5',
        type: 'vaccination',
        title: 'Influenza Vaccine 2025-2026',
        description: 'Annual flu shot administered',
        provider: 'Community Health Center',
        date: '2025-11-10',
        contentHash: 'QmZ1TaUyv51t4wWpLbN1UQaCsSxXpPkDrEsDvTaSwXg6B',
        metadataHash: 'Qm02UbVzw62u5xXqMcO2VRbDtZYrFsEuFuCwUbTyYh7C',
        verified: true,
      },
    ];

    // Combine API lab results with demo records
    // Filter out demo lab_result if we have real ones from API
    const finalRecords = labRecords.length > 0
      ? [...labRecords, ...demoRecords.filter(r => r.type !== 'lab_result')]
      : demoRecords;

    // Sort by date descending
    finalRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setRecords(finalRecords);
    setIsLoading(false);
  };

  const getRecordIcon = (type: string) => {
    switch (type) {
      case 'lab_result':
        return <FlaskConical className="w-5 h-5" />;
      case 'imaging':
        return <Image className="w-5 h-5" />;
      case 'prescription':
        return <Pill className="w-5 h-5" />;
      case 'consultation':
        return <Stethoscope className="w-5 h-5" />;
      case 'discharge_summary':
        return <FileCheck className="w-5 h-5" />;
      case 'vaccination':
        return <Syringe className="w-5 h-5" />;
      default:
        return <FileText className="w-5 h-5" />;
    }
  };

  const getRecordColor = (type: string) => {
    switch (type) {
      case 'lab_result':
        return 'bg-info-light text-info';
      case 'imaging':
        return 'bg-purple-100 text-purple-600';
      case 'prescription':
        return 'bg-success-50 text-success-600';
      case 'consultation':
        return 'bg-primary-50 text-primary-600';
      case 'discharge_summary':
        return 'bg-warning-50 text-warning-600';
      case 'vaccination':
        return 'bg-emergency-50 text-emergency-500';
      default:
        return 'bg-neutral-100 text-neutral-600';
    }
  };

  const formatRecordType = (type: string) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleDownload = async (record: MedicalRecord) => {
    setIsDownloading(record.id);
    await new Promise(resolve => setTimeout(resolve, 1500));
    // In production: API call to download from IPFS
    setIsDownloading(null);
    alert(`Downloaded: ${record.title}`);
  };

  const filteredRecords = records.filter(record => {
    const matchesSearch = record.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         record.provider.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === 'all' || record.type === filterType;
    return matchesSearch && matchesFilter;
  });

  const recordTypes = ['all', 'lab_result', 'imaging', 'prescription', 'consultation', 'vaccination'];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-8 bg-neutral-200 rounded w-48" />
        <div className="h-12 bg-neutral-200 rounded-xl" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-neutral-200 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">My Medical Records</h1>
        <p className="text-neutral-600">Secure, blockchain-verified health documents</p>
      </div>

      {/* Search & Filter */}
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
          <input
            type="text"
            placeholder="Search records..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-neutral-100 border-0 rounded-xl focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
          {recordTypes.map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                filterType === type
                  ? 'bg-primary-500 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {type === 'all' ? 'All Records' : formatRecordType(type)}
            </button>
          ))}
        </div>
      </div>

      {/* Records Count */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <FileText className="w-4 h-4" />
        {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''} found
      </div>

      {/* Records List */}
      <div className="space-y-3">
        {filteredRecords.map(record => (
          <div
            key={record.id}
            className="patient-card hover:border-primary-200 border-2 border-transparent cursor-pointer"
            onClick={() => setSelectedRecord(record)}
          >
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${getRecordColor(record.type)}`}>
                {getRecordIcon(record.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium text-neutral-900 truncate">{record.title}</h3>
                  {record.verified && (
                    <Shield className="w-4 h-4 text-success-500 flex-shrink-0" />
                  )}
                </div>
                <p className="text-sm text-neutral-500 truncate mb-2">{record.description}</p>
                <div className="flex items-center gap-4 text-xs text-neutral-400">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {record.provider}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDate(record.date)}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-neutral-400 flex-shrink-0" />
            </div>
          </div>
        ))}

        {filteredRecords.length === 0 && (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
            <p className="text-neutral-500">No records found</p>
          </div>
        )}
      </div>

      {/* Record Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="sticky top-0 bg-white p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold text-neutral-900">Record Details</h2>
              <button
                onClick={() => setSelectedRecord(null)}
                className="p-2 hover:bg-neutral-100 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-neutral-500" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Record Header */}
              <div className="flex items-start gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${getRecordColor(selectedRecord.type)}`}>
                  {getRecordIcon(selectedRecord.type)}
                </div>
                <div>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mb-1 ${getRecordColor(selectedRecord.type)}`}>
                    {formatRecordType(selectedRecord.type)}
                  </span>
                  <h3 className="font-semibold text-lg text-neutral-900">{selectedRecord.title}</h3>
                  <p className="text-neutral-600">{selectedRecord.description}</p>
                </div>
              </div>

              {/* Record Info */}
              <div className="space-y-4 p-4 bg-neutral-50 rounded-xl">
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm text-neutral-500">Provider</p>
                    <p className="font-medium text-neutral-900">{selectedRecord.provider}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm text-neutral-500">Date</p>
                    <p className="font-medium text-neutral-900">{formatDate(selectedRecord.date)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm text-neutral-500">Status</p>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${selectedRecord.verified ? 'bg-success-500' : 'bg-warning-500'}`} />
                      <p className="font-medium text-neutral-900">
                        {selectedRecord.verified ? 'Blockchain Verified' : 'Pending Verification'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* IPFS Hash */}
              <div className="p-4 bg-info-light rounded-xl">
                <p className="text-sm text-info-dark mb-1 font-medium flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Document Hash (IPFS)
                </p>
                <p className="font-mono text-xs text-info break-all">{selectedRecord.contentHash}</p>
              </div>

              {/* Lab Results Details (only for lab_result type) */}
              {selectedRecord.type === 'lab_result' && selectedRecord.labResults && selectedRecord.labResults.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="w-5 h-5 text-info" />
                    <h4 className="font-semibold text-neutral-900">Test Results</h4>
                    <span className="text-xs text-success-600 flex items-center gap-1 bg-success-50 px-2 py-0.5 rounded-full">
                      <CheckCircle className="w-3 h-3" />
                      Doctor Approved
                    </span>
                  </div>
                  <div className="bg-neutral-50 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-100">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-neutral-600">Parameter</th>
                          <th className="text-right px-4 py-2 font-medium text-neutral-600">Value</th>
                          <th className="text-right px-4 py-2 font-medium text-neutral-600">Reference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRecord.labResults.map((result, idx) => (
                          <tr key={idx} className="border-t border-neutral-100">
                            <td className="px-4 py-2 text-neutral-900">{result.parameter}</td>
                            <td className="px-4 py-2 text-right">
                              <span className={`font-medium ${
                                result.flag === 'High' ? 'text-emergency-500' :
                                result.flag === 'Low' ? 'text-warning-600' :
                                'text-neutral-900'
                              }`}>
                                {result.value} {result.unit}
                              </span>
                              {result.flag && (
                                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                                  result.flag === 'High' ? 'bg-emergency-50 text-emergency-600' :
                                  'bg-warning-50 text-warning-600'
                                }`}>
                                  {result.flag}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right text-neutral-500">{result.reference_range}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedRecord.reviewedBy && (
                    <p className="text-xs text-neutral-500 flex items-center gap-1">
                      <Shield className="w-3 h-3 text-success-500" />
                      Reviewed and approved by {selectedRecord.reviewedBy}
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleDownload(selectedRecord)}
                  disabled={isDownloading === selectedRecord.id}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
                >
                  {isDownloading === selectedRecord.id ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                  Download
                </button>
                <button className="flex items-center justify-center gap-2 px-6 py-3 border-2 border-neutral-200 rounded-xl hover:bg-neutral-50 transition-colors">
                  <Eye className="w-5 h-5" />
                  View
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
