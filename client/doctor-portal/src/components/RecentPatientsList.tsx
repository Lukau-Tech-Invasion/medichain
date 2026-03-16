import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Users, Clock, Loader2 } from 'lucide-react';

interface RecentPatient {
  patientId: string;
  fullName: string;
  healthId?: string;
  lastAccessed?: string;
  blood_type?: string;
  allergies?: string[];
}

interface RecentPatientsListProps {
  loading: boolean;
  patients: RecentPatient[];
}

const RecentPatientsList: React.FC<RecentPatientsListProps> = ({ loading, patients }) => {
  if (loading) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="mx-auto mb-3 text-gray-300 animate-spin" size={48} />
        <p className="text-gray-500">Loading patients...</p>
      </div>
    );
  }

  if (patients.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Users className="mx-auto mb-3 text-gray-300" size={48} />
        <p>No patients found</p>
        <p className="text-sm mt-1">Register a patient or connect to the API</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {patients.map((patient) => (
        <Link
          key={patient.patientId}
          to={`/patients/${patient.patientId}`}
          className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
              <Users className="text-primary-600" size={20} />
            </div>
            <div>
              <p className="font-medium text-gray-900">{patient.fullName}</p>
              <p className="text-sm text-gray-500">{patient.healthId || patient.patientId}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {patient.blood_type && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                {patient.blood_type}
              </span>
            )}
            {patient.allergies && patient.allergies.length > 0 && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">
                {patient.allergies.length} allergies
              </span>
            )}
            {patient.lastAccessed ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock size={14} />
                    <span>{new Date(patient.lastAccessed).toLocaleDateString()}</span>
                </div>
            ) : <ArrowRight size={16} className="text-gray-400" />}
          </div>
        </Link>
      ))}
    </div>
  );
};

export default RecentPatientsList;
