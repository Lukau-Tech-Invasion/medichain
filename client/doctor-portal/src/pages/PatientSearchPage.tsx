import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatientStore, useAuthStore } from '../store';
import { apiUrl } from '@medichain/shared';
import { Search, Users, Filter, ChevronRight, Loader2, AlertCircle, Droplet, Pill, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ApiPatient {
  patient_id: string;
  health_id: string;
  full_name: string;
  date_of_birth: string;
  gender: string;
  national_id: string;
  blood_type?: string;
  allergies: string[];
  current_medications: string[];
  medical_conditions: string[];
  emergency_contact?: {
    name: string;
    phone: string;
    relationship: string;
  };
}

interface Patient {
  patientId: string;
  healthId: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  bloodType: string;
  nationalHealthId: string;
  allergies: string[];
  medications: string[];
  conditions: string[];
  lastVisit?: string;
}

// Helper to convert blood type enum to display string
function formatBloodType(bloodType: string | undefined): string {
  if (!bloodType) return 'Unknown';
  const bloodTypeMap: Record<string, string> = {
    'APositive': 'A+',
    'ANegative': 'A-',
    'BPositive': 'B+',
    'BNegative': 'B-',
    'ABPositive': 'AB+',
    'ABNegative': 'AB-',
    'OPositive': 'O+',
    'ONegative': 'O-',
  };
  return bloodTypeMap[bloodType] || bloodType;
}

/**
 * PatientSearchPage - Search and browse patients
 */
function PatientSearchPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState(false);
  const [filterBloodType, setFilterBloodType] = useState<string>('all');
  const [filterGender, setFilterGender] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const { searchResults, setSearchResults, addToRecentPatients } = usePatientStore();
  const { user, isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Fetch patients from API on mount
  useEffect(() => {
    if (!user) return;
    
    const fetchPatients = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${apiUrl}/api/patients/list`, {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch patients');
        }

        const data = await response.json();
        setApiConnected(true);
        
        // Transform API response to Patient format
        const transformedPatients: Patient[] = data.patients.map((p: ApiPatient) => ({
          patientId: p.patient_id,
          healthId: p.health_id,
          fullName: p.full_name,
          dateOfBirth: p.date_of_birth,
          gender: p.gender,
          bloodType: formatBloodType(p.blood_type),
          nationalHealthId: p.national_id,
          allergies: p.allergies || [],
          medications: p.current_medications || [],
          conditions: p.medical_conditions || [],
          lastVisit: new Date().toISOString().split('T')[0],
        }));
        
        setPatients(transformedPatients);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch patients');
        setApiConnected(false);
      } finally {
        setLoading(false);
      }
    };

    fetchPatients();
  }, [user]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    
    const results = patients.filter(
      p => 
        p.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.patientId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.nationalHealthId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.healthId.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    // Convert Patient to EmergencyInfo format for store
    const emergencyInfoResults = results.map(p => ({
      patientId: p.patientId,
      fullName: p.fullName,
      bloodType: p.bloodType,
      allergies: p.allergies,
      currentMedications: p.medications,
      chronicConditions: p.conditions,
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
      allergies: patient.allergies,
      currentMedications: patient.medications,
      chronicConditions: patient.conditions,
      emergencyContacts: [] as { name: string; phone: string; relationship: string }[],
      organDonor: false,
      dnrStatus: false,
      lastUpdated: patient.lastVisit ?? new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
    };
    addToRecentPatients(emergencyInfo);
  };

  // Apply filters
  const filteredPatients = patients.filter(p => {
    if (filterBloodType !== 'all' && p.bloodType !== filterBloodType) return false;
    if (filterGender !== 'all' && p.gender.toLowerCase() !== filterGender) return false;
    return true;
  });

  // Show search results or all patients
  const displayPatients: Patient[] = searchResults.length > 0
    ? filteredPatients.filter(p => searchResults.some(r => r.patientId === p.patientId))
    : filteredPatients;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patient Search</h1>
          <p className="text-gray-500 mt-1">
            Search for patients by name, ID, or National Health ID
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            <span className={`w-2 h-2 rounded-full ${apiConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            {apiConnected ? 'API Connected' : 'API Disconnected'}
          </span>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, patient ID, Health ID, or National ID..."
              className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-3 border rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 ${
              showFilters ? 'border-primary-500 bg-primary-50' : 'border-gray-200'
            }`}
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

      {/* Filters Panel */}
      {showFilters && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Blood Type</label>
              <select
                value={filterBloodType}
                onChange={(e) => setFilterBloodType(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Blood Types</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
              <select
                value={filterGender}
                onChange={(e) => setFilterGender(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Genders</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setFilterBloodType('all');
                  setFilterGender('all');
                }}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="bg-white rounded-xl shadow">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="text-gray-400" size={20} />
            <span className="font-medium text-gray-700">
              {displayPatients.length} patient{displayPatients.length !== 1 ? 's' : ''}
              {(filterBloodType !== 'all' || filterGender !== 'all') && (
                <span className="text-gray-400 ml-1">(filtered)</span>
              )}
            </span>
          </div>
          <span className="text-sm text-gray-400">
            Total in system: {patients.length}
          </span>
        </div>

        {!loading && !error && displayPatients.length > 0 && (
          <div className="divide-y divide-gray-100">
            {displayPatients.map((patient) => (
              <Link
                key={patient.patientId}
                to={`/patients/${patient.patientId}`}
                onClick={() => handlePatientClick(patient)}
                className="block p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-600 font-bold">
                        {patient.fullName.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{patient.fullName}</p>
                      <p className="text-sm text-gray-500">
                        {patient.patientId} • {patient.gender} • DOB: {patient.dateOfBirth}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Health ID: {patient.healthId}
                      </p>
                      
                      {/* Medical Info Tags */}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {patient.allergies.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded-full">
                            <AlertCircle size={12} />
                            {patient.allergies.length} Allergie{patient.allergies.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {patient.medications.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">
                            <Pill size={12} />
                            {patient.medications.length} Medication{patient.medications.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {patient.conditions.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded-full">
                            <Heart size={12} />
                            {patient.conditions.length} Condition{patient.conditions.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Droplet size={14} className="text-red-500" />
                        <span className="text-sm font-medium text-red-600">{patient.bloodType}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        Last visit: {patient.lastVisit}
                      </p>
                    </div>
                    <ChevronRight className="text-gray-300" size={20} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {loading && (
          <div className="p-12 text-center">
            <Loader2 className="mx-auto mb-3 text-primary-500 animate-spin" size={48} />
            <p className="text-gray-500">Loading patients from API...</p>
          </div>
        )}

        {error && !loading && (
          <div className="p-12 text-center">
            <Users className="mx-auto mb-3 text-red-300" size={48} />
            <p className="text-red-500">{error}</p>
            <p className="text-sm text-gray-400 mt-1">
              Check that the API server is running on port 8080
            </p>
          </div>
        )}

        {!loading && !error && displayPatients.length === 0 && (
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
