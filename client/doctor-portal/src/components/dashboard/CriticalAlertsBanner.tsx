import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Siren, AlertTriangle, X } from 'lucide-react';

import { formatTimestamp } from '@medichain/shared';
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
  // `/alerts` is not a route. An unknown path falls through to the router's
  // catch-all, which redirects to the dashboard -- so pressing "View Alerts"
  // on the dashboard put you back on the dashboard, and read as a dead button.
  viewAllLink = '/critical-value',
  maxDisplay = 3,
}: CriticalAlertsBannerProps) {
  // A callback and a route cannot both be the destination. The caller's
  // callback wins; `viewAllLink` stays the default for callers that pass
  // neither. Rendering a <button> rather than a <Link> keeps the semantics
  // honest: with onViewAll there is no href to open in a new tab.
  const renderViewAll = (className: string, children: ReactNode) =>
    onViewAll ? (
      <button type="button" onClick={onViewAll} className={className}>
        {children}
      </button>
    ) : (
      <Link to={viewAllLink} className={className}>
        {children}
      </Link>
    );

  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged);
  
  if (unacknowledgedAlerts.length === 0) {
    return null;
  }

  const displayedAlerts = unacknowledgedAlerts.slice(0, maxDisplay);
  const remainingCount = unacknowledgedAlerts.length - maxDisplay;

  const getSeverityColor = (severity: CriticalAlert['severity']) => {
    switch (severity) {
      case 'critical':
        return 'bg-critical';
      case 'high':
        return 'bg-orange-500';
      case 'medium':
        return 'bg-caution';
      default:
        return 'bg-critical';
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
    <div className="mb-6 bg-critical text-critical-fg rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-red-500">
        <div className="flex items-center gap-3">
          <Siren className="animate-pulse" size={24} />
          <div>
            <p className="font-bold">Critical Alerts Require Attention</p>
            <p className="text-critical-fg text-sm">
              {unacknowledgedAlerts.length} unacknowledged alert{unacknowledgedAlerts.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {renderViewAll(
          'bg-surface text-critical-subtle-fg px-4 py-2 rounded-lg font-medium hover:bg-critical-subtle transition-colors',
          'View All'
        )}
      </div>

      {/* Alert List */}
      <div className="divide-y divide-red-500">
        {displayedAlerts.map((alert) => (
          <div 
            key={alert.id}
            className="p-4 flex items-center justify-between hover:bg-critical transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getSeverityColor(alert.severity)}`}>
                {getAlertIcon(alert.type)}
              </div>
              <div>
                <p className="font-medium">{alert.title}</p>
                <p className="text-critical-fg text-sm">
                  {alert.patient_name && `${alert.patient_name} - `}
                  {alert.description}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-critical-fg text-xs">
                {formatTimestamp(alert.timestamp, { timeStyle: 'short' })}
              </span>
              {onAcknowledge && (
                <button
                  onClick={() => onAcknowledge(alert.id)}
                  className="bg-critical hover:bg-red-800 p-1.5 rounded transition-colors"
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
        <div className="p-3 bg-critical text-center">
          {renderViewAll(
            'inline-flex items-center min-h-[24px] py-1 text-critical-fg text-sm hover:text-white transition-colors',
            <>
              + {remainingCount} more alert{remainingCount !== 1 ? 's' : ''} →
            </>
          )}
        </div>
      )}
    </div>
  );
}
