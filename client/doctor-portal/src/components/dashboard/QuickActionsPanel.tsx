import { Link } from 'react-router-dom';
import { LucideIcon, ArrowRight } from 'lucide-react';

export interface QuickAction {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  href: string;
  color: 'primary' | 'emergency' | 'amber' | 'green' | 'purple' | 'blue' | 'teal' | 'pink';
  gradient?: boolean;
}

interface QuickActionsPanelProps {
  actions: QuickAction[];
  title?: string;
  columns?: 1 | 2 | 3 | 4;
}

const colorClasses = {
  primary: {
    bg: 'bg-gradient-to-r from-primary-700 to-primary-800',
    hover: 'hover:from-primary-800 hover:to-primary-900',
    text: 'text-white',
  },
  emergency: {
    bg: 'bg-gradient-to-r from-emergency-700 to-emergency-800',
    hover: 'hover:from-emergency-800 hover:to-emergency-900',
    text: 'text-white',
  },
  amber: {
    bg: 'bg-gradient-to-r from-amber-700 to-orange-800',
    hover: 'hover:from-amber-800 hover:to-orange-900',
    text: 'text-white',
  },
  green: {
    bg: 'bg-gradient-to-r from-green-700 to-emerald-800',
    hover: 'hover:from-green-800 hover:to-emerald-900',
    text: 'text-white',
  },
  purple: {
    bg: 'bg-gradient-to-r from-purple-700 to-violet-800',
    hover: 'hover:from-purple-800 hover:to-violet-900',
    text: 'text-white',
  },
  blue: {
    bg: 'bg-gradient-to-r from-blue-700 to-indigo-800',
    hover: 'hover:from-blue-800 hover:to-indigo-900',
    text: 'text-white',
  },
  teal: {
    bg: 'bg-gradient-to-r from-teal-700 to-cyan-800',
    hover: 'hover:from-teal-800 hover:to-cyan-900',
    text: 'text-white',
  },
  pink: {
    bg: 'bg-gradient-to-r from-pink-700 to-rose-800',
    hover: 'hover:from-pink-800 hover:to-rose-900',
    text: 'text-white',
  },
};

/**
 * Quick actions panel for dashboards
 * Displays shortcuts to common tasks with gradient styling
 */
export default function QuickActionsPanel({
  actions,
  title,
  columns = 3,
}: QuickActionsPanelProps) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <div className="mb-8">
      {title && (
        <h2 className="text-lg font-semibold text-content mb-4">{title}</h2>
      )}
      <div className={`grid ${gridCols[columns]} gap-4`}>
        {actions.map((action) => {
          const Icon = action.icon;
          const colors = colorClasses[action.color];
          
          return (
            <Link
              key={action.id}
              to={action.href}
              className={`${colors.bg} ${colors.hover} rounded-xl p-6 text-white transition-all group`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon size={24} />
                  <div>
                    <h3 className="text-lg font-semibold">{action.label}</h3>
                    {action.description && (
                      <p className={`${colors.text} text-sm`}>
                        {action.description}
                      </p>
                    )}
                  </div>
                </div>
                <ArrowRight className="group-hover:translate-x-1 transition-transform" size={24} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
