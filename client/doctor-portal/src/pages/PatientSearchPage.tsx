import { useState } from 'react';
import { usePatientStore } from '../store';
import { Search, Users, Filter, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Patient {
  patientId: string;
  fullName: string;
  dateOfBirth: string;
  bloodType: string;
  nationalHealthId: string;
  lastVisit?: string;
}

/**
 * PatientSearchPage - Search and browse patients
 */
function PatientSearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const { searchResults, setSearchResults, addToRecentPatients } = usePatientStore();

  // Mock patient data for demo
  const mockPatients: Patient[] = [
    {
      patientId: 'PAT-001-DEMO',
      fullName: 'John Doe',
      dateOfBirth: '1985-06-15',
      bloodType: 'O+',
      nationalHealthId: 'MCHI-2026-A1B2-C3D4',
      lastVisit: '2026-01-03',
    },
    {
      patientId: 'PAT-002',
      fullName: 'Jane Smith',
      dateOfBirth: '1990-03-22',
      bloodType: 'A-',
      nationalHealthId: 'MCHI-2026-E5F6-G7H8',
      lastVisit: '2026-01-02',
    },
    {
      patientId: 'PAT-003',
      fullName: 'Michael Johnson',
      dateOfBirth: '1978-11-08',
      bloodType: 'B+',
      nationalHealthId: 'MCHI-2026-I9J0-K1L2',
      lastVisit: '2025-12-28',
    },
    {
      patientId: 'PAT-004',
      fullName: 'Sarah Williams',
      dateOfBirth: '1995-07-30',
      bloodType: 'AB+',
      nationalHealthId: 'MCHI-2026-M3N4-O5P6',
      lastVisit: '2025-12-15',
    },
  ];

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const results = mockPatients.filter(
      p => 
        p.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.patientId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.nationalHealthId.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    // Convert Patient to EmergencyInfo format for store
    const emergencyInfoResults = results.map(p => ({
      patientId: p.patientId,
      fullName: p.fullName,
      bloodType: p.bloodType,
      allergies: [],
      currentMedications: [],
      chronicConditions: [],
      emergencyContacts: [],
      organDonor: false,
      dnrStatus: false,
      lastUpdated: p.lastVisit || new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
    }));
    
    setSearchResults(emergencyInfoResults);
    setIsSearching(false);
  };

  const handlePatientClick = (patient: Patient) => {
    // Convert Patient to EmergencyInfo format for store
    const emergencyInfo = {
      patientId: patient.patientId,
      fullName: patient.fullName,
      bloodType: patient.bloodType,
      allergies: [] as string[],
      currentMedications: [] as string[],
      chronicConditions: [] as string[],
      emergencyContacts: [] as { name: string; phone: string; relationship: string }[],
      organDonor: false,
      dnrStatus: false,
      lastUpdated: patient.lastVisit ?? new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
    };
    addToRecentPatients(emergencyInfo);
  };

  // Show search results as Patient[] or default mockPatients
  // Note: searchResults is EmergencyInfo[] but we need Patient[] for display
  const displayPatients: Patient[] = mockPatients.filter(p => 
    searchResults.length === 0 || searchResults.some(r => r.patientId === p.patientId)
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Patient Search</h1>
        <p className="text-gray-500 mt-1">
          Search for patients by name, ID, or National Health ID
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, patient ID, or National Health ID..."
              className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
            />
          </div>
          <button
            type="button"
            className="px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <Filter size={20} />
            Filters
          </button>
          <button
            type="submit"
            disabled={isSearching}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {/* Results */}
      <div className="bg-white rounded-xl shadow">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="text-gray-400" size={20} />
            <span className="font-medium text-gray-700">
              {displayPatients.length} patient{displayPatients.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {displayPatients.map((patient) => (
            <Link
              key={patient.patientId}
              to={`/patients/${patient.patientId}`}
              onClick={() => handlePatientClick(patient)}
              className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                  <span className="text-primary-600 font-bold">
                    {patient.fullName.split(' ').map(n => n[0]).join('')}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">{patient.fullName}</p>
                  <p className="text-sm text-gray-500">
                    {patient.patientId} • DOB: {patient.dateOfBirth}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-700">
                    Blood Type: <span className="text-emergency-600">{patient.bloodType}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    Last visit: {patient.lastVisit}
                  </p>
                </div>
                <ChevronRight className="text-gray-300" size={20} />
              </div>
            </Link>
          ))}
        </div>

        {displayPatients.length === 0 && (
          <div className="p-12 text-center">
            <Users className="mx-auto mb-3 text-gray-300" size={48} />
            <p className="text-gray-500">No patients found</p>
            <p className="text-sm text-gray-400 mt-1">
              Try a different search term
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PatientSearchPage;
