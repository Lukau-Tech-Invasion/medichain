import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Pill,
  Clock,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Bell,
  Plus,
  ChevronRight,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react';

interface Medication {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  prescribedBy: string;
  startDate: string;
  endDate?: string;
  refillsRemaining: number;
  lastTaken?: string;
  nextDose?: string;
  instructions: string;
  sideEffects: string[];
  interactions: string[];
}

interface MedicationReminder {
  id: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  scheduledTime: string;
  taken: boolean;
  takenAt?: string;
}

/**
 * MedicationsPage - Patient medication management
 * 
 * Features:
 * - View all current medications
 * - Medication reminders
 * - Track doses taken
 * - Refill requests
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function MedicationsPage() {
  const navigate = useNavigate();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [reminders, setReminders] = useState<MedicationReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'current' | 'reminders' | 'history'>('current');

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadMedications();
    }
  }, [patient]);

  const loadMedications = async () => {
    if (!patient) return;
    
    setLoading(true);
    try {
      const patientId = patient.healthId;
      
      const response = await fetch(apiUrl(`/api/patients/${patientId}/medications`), {
        headers: { 
          'X-User-Id': patient.walletAddress,
          'X-Health-Id': patient.healthId,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setApiConnected(true);
        
        const meds: Medication[] = (data.medications || []).map((m: {
          medication_id: string;
          name: string;
          dosage: string;
          frequency: string;
          prescribed_by: string;
          start_date: string;
          end_date?: string;
          refills_remaining: number;
          instructions: string;
          side_effects?: string[];
          interactions?: string[];
        }) => ({
          id: m.medication_id,
          name: m.name,
          dosage: m.dosage,
          frequency: m.frequency,
          prescribedBy: m.prescribed_by,
          startDate: m.start_date,
          endDate: m.end_date,
          refillsRemaining: m.refills_remaining || 0,
          instructions: m.instructions || 'Take as directed',
          sideEffects: m.side_effects || [],
          interactions: m.interactions || [],
        }));
        
        setMedications(meds);
        generateReminders(meds);
      } else {
        console.error('Failed to load medications');
        setApiConnected(false);
        setMedications([]);
      }
    } catch (error) {
      console.error('Error loading medications:', error);
      setApiConnected(false);
      setMedications([]);
    } finally {
      setLoading(false);
    }
  };

  const generateReminders = (meds: Medication[]) => {
    const now = new Date();
    const todayReminders: MedicationReminder[] = [];
    
    meds.forEach(med => {
      if (med.frequency.toLowerCase().includes('twice')) {
        todayReminders.push(
          {
            id: `${med.id}-AM`,
            medicationId: med.id,
            medicationName: med.name,
            dosage: med.dosage,
            scheduledTime: '08:00',
            taken: now.getHours() >= 9,
            takenAt: now.getHours() >= 9 ? '08:15' : undefined,
          },
          {
            id: `${med.id}-PM`,
            medicationId: med.id,
            medicationName: med.name,
            dosage: med.dosage,
            scheduledTime: '20:00',
            taken: false,
          }
        );
      } else if (med.frequency.toLowerCase().includes('once')) {
        todayReminders.push({
          id: `${med.id}-DAILY`,
          medicationId: med.id,
          medicationName: med.name,
          dosage: med.dosage,
          scheduledTime: med.frequency.toLowerCase().includes('bedtime') ? '22:00' : '08:00',
          taken: now.getHours() >= 9 && !med.frequency.toLowerCase().includes('bedtime'),
          takenAt: now.getHours() >= 9 && !med.frequency.toLowerCase().includes('bedtime') ? '08:05' : undefined,
        });
      }
    });
    
    setReminders(todayReminders.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)));
  };

  const markAsTaken = (reminderId: string) => {
    setReminders(prev => prev.map(r => 
      r.id === reminderId 
        ? { ...r, taken: true, takenAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }
        : r
    ));
  };

  const pendingReminders = reminders.filter(r => !r.taken);
  const completedReminders = reminders.filter(r => r.taken);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">My Medications</h1>
          <p className="text-neutral-500">Track and manage your prescriptions</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? 'Live' : 'Demo'}
          </span>
          <button
            onClick={loadMedications}
            className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Today's Reminders Summary */}
      <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Today's Medications</h2>
            <p className="text-white/80 text-sm">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <Bell className="w-6 h-6" />
        </div>
        
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold">{reminders.length}</div>
            <div className="text-xs text-white/70">Total Doses</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold">{completedReminders.length}</div>
            <div className="text-xs text-white/70">Taken</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-yellow-300">{pendingReminders.length}</div>
            <div className="text-xs text-white/70">Pending</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-200">
        {(['current', 'reminders', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {tab === 'current' ? 'Current Meds' : tab === 'reminders' ? "Today's Schedule" : 'History'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'reminders' && (
        <div className="space-y-4">
          {/* Pending */}
          {pendingReminders.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium text-neutral-700 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Upcoming
              </h3>
              {pendingReminders.map(reminder => (
                <div key={reminder.id} className="patient-card flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
                      <Pill className="w-6 h-6 text-primary-600" />
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900">{reminder.medicationName}</p>
                      <p className="text-sm text-neutral-500">{reminder.dosage} • {reminder.scheduledTime}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => markAsTaken(reminder.id)}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
                  >
                    Mark Taken
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Completed */}
          {completedReminders.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium text-neutral-700 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" /> Completed
              </h3>
              {completedReminders.map(reminder => (
                <div key={reminder.id} className="patient-card flex items-center justify-between opacity-75">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900 line-through">{reminder.medicationName}</p>
                      <p className="text-sm text-neutral-500">{reminder.dosage} • Taken at {reminder.takenAt}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {reminders.length === 0 && (
            <div className="text-center py-12">
              <Pill className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-500">No medications scheduled for today</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'current' && (
        <div className="space-y-4">
          {medications.map(med => (
            <div key={med.id} className="patient-card">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
                    <Pill className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-900">{med.name}</h3>
                    <p className="text-sm text-neutral-500">{med.dosage} • {med.frequency}</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-400" />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-neutral-50 rounded-lg p-3">
                  <p className="text-xs text-neutral-500">Prescribed By</p>
                  <p className="text-sm font-medium text-neutral-900">{med.prescribedBy}</p>
                </div>
                <div className="bg-neutral-50 rounded-lg p-3">
                  <p className="text-xs text-neutral-500">Refills Remaining</p>
                  <p className={`text-sm font-medium ${med.refillsRemaining <= 1 ? 'text-emergency-600' : 'text-neutral-900'}`}>
                    {med.refillsRemaining} {med.refillsRemaining <= 1 && '⚠️'}
                  </p>
                </div>
              </div>

              <p className="text-sm text-neutral-600 mb-3">
                <span className="font-medium">Instructions:</span> {med.instructions}
              </p>

              {med.sideEffects.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-yellow-700 bg-yellow-50 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium">Possible side effects:</span>{' '}
                    {med.sideEffects.join(', ')}
                  </div>
                </div>
              )}

              {med.refillsRemaining <= 1 && (
                <button className="mt-3 w-full py-2 border-2 border-primary-500 text-primary-600 rounded-lg font-medium hover:bg-primary-50 transition-colors flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" />
                  Request Refill
                </button>
              )}
            </div>
          ))}

          {medications.length === 0 && (
            <div className="text-center py-12">
              <Pill className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-500">No active medications</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="patient-card">
            <div className="flex items-center gap-3 mb-4">
              <Calendar className="w-5 h-5 text-neutral-500" />
              <h3 className="font-medium text-neutral-900">Medication History</h3>
            </div>
            <p className="text-sm text-neutral-500 text-center py-8">
              Medication history will appear here once you start tracking doses.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
