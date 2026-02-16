import { useEffect, useState } from 'react';
import { getPatientTelehealthSessions, joinTelehealthSession } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';

export function TelehealthPage() {
  const { patient } = usePatientAuthStore();
  const { showError } = useToastActions();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patient?.healthId) return;
    // @ts-ignore
    getPatientTelehealthSessions(patient.healthId)
      .then((res: any) => setSessions(res.sessions || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleJoin = async (sessionId: string) => {
    try {
      // @ts-ignore
      const res: any = await joinTelehealthSession(sessionId);
      if (res.video_room_url) {
        window.open(res.video_room_url, '_blank');
      }
    } catch (err) {
      console.error(err);
      showError('Failed to join session');
    }
  };

  if (loading) return <div className="p-4">Loading sessions...</div>;

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Telehealth Visits</h1>
      
      {sessions.length === 0 ? (
        <p className="text-gray-500">No scheduled visits.</p>
      ) : (
        <div className="space-y-4">
          {sessions.map(session => (
            <div key={session.session_id} className="bg-white p-4 rounded shadow border-l-4 border-green-500">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold">Dr. {session.provider_id}</h3>
                  <p className="text-sm text-gray-600">
                    {new Date(session.scheduled_start * 1000).toLocaleString()}
                  </p>
                </div>
                <button 
                  onClick={() => handleJoin(session.session_id)}
                  className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700"
                >
                  Join Video
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
