/**
 * Patient Card Component
 * Displays patient information in a card format
 */

import { clsx } from 'clsx';
import { User, Heart, AlertTriangle, Phone, Droplets, Pill, Activity } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge, StatusBadge } from './Badge';
import type { PatientProfile, EmergencyInfo } from '../types';

export interface PatientCardProps {
  patient: PatientProfile;
  variant?: 'compact' | 'full';
  onClick?: () => void;
  className?: string;
}

export function PatientCard({
  patient,
  variant = 'compact',
  onClick,
  className,
}: PatientCardProps) {
  const isClickable = !!onClick;

  if (variant === 'compact') {
    return (
      <Card
        className={clsx(
          isClickable && 'cursor-pointer hover:shadow-md transition-shadow',
          className
        )}
        onClick={onClick}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
            <User className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">
              {patient.full_name}
            </h3>
            <p className="text-sm text-gray-500">
              ID: {patient.patient_id}
            </p>
            <p className="text-sm text-gray-500">
              DOB: {patient.date_of_birth}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="primary">
              <Droplets className="w-3 h-3 mr-1" />
              {patient.emergency_info.blood_type}
            </Badge>
            {patient.emergency_info.allergies.length > 0 && (
              <Badge variant="danger">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {patient.emergency_info.allergies.length} allergies
              </Badge>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Full variant
  return (
    <Card className={className} padding="lg">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <User className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <CardTitle as="h2">{patient.full_name}</CardTitle>
              <p className="text-gray-500">Patient ID: {patient.patient_id}</p>
              <p className="text-gray-500">DOB: {patient.date_of_birth}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant="primary" size="md">
              <Droplets className="w-4 h-4 mr-1" />
              {patient.emergency_info.blood_type}
            </Badge>
            {patient.emergency_info.organ_donor && (
              <Badge variant="success" size="md">
                <Heart className="w-4 h-4 mr-1" />
                Organ Donor
              </Badge>
            )}
            {patient.emergency_info.dnr_status && (
              <Badge variant="danger" size="md">DNR</Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Allergies */}
          <div>
            <h4 className="flex items-center gap-2 font-medium text-gray-900 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Allergies
            </h4>
            {patient.emergency_info.allergies.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {patient.emergency_info.allergies.map((allergy, idx) => (
                  <Badge key={idx} variant="danger">{allergy}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No known allergies</p>
            )}
          </div>

          {/* Medications */}
          <div>
            <h4 className="flex items-center gap-2 font-medium text-gray-900 mb-2">
              <Pill className="w-4 h-4 text-blue-500" />
              Current Medications
            </h4>
            {patient.emergency_info.current_medications.length > 0 ? (
              <ul className="space-y-1">
                {patient.emergency_info.current_medications.map((med, idx) => (
                  <li key={idx} className="text-sm text-gray-600">{med}</li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500 text-sm">No current medications</p>
            )}
          </div>

          {/* Chronic Conditions */}
          <div>
            <h4 className="flex items-center gap-2 font-medium text-gray-900 mb-2">
              <Activity className="w-4 h-4 text-orange-500" />
              Chronic Conditions
            </h4>
            {patient.emergency_info.chronic_conditions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {patient.emergency_info.chronic_conditions.map((condition, idx) => (
                  <Badge key={idx} variant="warning">{condition}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No chronic conditions</p>
            )}
          </div>

          {/* Emergency Contact */}
          <div>
            <h4 className="flex items-center gap-2 font-medium text-gray-900 mb-2">
              <Phone className="w-4 h-4 text-green-500" />
              Emergency Contact
            </h4>
            {patient.emergency_info.emergency_contacts.length > 0 ? (
              <div>
                {patient.emergency_info.emergency_contacts.map((contact, idx) => (
                  <div key={idx} className="text-sm">
                    <p className="font-medium text-gray-900">{contact.name}</p>
                    <p className="text-gray-600">{contact.relationship}</p>
                    <p className="text-blue-600">{contact.phone}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No emergency contact</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Emergency Info Card - Critical information display
 */

export interface EmergencyInfoCardProps {
  info: EmergencyInfo;
  className?: string;
}

export function EmergencyInfoCard({ info, className }: EmergencyInfoCardProps) {
  return (
    <Card 
      className={clsx('border-red-500 border-2', className)} 
      padding="lg"
    >
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-6 h-6 text-red-500" />
        <h3 className="text-lg font-bold text-red-700">Emergency Medical Information</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center p-3 bg-red-50 rounded-lg">
          <Droplets className="w-8 h-8 text-red-600 mx-auto mb-1" />
          <p className="text-xs text-gray-600">Blood Type</p>
          <p className="text-2xl font-bold text-red-700">{info.blood_type}</p>
        </div>

        <div className="text-center p-3 bg-orange-50 rounded-lg">
          <AlertTriangle className="w-8 h-8 text-orange-600 mx-auto mb-1" />
          <p className="text-xs text-gray-600">Allergies</p>
          <p className="text-2xl font-bold text-orange-700">{info.allergies.length}</p>
        </div>

        <div className="text-center p-3 bg-blue-50 rounded-lg">
          <Pill className="w-8 h-8 text-blue-600 mx-auto mb-1" />
          <p className="text-xs text-gray-600">Medications</p>
          <p className="text-2xl font-bold text-blue-700">{info.current_medications.length}</p>
        </div>

        <div className="text-center p-3 bg-purple-50 rounded-lg">
          <Activity className="w-8 h-8 text-purple-600 mx-auto mb-1" />
          <p className="text-xs text-gray-600">Conditions</p>
          <p className="text-2xl font-bold text-purple-700">{info.chronic_conditions.length}</p>
        </div>
      </div>

      {info.allergies.length > 0 && (
        <div className="mt-4 p-3 bg-red-100 rounded-lg">
          <p className="text-sm font-medium text-red-800 mb-2">⚠️ ALLERGIES:</p>
          <p className="text-red-900 font-bold">{info.allergies.join(' • ')}</p>
        </div>
      )}

      <div className="flex gap-4 mt-4">
        {info.organ_donor && (
          <Badge variant="success" size="md">
            <Heart className="w-4 h-4 mr-1" /> Organ Donor
          </Badge>
        )}
        {info.dnr_status && (
          <Badge variant="danger" size="md">DNR - Do Not Resuscitate</Badge>
        )}
      </div>
    </Card>
  );
}
