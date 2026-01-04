import { useState, useEffect } from 'react';
import {
  User,
  Heart,
  AlertTriangle,
  Pill,
  Phone,
  Calendar,
  Droplets,
  Activity,
  Shield,
  CheckCircle,
  Plus,
  X,
  Save,
  Info,
} from 'lucide-react';

interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

interface PatientProfile {
  patientId: string;
  fullName: string;
  dateOfBirth: string;
  nationalHealthId: string;
  bloodType: string;
  allergies: string[];
  currentMedications: string[];
  chronicConditions: string[];
  emergencyContacts: EmergencyContact[];
  organDonor: boolean;
  dnrStatus: boolean;
  lastUpdated: string;
}

/**
 * My Profile Page
 * 
 * Displays patient's personal and medical information.
 * Patients can ONLY add emergency contacts.
 * All other profile changes must be made by healthcare providers.
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function MyProfilePage() {
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContact, setNewContact] = useState<EmergencyContact>({ name: '', phone: '', relationship: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Demo profile data
    const demoProfile: PatientProfile = {
      patientId: 'PAT-001-DEMO',
      fullName: 'John Doe',
      dateOfBirth: '1985-06-15',
      nationalHealthId: 'MCHI-2026-DEMO-XXXX',
      bloodType: 'O+',
      allergies: ['Penicillin', 'Sulfa drugs'],
      currentMedications: ['Metformin 500mg - twice daily', 'Lisinopril 10mg - once daily'],
      chronicConditions: ['Type 2 Diabetes', 'Hypertension'],
      emergencyContacts: [
        { name: 'Jane Doe', phone: '+234-801-234-5678', relationship: 'Spouse' },
        { name: 'Mike Doe', phone: '+234-802-345-6789', relationship: 'Brother' },
      ],
      organDonor: true,
      dnrStatus: false,
      lastUpdated: '2026-01-04T10:30:00Z',
    };

    setProfile(demoProfile);
    setIsLoading(false);
  };

  const handleAddContact = async () => {
    if (!newContact.name || !newContact.phone || !newContact.relationship) {
      return;
    }

    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (profile) {
      setProfile({
        ...profile,
        emergencyContacts: [...profile.emergencyContacts, newContact],
        lastUpdated: new Date().toISOString(),
      });
    }
    
    setIsSaving(false);
    setIsAddingContact(false);
    setNewContact({ name: '', phone: '', relationship: '' });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const cancelAddContact = () => {
    setIsAddingContact(false);
    setNewContact({ name: '', phone: '', relationship: '' });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const calculateAge = (dob: string) => {
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-8 bg-neutral-200 rounded w-48" />
        <div className="h-32 bg-neutral-200 rounded-xl" />
        <div className="h-48 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900">My Profile</h1>
      </div>

      {/* Read-only notice */}
      <div className="flex items-start gap-3 p-4 bg-info-light rounded-xl border border-info/20">
        <Info className="w-5 h-5 text-info mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-info-dark">View Only</p>
          <p className="text-sm text-info-dark/80">
            Medical information can only be updated by your healthcare provider. 
            You can add emergency contacts below.
          </p>
        </div>
      </div>

      {/* Success Message */}
      {saveSuccess && (
        <div className="success-card flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-success-500" />
          <span>Emergency contact added successfully!</span>
        </div>
      )}

      {/* Personal Info Card */}
      <div className="patient-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
            <User className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h2 className="font-semibold text-lg text-neutral-900">Personal Information</h2>
            <p className="text-sm text-neutral-500">Basic details and identification</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-neutral-500">Full Name</label>
              <p className="font-medium text-neutral-900">{profile?.fullName}</p>
            </div>
            <div>
              <label className="text-sm text-neutral-500">Date of Birth</label>
              <p className="font-medium text-neutral-900">
                {profile && formatDate(profile.dateOfBirth)} ({profile && calculateAge(profile.dateOfBirth)} years)
              </p>
            </div>
          </div>

          <div className="border-t pt-4">
            <label className="text-sm text-neutral-500 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              National Health ID
            </label>
            <p className="font-mono text-lg font-semibold text-primary-600 mt-1">
              {profile?.nationalHealthId}
            </p>
          </div>
        </div>
      </div>

      {/* Medical Info Card */}
      <div className="patient-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-emergency-50 rounded-xl flex items-center justify-center">
            <Heart className="w-6 h-6 text-emergency-500" />
          </div>
          <div>
            <h2 className="font-semibold text-lg text-neutral-900">Medical Information</h2>
            <p className="text-sm text-neutral-500">Critical health data for emergencies</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Blood Type */}
          <div className="flex items-center justify-between p-4 bg-emergency-50 rounded-xl">
            <div className="flex items-center gap-3">
              <Droplets className="w-6 h-6 text-emergency-500" />
              <span className="font-medium text-neutral-900">Blood Type</span>
            </div>
            <span className="text-2xl font-bold text-emergency-600">{profile?.bloodType}</span>
          </div>

          {/* Allergies */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-emergency-500" />
              <span className="font-medium text-neutral-900">Allergies</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile?.allergies.map((allergy, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1.5 bg-emergency-100 text-emergency-700 rounded-full text-sm font-medium"
                >
                  {allergy}
                </span>
              ))}
              {profile?.allergies.length === 0 && (
                <span className="text-neutral-500">No known allergies</span>
              )}
            </div>
          </div>

          {/* Medications */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Pill className="w-5 h-5 text-info" />
              <span className="font-medium text-neutral-900">Current Medications</span>
            </div>
            <div className="space-y-2">
              {profile?.currentMedications.map((med, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-info-light rounded-xl text-info-dark flex items-center gap-2"
                >
                  <div className="w-2 h-2 bg-info rounded-full" />
                  {med}
                </div>
              ))}
              {profile?.currentMedications.length === 0 && (
                <span className="text-neutral-500">No current medications</span>
              )}
            </div>
          </div>

          {/* Chronic Conditions */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-5 h-5 text-warning-500" />
              <span className="font-medium text-neutral-900">Chronic Conditions</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile?.chronicConditions.map((condition, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1.5 bg-warning-50 text-warning-700 rounded-full text-sm font-medium"
                >
                  {condition}
                </span>
              ))}
              {profile?.chronicConditions.length === 0 && (
                <span className="text-neutral-500">No chronic conditions</span>
              )}
            </div>
          </div>

          {/* Organ Donor / DNR */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div className="flex items-center justify-between p-3 bg-neutral-50 rounded-xl">
              <span className="text-sm font-medium text-neutral-700">Organ Donor</span>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                profile?.organDonor ? 'bg-success-100 text-success-700' : 'bg-neutral-200 text-neutral-600'
              }`}>
                {profile?.organDonor ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-neutral-50 rounded-xl">
              <span className="text-sm font-medium text-neutral-700">DNR Status</span>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                profile?.dnrStatus ? 'bg-emergency-100 text-emergency-700' : 'bg-neutral-200 text-neutral-600'
              }`}>
                {profile?.dnrStatus ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Emergency Contacts Card */}
      <div className="patient-card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-success-50 rounded-xl flex items-center justify-center">
              <Phone className="w-6 h-6 text-success-500" />
            </div>
            <div>
              <h2 className="font-semibold text-lg text-neutral-900">Emergency Contacts</h2>
              <p className="text-sm text-neutral-500">People to contact in emergencies</p>
            </div>
          </div>
          {!isAddingContact && (
            <button
              onClick={() => setIsAddingContact(true)}
              className="flex items-center gap-2 px-4 py-2 text-success-600 hover:bg-success-50 rounded-xl transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add
            </button>
          )}
        </div>

        {/* Add New Contact Form */}
        {isAddingContact && (
          <div className="mb-6 p-4 bg-success-50 rounded-xl border border-success-200">
            <h3 className="font-medium text-neutral-900 mb-4">Add Emergency Contact</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={newContact.name}
                  onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-success-500 focus:border-transparent"
                  placeholder="e.g., Jane Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Phone Number *</label>
                <input
                  type="tel"
                  value={newContact.phone}
                  onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-success-500 focus:border-transparent"
                  placeholder="e.g., +234-801-234-5678"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Relationship *</label>
                <select
                  value={newContact.relationship}
                  onChange={(e) => setNewContact({ ...newContact, relationship: e.target.value })}
                  className="w-full p-3 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-success-500 focus:border-transparent"
                >
                  <option value="">Select relationship</option>
                  <option value="Spouse">Spouse</option>
                  <option value="Parent">Parent</option>
                  <option value="Child">Child</option>
                  <option value="Sibling">Sibling</option>
                  <option value="Friend">Friend</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={cancelAddContact}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-neutral-600 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-50 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
                <button
                  onClick={handleAddContact}
                  disabled={isSaving || !newContact.name || !newContact.phone || !newContact.relationship}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-success-500 text-white rounded-xl hover:bg-success-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Contact
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {profile?.emergencyContacts.map((contact, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-4 bg-neutral-50 rounded-xl"
            >
              <div>
                <p className="font-medium text-neutral-900">{contact.name}</p>
                <p className="text-sm text-neutral-500">{contact.relationship}</p>
              </div>
              <a
                href={`tel:${contact.phone}`}
                className="flex items-center gap-2 px-4 py-2 bg-success-500 text-white rounded-xl hover:bg-success-600 transition-colors"
              >
                <Phone className="w-4 h-4" />
                Call
              </a>
            </div>
          ))}
          {profile?.emergencyContacts.length === 0 && (
            <p className="text-center text-neutral-500 py-4">
              No emergency contacts added yet. Add one above.
            </p>
          )}
        </div>
      </div>

      {/* Last Updated */}
      <div className="text-center text-sm text-neutral-500 flex items-center justify-center gap-2">
        <Calendar className="w-4 h-4" />
        Last updated: {profile && formatDate(profile.lastUpdated)}
      </div>
    </div>
  );
}
