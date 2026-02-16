import { Link } from 'react-router-dom';
import { Siren, AlertTriangle, X } from 'lucide-react';

export interface CriticalAlert {
  id: string;
  type: 'critical_value' | 'code_blue' | 'allergy' | 'drug_interaction' | 'medication_due';
  title: string;
  description: string;
  patient_id?: string;
  patient_name?: string;
  severity: 'critical' | 'high' | 'medium';
  timestamp: string;
  acknowledged?: boolean;
}

interface CriticalAlertsBannerProps {
  alerts: CriticalAlert[];
  onAcknowledge?: (alertId: string) => void;
  onViewAll?: () => void;
  viewAllLink?: string;
  maxDisplay?: number;
}

/**
 * Critical alerts banner for dashboards
 * Displays urgent alerts that need immediate attention
 * Red pulsing animation for visibility
 */
export default function CriticalAlertsBanner({
  alerts,
  onAcknowledge,
  onViewAll,
  viewAllLink = '/alerts',
  maxDisplay = 3,
}: CriticalAlertsBannerProps) {
  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged);
  
  if (unacknowledgedAlerts.length === 0) {
    return null;
  }

  const displayedAlerts = unacknowledgedAlerts.slice(0, maxDisplay);
  const remainingCount = unacknowledgedAlerts.length - maxDisplay;

  const getSeverityColor = (severity: CriticalAlert['severity']) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-600';
      case 'high':
        return 'bg-orange-500';
      case 'medium':
        return 'bg-yellow-500';
      default:
        return 'bg-red-600';
    }
  };

  const getAlertIcon = (type: CriticalAlert['type']) => {
    switch (type) {
      case 'code_blue':
        return <Siren className="animate-pulse" size={20} />;
      default:
        return <AlertTriangle size={20} />;
    }
  };

  return (
    <div className="mb-6 bg-red-600 text-white rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-red-500">
        <div className="flex items-center gap-3">
          <Siren className="animate-pulse" size={24} />
          <div>
            <p className="font-bold">Critical Alerts Require Attention</p>
            <p className="text-red-100 text-sm">
              {unacknowledgedAlerts.length} unacknowledged alert{unacknowledgedAlerts.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Link 
          to={viewAllLink}
          className="bg-white text-red-600 px-4 py-2 rounded-lg font-medium hover:bg-red-50 transition-colors"
        >
          View All
        </Link>
      </div>

      {/* Alert List */}
      <div className="divide-y divide-red-500">
        {displayedAlerts.map((alert) => (
          <div 
            key={alert.id}
            className="p-4 flex items-center justify-between hover:bg-red-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getSeverityColor(alert.severity)}`}>
                {getAlertIcon(alert.type)}
              </div>
              <div>
                <p className="font-medium">{alert.title}</p>
                <p className="text-red-100 text-sm">
                  {alert.patient_name && `${alert.patient_name} - `}
                  {alert.description}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-red-200 text-xs">
                {new Date(alert.timestamp).toLocaleTimeString()}
              </span>
              {onAcknowledge && (
                <button
                  onClick={() => onAcknowledge(alert.id)}
                  className="bg-red-700 hover:bg-red-800 p-1.5 rounded transition-colors"
                  title="Acknowledge"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer with remaining count */}
      {remainingCount > 0 && (
        <div className="p-3 bg-red-700 text-center">
          <Link 
            to={viewAllLink}
            className="text-red-100 text-sm hover:text-white transition-colors"
          >
            + {remainingCount} more alert{remainingCount !== 1 ? 's' : ''} →
          </Link>
        </div>
      )}
    </div>
  );
}
