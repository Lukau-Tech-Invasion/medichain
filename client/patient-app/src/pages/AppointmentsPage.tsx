import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPatientAppointments, cancelAppointment as cancelAppointmentAPI } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Calendar,
  Clock,
  MapPin,
  User,
  Phone,
  Video,
  Plus,
  Loader2,
  Wifi,
  WifiOff,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface Appointment {
  id: string;
  type: 'in-person' | 'telehealth';
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
  provider: string;
  specialty: string;
  date: string;
  time: string;
  duration: number;
  location?: string;
  reason: string;
  notes?: string;
  phoneNumber?: string;
  videoLink?: string;
}

/**
 * AppointmentsPage - Patient appointment management
 * 
 * Features:
 * - View upcoming appointments
 * - See past appointments
 * - Request new appointments
 * - Manage appointment details
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function AppointmentsPage() {
  const navigate = useNavigate();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadAppointments();
    }
  }, [patient]);

  const loadAppointments = async () => {
    if (!patient) return;
    
    setLoading(true);
    try {
      const data = await getPatientAppointments(patient.healthId);
      setApiConnected(true);
      
      const appts: Appointment[] = ((data as any).appointments || []).map((a: any) => ({
        id: a.appointment_id,
        type: a.type || 'in-person',
        status: a.status || 'scheduled',
        provider: a.provider_name,
        specialty: a.specialty,
        date: a.scheduled_date,
        time: a.scheduled_time,
        duration: a.duration_minutes || 30,
        location: a.location,
        reason: a.reason,
        notes: a.notes,
      }));
      
      setAppointments(appts);
    } catch (err) {
      console.error('Failed to load appointments:', err);
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const upcomingAppointments = appointments.filter(a => 
    a.status !== 'completed' && a.status !== 'cancelled' && new Date(a.date) >= new Date()
  );
  
  const pastAppointments = appointments.filter(a => 
    a.status === 'completed' || a.status === 'cancelled' || new Date(a.date) < new Date()
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-green-100 text-green-700';
      case 'scheduled': return 'bg-blue-100 text-blue-700';
      case 'completed': return 'bg-neutral-100 text-neutral-700';
      case 'cancelled': return 'bg-red-100 text-red-700';
      default: return 'bg-neutral-100 text-neutral-700';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <CheckCircle className="w-4 h-4" />;
      case 'scheduled': return <Clock className="w-4 h-4" />;
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      case 'cancelled': return <XCircle className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };

  const cancelAppointment = async (appointmentId: string) => {
    if (!patient) return;
    setCancellingId(appointmentId);
    try {
      await cancelAppointmentAPI(appointmentId, { reason: 'Cancelled by patient' });
      setAppointments(prev => prev.map(a =>
        a.id === appointmentId ? { ...a, status: 'cancelled' as const } : a
      ));
    } catch (err) {
      console.error('Error cancelling appointment:', err);
    } finally {
      setCancellingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

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
          <h1 className="text-2xl font-bold text-neutral-900">Appointments</h1>
          <p className="text-neutral-500">Manage your healthcare visits</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? 'Live' : 'Demo'}
          </span>
          <button
            onClick={loadAppointments}
            className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <button className="patient-card flex items-center gap-3 p-4 hover:border-primary-200 border-2 border-transparent">
          <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
            <Plus className="w-6 h-6 text-primary-600" />
          </div>
          <div className="text-left">
            <div className="font-medium text-neutral-900">Book New</div>
            <div className="text-sm text-neutral-500">Schedule visit</div>
          </div>
        </button>
        
        <button className="patient-card flex items-center gap-3 p-4 hover:border-primary-200 border-2 border-transparent">
          <div className="w-12 h-12 bg-info-light rounded-xl flex items-center justify-center">
            <Video className="w-6 h-6 text-info" />
          </div>
          <div className="text-left">
            <div className="font-medium text-neutral-900">Telehealth</div>
            <div className="text-sm text-neutral-500">Virtual visit</div>
          </div>
        </button>
      </div>

      {/* Upcoming Summary */}
      {upcomingAppointments.length > 0 && (
        <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
          <h2 className="text-lg font-semibold mb-2">Next Appointment</h2>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center">
              {upcomingAppointments[0].type === 'telehealth' ? (
                <Video className="w-7 h-7" />
              ) : (
                <User className="w-7 h-7" />
              )}
            </div>
            <div>
              <p className="font-medium">{upcomingAppointments[0].provider}</p>
              <p className="text-white/80 text-sm">{upcomingAppointments[0].specialty}</p>
              <p className="text-white/80 text-sm">
                {formatDate(upcomingAppointments[0].date)} at {upcomingAppointments[0].time}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-200">
        <button
          onClick={() => setActiveTab('upcoming')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'upcoming'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          Upcoming ({upcomingAppointments.length})
        </button>
        <button
          onClick={() => setActiveTab('past')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'past'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          Past ({pastAppointments.length})
        </button>
      </div>

      {/* Appointments List */}
      <div className="space-y-4">
        {(activeTab === 'upcoming' ? upcomingAppointments : pastAppointments).map(appointment => (
          <div key={appointment.id} className="patient-card">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  appointment.type === 'telehealth' ? 'bg-info-light' : 'bg-primary-100'
                }`}>
                  {appointment.type === 'telehealth' ? (
                    <Video className={`w-6 h-6 ${appointment.type === 'telehealth' ? 'text-info' : 'text-primary-600'}`} />
                  ) : (
                    <User className="w-6 h-6 text-primary-600" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-neutral-900">{appointment.provider}</h3>
                  <p className="text-sm text-neutral-500">{appointment.specialty}</p>
                </div>
              </div>
              <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
                {getStatusIcon(appointment.status)}
                {appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="flex items-center gap-2 text-sm text-neutral-600">
                <Calendar className="w-4 h-4 text-neutral-400" />
                {formatDate(appointment.date)}
              </div>
              <div className="flex items-center gap-2 text-sm text-neutral-600">
                <Clock className="w-4 h-4 text-neutral-400" />
                {appointment.time} ({appointment.duration} min)
              </div>
            </div>

            {appointment.location && (
              <div className="flex items-center gap-2 text-sm text-neutral-600 mb-3">
                <MapPin className="w-4 h-4 text-neutral-400" />
                {appointment.location}
              </div>
            )}

            <div className="bg-neutral-50 rounded-lg p-3 mb-3">
              <p className="text-xs text-neutral-500 mb-1">Reason for Visit</p>
              <p className="text-sm text-neutral-900">{appointment.reason}</p>
            </div>

            {appointment.notes && (
              <p className="text-sm text-neutral-500 italic">📝 {appointment.notes}</p>
            )}

            {(appointment.status === 'scheduled' || appointment.status === 'confirmed') && (
              <div className="flex gap-2 mt-4">
                <button className="flex-1 py-2 bg-primary-500 text-white rounded-lg font-medium hover:bg-primary-600 transition-colors text-sm">
                  Confirm
                </button>
                <button className="flex-1 py-2 border border-neutral-300 text-neutral-700 rounded-lg font-medium hover:bg-neutral-50 transition-colors text-sm">
                  Reschedule
                </button>
                <button
                  onClick={() => cancelAppointment(appointment.id)}
                  disabled={cancellingId === appointment.id}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {cancellingId === appointment.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  Cancel
                </button>
              </div>
            )}

            {appointment.type === 'telehealth' && appointment.status !== 'completed' && appointment.status !== 'cancelled' && (
              <div className="flex gap-2 mt-4">
                <button className="flex-1 py-2 bg-info text-white rounded-lg font-medium hover:bg-blue-600 transition-colors text-sm flex items-center justify-center gap-2">
                  <Video className="w-4 h-4" />
                  Join Video Call
                </button>
                {appointment.phoneNumber && (
                  <button className="py-2 px-4 border border-neutral-300 text-neutral-700 rounded-lg font-medium hover:bg-neutral-50 transition-colors text-sm flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {((activeTab === 'upcoming' && upcomingAppointments.length === 0) || 
          (activeTab === 'past' && pastAppointments.length === 0)) && (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
            <p className="text-neutral-500">
              No {activeTab} appointments
            </p>
            {activeTab === 'upcoming' && (
              <button className="mt-4 px-6 py-2 bg-primary-500 text-white rounded-lg font-medium hover:bg-primary-600 transition-colors">
                Book an Appointment
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
